$path = 'C:\Users\Ammaaru\Downloads\EduFix_PK_PRD.md'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)

$new42 = @(
'#### 4.2 Key Features & UI Workflow',
'1. **Topic Selector:** Dropdown hierarchy: `Subject` -> `Paper / Component` -> `Chapter / Topic`. The **only** user inputs are the paper/component and the topic — there are no content configuration switches.',
'2. **Generate:** A single action triggers retrieval and structured note-card generation.',
'3. **Output Format:**',
'   - Visual summary card layout.',
'   - Clean bullet points with bold CAIE terminology.',
'   - One-click PDF download or copy-to-clipboard.',
'',
'**Always-On Subject Intelligence (No User Configuration)**',
'',
'The Notes Generator automatically and unconditionally includes every subject-essential element in every response. There are **no user-facing toggles or parameters**; the included elements are determined solely by the active subject route. The exact mapping is:',
'',
'- `pak-studies` (2059): Core exam-focused points + **Key Dates & Timeline** + **Common Examiner Pitfalls**.',
'- `islamiyat` (2058): Core exam-focused points + **Relevant Quranic Verses & Hadith References** (with surah/verse or narration attribution when present in retrieved context) + **Common Examiner Pitfalls**.',
'- `urdu` (3248): Core exam-focused points + **Advanced Vocabulary & Idioms (محاورات)** + **Common Examiner Pitfalls**.',
'',
'Rules governing always-on behaviour:',
'- (a) The student never toggles these elements; they are auto-selected purely by the active subject route.',
'- (b) A section is omitted only when the retrieved knowledge-base context genuinely contains no grounded material for it. In that case the section is dropped silently rather than fabricated.',
'- (c) This rule is subordinate to the zero-hallucination guardrails: "always-on" means "always attempted from retrieved context", never "always invented".'
)

$new82 = @(
'- **Notes Generator Page:**',
'  - Sidebar for syllabus chapter hierarchy.',
'  - Main panel displaying collapsible note cards with key terminology badge tags.',
'  - No note parameter or toggle panel is present; subject-essential sections are injected automatically by subject route (see Section 4.2).'
)

$revision = @(
'',
'---',
'',
'## Revision History',
'',
'- **2026-09-02** — Module 1 Notes Generator: removed all user-facing note parameter toggles; subject-essential elements (dates/timelines, Quranic verses & Hadith, vocabulary & idioms, examiner pitfalls) are now always-on and auto-selected by subject route.'
)

# Guard: verify anchors before splicing
if ($lines[99] -ne '#### 4.2 Key Features & UI Workflow') { throw "Anchor 4.2 mismatch: $($lines[99])" }
if ($lines[101] -ne '2. **Custom Note Parameters:** Toggle options:') { throw "Toggle anchor mismatch: $($lines[101])" }
if ($lines[329] -ne '- **Notes Generator Page:**') { throw "Anchor 8.2 mismatch: $($lines[329])" }

$out = @()
$out += $lines[0..98]
$out += $new42
$out += $lines[110..328]
$out += $new82
$out += $lines[332..349]
$out += $revision

$text = ($out -join "`r`n")
[System.IO.File]::WriteAllText($path, $text, $utf8)
Write-Output "DONE lines_in=$($lines.Count) lines_out=$($out.Count)"
