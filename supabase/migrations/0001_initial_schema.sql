-- EduFix PK — Initial Schema (PRD Section 6)
-- Migration 0001: pgvector + core tables

-- Enable Vector Extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Subjects Table
CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY, -- 'pak-studies', 'islamiyat', 'urdu'
  name TEXT NOT NULL,
  code TEXT NOT NULL -- '2059', '2058', '3248'
);

-- Knowledge Base Documents
CREATE TABLE IF NOT EXISTS kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id TEXT REFERENCES subjects(id),
  category TEXT NOT NULL, -- 'marking_scheme', 'examiner_report', 'past_paper', 'notes', 'syllabus'
  paper_code TEXT, -- e.g., '2059/01'
  year INT,
  session TEXT, -- 'May/June', 'Oct/Nov'
  title TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Knowledge Base Chunks with Vector Embeddings
CREATE TABLE IF NOT EXISTS kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES kb_documents(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL, -- { topic: 'War of Independence', command_word: 'Explain', mark_allocation: 7 }
  embedding VECTOR(1536) -- OpenAI embedding dimension
);

-- Index for Fast Vector Search
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Student Practice Sessions
CREATE TABLE IF NOT EXISTS practice_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  subject_id TEXT REFERENCES subjects(id),
  module_type TEXT NOT NULL, -- 'notes', 'answer-assistant', 'answer-checker'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Submissions & Evaluations (Answer Checker)
CREATE TABLE IF NOT EXISTS answer_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES practice_sessions(id),
  question_text TEXT NOT NULL,
  student_answer_text TEXT NOT NULL,
  submission_image_url TEXT,
  assigned_mark INT,
  total_mark INT,
  assigned_level TEXT,
  feedback_json JSONB, -- { strengths: [], weaknesses: [], plain_english_summary: "", exemplar_answer: "" }
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Strict context-isolation support: metadata filters always accompany subject_id,
-- so lookups stay O(log n) per subject partition.
CREATE INDEX IF NOT EXISTS kb_chunks_subject_idx ON kb_chunks (subject_id);
CREATE INDEX IF NOT EXISTS kb_chunks_metadata_gin ON kb_chunks USING gin (metadata);
