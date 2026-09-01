-- EduFix PK — RAG Vector Search Recall Fix
-- Migration 0004: drop ivfflat index to avoid missing nearest neighbors
--
-- The ivfflat index was created with lists = 100 and Supabase does not allow
-- raising ivfflat.probes. With the default probes = 1, ORDER BY embedding <=> query
-- can return only a tiny subset of candidates, which breaks threshold filtering.
-- For the current KB size, exact sequential search is fast enough and correct.

DROP INDEX IF EXISTS public.kb_chunks_embedding_idx;
