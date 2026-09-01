# EduFix PK — Phased Development Task Ledger

> **RULE FOR AGENT:** Complete tasks sequentially. Do NOT move to the next sub-task until the current one is tested and confirmed. Pause for user input on designated STOPPOINTS.

---

## Phase 1: Database Setup & Infrastructure Foundation
- [x] **Task 1.1:** Initialize Next.js 14/15 App Router project with TypeScript, Tailwind CSS, and Shadcn UI.
- [x] **Task 1.2:** Configure Supabase client and execute Section 6 database migration script (`pgvector`, `users`, `subjects`, `kb_documents`, `kb_chunks`, `practice_sessions`, `answer_submissions`).
- [x] **Task 1.3:** Insert seed data into the `subjects` table for:
  - `pak-studies` (Code: 2059)
  - `islamiyat` (Code: 2058)
  - `urdu` (Code: 3248)
- [x] **Task 1.4:** Create environment variable validation schema (`.env.example`) containing keys for Supabase, Gemini, and Groq.

---

## Phase 2: Knowledge Base Ingestion Pipeline (STOPPOINT REQUIRED)
> 🛑 **USER INTERACTION STOPPOINT 1:** The agent MUST pause here and ask the user:  
> *"Please provide the initial set of CAIE PDF/Text files for Pakistan Studies (2059), Islamiyat (2058), and Urdu (3248) in the `/knowledge-base-source` directory."*

- [x] **Task 2.1:** Create file directory structure: `/knowledge-base-source/[subject_code]/[category]`.
- [x] **Task 2.2:** Build Node.js / TypeScript ingestion script (`scripts/ingest-kb.ts`) to:
  - Parse PDFs/Text files from `/knowledge-base-source`.
  - Chunk documents with metadata (`subject_id`, `paper_code`, `year`, `session`, `category`).
  - Generate embeddings using Google Gemini `gemini-embedding-001` (768-dim, pinned via `outputDimensionality`).
  - Upsert vectors into Supabase `kb_chunks`.
- [x] **Task 2.3:** Implement a standalone vector search test function (`lib/rag/search.ts`) with strict metadata filtering (`subject_id`) and a cosine similarity threshold of `0.78`.

---

## Phase 3: Route Scaffolding & Context Guardrails
- [x] **Task 3.1:** Create dynamic folder structure under `app/`:
  - `app/[subject]/notes/page.tsx`
  - `app/[subject]/answer-assistant/page.tsx`
  - `app/[subject]/answer-checker/page.tsx`
- [x] **Task 3.2:** Implement global Top Navigation Bar (`components/nav/Navbar.tsx`) with:
  - Subject Switcher Dropdown (Pakistan Studies, Islamiyat, Urdu)
  - Module Segmented Control Tabs (Notes, Answering Assistant, Answer Checker)
- [x] **Task 3.3:** Implement Route Guard Utility (`lib/context-guard.ts`) to ensure subject-level context cannot leak between routes.

---

## Phase 4: Module 1 — AI Notes Generator (`/[subject]/notes`)
- [ ] **Task 4.1:** Build UI for Topic Selector (hierarchy: Subject -> Paper -> Topic) and Option Toggles (Timeline, Quranic Verses, Vocabulary, Examiner Pitfalls).
- [ ] **Task 4.2:** Build backend API route (`app/api/[subject]/notes/route.ts`) querying `kb_chunks` and streaming bulleted revision notes.
- [ ] **Task 4.3:** Add UI rendering for structured Note Cards with badge tags and PDF Export capability.

---

## Phase 5: Module 2 — Guided Answering Agent (`/[subject]/answer-assistant`)
- [ ] **Task 5.1:** Build Split-View UI: Question Input & Scaffolding Panel on the left, Rich-Text Student Workspace Editor on the right.
- [ ] **Task 5.2:** Build API route (`app/api/[subject]/answer-assistant/route.ts`) enforcing **System Prompt 7.1**.
- [ ] **Task 5.3:** Implement output validation middleware: Ensure responses contain ZERO paragraphs or long-form essays, throwing a fallback retry if full prose is generated.

---

## Phase 6: Module 3 — CAIE Strict Answer Checker & Vision OCR (`/[subject]/answer-checker`)
- [ ] **Task 6.1:** Build Submission UI with Dual Input Tabs (`Text Input` and `Handwritten Image Upload`).
- [ ] **Task 6.2:** Integrate Gemini Vision OCR API route (`app/api/ocr/route.ts`) to extract text from image uploads and provide an editable verification modal for students.
- [ ] **Task 6.3:** Build Grading API Route (`app/api/[subject]/answer-checker/route.ts`) implementing **System Prompt 7.2** to return structured JSON.
- [ ] **Task 6.4:** Build Evaluation Dashboard UI featuring:
  - Assigned Score Radial & CAIE Level Badge
  - Strengths (Green) & Weaknesses (Red/Yellow) Callouts
  - Plain English Feedback
  - Exemplar Full-Mark Answer Modal

---

## Phase 7: Verification, Urdu RTL Support & Polish
- [ ] **Task 7.1:** Add RTL support to the `/urdu/*` route components, switching layout alignment and fonts appropriately.
- [ ] **Task 7.2:** End-to-end evaluation testing against sample past paper questions across all 3 subjects.
