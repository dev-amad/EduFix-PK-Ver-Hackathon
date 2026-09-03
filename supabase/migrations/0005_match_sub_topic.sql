-- EduFix PK — RAG Vector Search RPC
-- Migration 0005: add a hard `sub_topic` isolation filter to match_kb_chunks.
--
-- WHY (critical bug fix — cross-contamination):
--   Notes retrieval was purely semantic: a "Battle of Badr (624 AD)" query
--   pulled the nearest chunks, and because Badr and Uhud (625 AD) mark schemes
--   are near-identical in embedding space, Uhud facts leaked into Badr notes.
--   kb_chunks now carry a DETERMINISTIC metadata.sub_topic tag (see
--   scripts/retag-subtopics.ts + scripts/lib/subtopic-tagger.ts). This adds the
--   database-layer filter that makes "chunks containing Uhud are strictly
--   excluded from Badr queries" literally true.
--
-- FILTER SEMANTICS — "selected OR general OR untagged":
--   A row is eligible when match_sub_topic is NULL (no filtering), OR its
--   sub_topic equals the requested slug, OR it is a generic/untagged chunk
--   (sub_topic IS NULL or LIKE 'general%'). This hard-EXCLUDES chunks that were
--   deterministically tagged as a DIFFERENT specific sub-topic (e.g. Uhud chunks
--   during a Badr query) while preserving semantic ranking over the untagged
--   pool, so sub-topics that have no keyword rules yet still retrieve normally.
--
-- NOTE: Postgres treats a changed parameter list as a NEW overload, and with
--   DEFAULT NULL params an 8-arg call would then be ambiguous. So DROP the exact
--   0003 signature first, then CREATE the 9-parameter version.

DROP FUNCTION IF EXISTS public.match_kb_chunks(
  vector(768), text, double precision, integer, text, text, integer, text
);

CREATE FUNCTION public.match_kb_chunks(
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
      OR kc.metadata->>'sub_topic' = match_sub_topic
      OR kc.metadata->>'sub_topic' IS NULL
      OR kc.metadata->>'sub_topic' LIKE 'general%'
    )
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_top_k;
END;
$$;
