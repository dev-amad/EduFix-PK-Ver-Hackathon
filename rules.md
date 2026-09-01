# Qoder Agent Execution Rules — EduFix PK

## 1. Task Execution & Scope
- DO NOT attempt to generate the full project or multiple phases in one session.
- Process tasks EXCLUSIVELY one micro-task at a time as listed in `TASKS.md`.
- STOP AND PAUSE when reaching designated STOPPOINTS to request required Knowledge Base source files from the user.
- STRICTLY NO HARDCODED MOCK DATA for CAIE notes, marking schemes, or past papers.

## 2. Context Isolation & Architecture
- Maintain strict route-level context boundary: `/app/[subject]/[module]`
- Allowed `[subject]` values: `pak-studies`, `islamiyat`, `urdu`
- Allowed `[module]` values: `notes`, `answer-assistant`, `answer-checker`
- Enforce strict temperature control (`0.1`) on all LLM call handlers to minimize hallucination.

## 3. Tech Stack Constraints
- Next.js 14/15 (App Router, TypeScript, Tailwind CSS, Shadcn UI)
- Database & Vectors: Supabase PostgreSQL + pgvector
- Embeddings: Google Gemini `gemini-embedding-001` (768-dim, pinned via `outputDimensionality`)
- Primary LLM: Groq via `groq-sdk` (default `openai/gpt-oss-120b`, temperature 0.1)
- Vision/OCR: Google Gemini `gemini-2.5-flash`

## 4. UI/UX Rules
- Primary Palette: Emerald/Green (Pakistani EdTech theme).
- RTL Support: Mandatory for all `/urdu/*` components via `dir="rtl"`.
- Module 2 Guardrail: Never expose complete continuous essays in the Answering Assistant—bullet points and structural scaffolding only.
