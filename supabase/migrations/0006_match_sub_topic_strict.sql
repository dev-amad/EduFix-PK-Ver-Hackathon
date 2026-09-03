-- EduFix PK — RAG Vector Search RPC
-- Migration 0006: STRICT `metadata @>` sub_topic containment.
--
-- WHY (critical refactor — syllabus leakage + residual cross-topic bleed):
--   Migration 0005 filtered "selected OR general OR untagged": it excluded
--   chunks tagged as a DIFFERENT specific sub-topic, but STILL admitted the
--   whole `general<code>` pool. For 2058/01 that pool contains the syllabus PDF
--   ("Candidates should …") and other-topic boilerplate, which the model then
--   regurgitated into Badr/Uhud notes. kb_chunks now carry a DETERMINISTIC
--   metadata.sub_topic tag spanning all 44 granular Islamiyat (17) + Pakistan
--   Studies (27) sub-topics (scripts/lib/subtopic-tagger.ts, applied by
--   scripts/retag-subtopics.ts). This migration makes retrieval STRICT:
--
--     match_sub_topic IS NULL  -> no sub-topic filtering (Urdu notes, the
--                                 Answering Assistant and the Answer Checker,
--                                 which request the whole general pool); OR
--     metadata @> {"sub_topic": <slug>} -> ONLY chunks tagged EXACTLY that slug.
--
--   Result: for a granular Islamiyat / Pakistan Studies sub-topic, ZERO chunks
--   from outside the selected slug enter the prompt context window — no Uhud in
--   a Badr query, no 3rd RTC in a 1st RTC query, and no syllabus meta-text.
--   Sub-topics whose tag count is thin simply return fewer, precise chunks;
--   a sub-topic with no tagged chunks returns none (honest "insufficient
--   context") rather than silently borrowing a neighbour's facts.
--
-- SIGNATURE: identical to 0005 (9 params), so CREATE OR REPLACE swaps the body
--   in place — no overload, no DROP required.

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding vector(768),
  match_subject_id text,
  match_threshold double precision DEFAULT 0.78,
  match_top_k integer DEFAULT 5,
  match_category text DEFAULT NULL,
  match_paper_code text DEFAULT NULL,
  match_year integer DEFAULT NULL,
  match_session text DEFAULT NULL,
  match_sub_topic text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  subject_id text,
  content text,
  metadata jsonb,
  similarity double precision,
  document_title text,
  document_category text,
  document_year integer,
  document_session text,
  document_paper_code text
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF match_subject_id IS NULL OR match_subject_id = '' THEN
    RAISE EXCEPTION 'match_subject_id is required';
  END IF;

  IF match_threshold IS NULL THEN
    match_threshold := 0.78;
  END IF;

  IF match_top_k IS NULL OR match_top_k <= 0 THEN
    match_top_k := 5;
  END IF;

  IF match_top_k > 50 THEN
    match_top_k := 50;
  END IF;

  RETURN QUERY
  SELECT
    kc.id AS chunk_id,
    kc.document_id,
    kc.subject_id,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    kd.title AS document_title,
    kd.category AS document_category,
    kd.year AS document_year,
    kd.session AS document_session,
    kd.paper_code AS document_paper_code
  FROM public.kb_chunks AS kc
  LEFT JOIN public.kb_documents AS kd
    ON kd.id = kc.document_id
  WHERE kc.subject_id = match_subject_id
    AND kc.embedding IS NOT NULL
    AND (match_category IS NULL OR kc.metadata->>'category' = match_category)
    AND (match_paper_code IS NULL OR kc.metadata->>'paper_code' = match_paper_code)
    AND (match_year IS NULL OR (kc.metadata->>'year')::int = match_year)
    AND (match_session IS NULL OR kc.metadata->>'session' = match_session)
    AND (
      match_sub_topic IS NULL
      OR kc.metadata @> jsonb_build_object('sub_topic', match_sub_topic)
    )
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_top_k;
END;
$$;
