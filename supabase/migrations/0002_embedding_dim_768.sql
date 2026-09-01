-- EduFix PK — Embedding Dimension Resize
-- Migration 0002: 1536 (OpenAI text-embedding-3-small) -> 768 (Gemini text-embedding-004)
--
-- The ivfflat index depends on the column's dimensionality, so it must be
-- dropped before ALTER COLUMN TYPE and rebuilt afterwards.

-- Drop the dimension-bound vector index
DROP INDEX IF EXISTS kb_chunks_embedding_idx;

-- Resize the embedding column to Gemini's 768 dimensions
ALTER TABLE kb_chunks ALTER COLUMN embedding TYPE vector(768);

-- Rebuild the vector index at the new dimensionality
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
