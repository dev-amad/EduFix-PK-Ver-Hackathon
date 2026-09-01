-- EduFix PK — RAG Vector Search RPC
-- Migration 0003: strict subject-scoped cosine similarity search over kb_chunks
--
-- This function is the database-side guardrail for RAG retrieval:
--   * subject_id filtering is mandatory and cannot be bypassed by callers
--   * cosine similarity threshold defaults to 0.78 and is enforced in SQL
--   * optional metadata filters support category / paper_code / year / session

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding vector(768),
  match_subject_id text,
  match_threshold double precision DEFAULT 0.78,
  match_top_k integer DEFAULT 5,
  match_category text DEFAULT NULL,
  match_paper_code text DEFAULT NULL,
  match_year integer DEFAULT NULL,
  match_session text DEFAULT NULL
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
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_top_k;
END;
$$;
