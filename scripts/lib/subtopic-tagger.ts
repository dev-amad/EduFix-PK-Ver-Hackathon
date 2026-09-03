/**
 * scripts/lib/subtopic-tagger.ts
 * -----------------------------------------------------------------------------
 * DETERMINISTIC, keyword-based `sub_topic` tagging for kb_chunks rows.
 *
 * WHY THIS WAS REWRITTEN (critical bug fix — cross-contamination):
 *   The previous version assigned sub_topic by EMBEDDING COSINE SIMILARITY
 *   (chunk vector vs. embedded sub-topic labels). That is fundamentally
 *   unreliable for near-identical historical events: the Battle of Badr
 *   (624 AD / 2 AH) and the Battle of Uhud (625 AD / 3 AH) share vocabulary
 *   (Quraysh, Muslims, martyrs, Madinah, the Prophet ﷺ), so their mark schemes
 *   are almost interchangeable in embedding space. Badr chunks were being
 *   tagged/retrieved alongside Uhud facts and vice-versa, corrupting generated
 *   notes with hallucinated casualties and martyrdoms.
 *
 *   VECTOR SIMILARITY IS NOW BANNED HERE. Tagging is 100% deterministic:
 *   exact, case-insensitive, WORD-BOUNDARY keyword matching against the chunk
 *   CONTENT and the SOURCE FILENAME. No embeddings, no API calls, no ambiguity,
 *   fully reproducible. A chunk earns a sub-topic tag ONLY when it contains
 *   that sub-topic's explicit keywords.
 *
 * ISOLATION GUARANTEE (product-owner directive):
 *   Any chunk containing the anchor term "Uhud" is NEVER tagged Badr — the
 *   Uhud rule `excludes` Badr. Combined with the STRICT `metadata @>` sub_topic
 *   containment filter (migration 0006), this makes "chunks containing Uhud are
 *   strictly excluded from Badr queries" — and, more generally, "zero chunks
 *   from outside the selected sub_topic enter the context" — literally true at
 *   the database layer for every granular Islamiyat / Pakistan Studies topic.
 *
 * COVERAGE: SUBTOPIC_KEYWORD_RULES now spans all 44 granular sub-topics in the
 *   product-defined Islamiyat (2058, 17) and Pakistan Studies (2059, 27) maps.
 *   Only rules whose slug exists in a subject's effective taxonomy are compiled
 *   for that subject, so islamiyat/pak-studies slugs can never leak onto urdu
 *   chunks (Urdu 3248 uses the broad syllabus-derived taxonomy and compiles
 *   zero rules — every Urdu chunk stays `general3248`).
 */
import { getEffectiveTaxonomy } from "@/lib/kb/subtopics";
import type { SubjectId } from "@/lib/subjects";

export interface SubTopicTagStats {
  /** Chunks tagged by an explicit keyword rule. */
  keyword: number;
  /** Chunks matching several rules equally -> left general (safety). */
  ambiguous: number;
  /** Chunks matching no rule -> `general<subject_code>`. */
  general: number;
}

export interface SubTopicTagger {
  readonly subjectCode: string;
  /** Number of deterministic keyword rules compiled for this subject. */
  readonly ruleCount: number;
  readonly stats: SubTopicTagStats;
  /**
   * Resolve the sub_topic tag for one chunk, deterministically.
   * @param content        the chunk text (primary keyword source)
   * @param sourceFilename original file name (secondary keyword source)
   */
  tagChunk(content: string, sourceFilename?: string): string;
}

/**
 * One deterministic tagging rule.
 *  - `keywords`: case-insensitive phrases; a chunk containing ANY of them is a
 *    candidate for `slug`.
 *  - `anchor`: the distinctive event name. When the anchor is present, every
 *    slug in `excludes` is vetoed (cannot be assigned to this chunk).
 *  - `excludes`: slugs suppressed by this rule's anchor (event isolation).
 */
export interface SubTopicKeywordRule {
  slug: string;
  anchor?: string;
  keywords: string[];
  excludes?: string[];
}

/**
 * The deterministic keyword table — one rule per granular sub-topic in the
 * product-defined Islamiyat (2058) and Pakistan Studies (2059) maps. Keywords
 * are matched with WORD BOUNDARIES (case-insensitive) over chunk content +
 * source filename, so short terms like "hind" (Hind bint Utbah, Uhud) never
 * match "behind"/"hindrance". Each rule carries a distinctive `anchor`; where
 * two events are notoriously confusable the rule also lists `excludes` so the
 * anchor vetoes the rival slug (event isolation). A chunk earns the slug whose
 * rule scores the MOST distinct keyword hits; an equal-top tie is genuinely
 * cross-cutting and is left `general<code>` (safe: never a wrong-topic tag).
 */
export const SUBTOPIC_KEYWORD_RULES: SubTopicKeywordRule[] = [
  // ── Islamiyat 2058 · Paper 1 — Life of the Prophet ﷺ ──────────────────────
  { slug: "conditions_pre_islamic_arabia", anchor: "jahiliyyah", keywords: ["jahiliyyah", "jahiliyya", "pre-islamic arabia", "pre-islamic", "arabia before islam", "before islam", "age of ignorance", "idol worship", "idolatry", "polytheism", "tribes of arabia", "social conditions of arabia", "condition of arabia", "makkah before islam"] },
  { slug: "early_life_and_pre_prophethood", anchor: "early life", keywords: ["early life", "before prophethood", "birth of the prophet", "570", "abdullah", "aminah", "halima", "foster mother", "orphan", "khadija", "caravan trade", "al-amin", "rebuilding of the kaaba"] },
  { slug: "call_to_prophethood_and_early_revelation", anchor: "revelation", keywords: ["first revelation", "cave hira", "cave of hira", "610", "jibril", "gabriel", "iqra", "wahy", "call to prophethood", "night of power", "lailat al-qadr", "recite"] },
  { slug: "early_preaching_secret_and_open", anchor: "secret preaching", keywords: ["secret preaching", "open preaching", "dar al-arqam", "dar arqam", "first converts", "earliest muslims", "warn your nearest kin", "mount safa", "three years of preaching"] },
  { slug: "persecution_of_prophet_and_early_muslims", anchor: "persecution", keywords: ["persecution", "torture", "bilal", "umayyah", "khabbab", "sumayya", "yasir", "abu lahab", "abuse of muslims", "martyrdom of sumayya"] },
  { slug: "migration_to_abbysinia", anchor: "abyssinia", keywords: ["abyssinia", "ethiopia", "negus", "najashi", "first migration", "migration to abyssinia", "615", "jafar", "quraish envoys", "king of abyssinia"] },
  { slug: "boycott_of_banu_hashim_and_year_of_sorrow", anchor: "boycott", keywords: ["boycott of banu hashim", "banu hashim", "shi ab", "year of sorrow", "619", "death of khadija", "death of abu talib", "three year boycott", "boycott document"] },
  { slug: "visit_to_taif_isra_wal_miraj_and_pledges_of_aqaba", anchor: "isra", keywords: ["taif", "isra", "miraj", "night journey", "al-aqsa", "aqaba", "pledge of aqaba", "first aqaba", "second aqaba", "journey to taif", "620", "621"] },
  { slug: "the_hijrah_to_madinah", anchor: "hijrah", keywords: ["hijrah", "hijra", "622", "yathrib", "cave thaur", "suraqa", "umm mabad", "quba", "arrival at madinah", "migration to madinah", "first islamic year"] },
  { slug: "establishment_of_community", anchor: "charter of madinah", keywords: ["charter of madinah", "madinah charter", "constitution of madinah", "brotherhood", "muwakhat", "muhajirun", "ansar", "mosque of the prophet", "masjid nabawi", "adhan", "change of qibla", "bait al-mal"] },
  { slug: "battle_of_badr_624ad", anchor: "badr", keywords: ["badr", "624 ad", "2 ah", "abu jahl", "14 martyrs", "313 muslims", "wells of badr"] },
  // Uhud EXCLUDES Badr: any chunk naming Uhud is barred from a Badr tag.
  { slug: "battle_of_uhud_625ad", anchor: "uhud", excludes: ["battle_of_badr_624ad"], keywords: ["uhud", "625 ad", "3 ah", "mount ainain", "archers", "70 martyrs", "hamza", "musab bin umayr", "abdullah bin jubayr", "hind"] },
  { slug: "battle_of_trench_khandaq_627ad", anchor: "trench", keywords: ["trench", "khandaq", "627", "5 ah", "salman farsi", "the ditch", "battle of the trench", "confederates", "ahzab", "siege of madinah"] },
  { slug: "treaties_and_jewish_tribes", anchor: "hudaibiyah", keywords: ["hudaibiyah", "hudaybiyah", "treaty of hudaibiyah", "6 ah", "jewish tribes", "banu qaynuqa", "banu nadir", "banu qurayza", "pledge of ridwan", "ten year truce"] },
  { slug: "conquest_of_khaybar_and_battle_of_mutah", anchor: "khaybar", keywords: ["khaybar", "mutah", "battle of mutah", "fortress of khaybar", "7 ah", "8 ah", "date palms of khaybar", "three commanders", "zaid bin haritha"] },
  { slug: "conquest_of_makkah_battle_of_hunain_and_tabuk", anchor: "conquest of makkah", keywords: ["conquest of makkah", "fath makkah", "630", "hunain", "tabuk", "idols destroyed", "clearing of the kaaba", "10000 muslims", "general amnesty", "battle of hunain", "expedition of tabuk"] },
  { slug: "farewell_pilgrimage_and_death_of_prophet", anchor: "farewell pilgrimage", keywords: ["farewell pilgrimage", "hajjat al-wida", "farewell sermon", "632", "10 ah", "arafat", "death of the prophet", "last sermon", "final pilgrimage", "demise of the prophet"] },

  // ── Pakistan Studies 2059 · Paper 1 — History (1906–1947) ─────────────────
  { slug: "partition_of_bengal_and_swadeshi_1905_1911", anchor: "partition of bengal", keywords: ["partition of bengal", "swadeshi", "1905", "lord curzon", "bengal partition", "annulment of bengal", "1911", "khwaja salimullah", "swadeshi movement"] },
  { slug: "simla_deputation_and_aiml_formation_1906", anchor: "simla deputation", keywords: ["simla deputation", "1906", "all india muslim league", "muslim league formation", "aiml", "dhaka", "nawab salimullah", "aga khan", "mohammedan educational conference"] },
  { slug: "morley_minto_reforms_1909", anchor: "morley-minto", keywords: ["morley-minto", "morley minto", "1909", "indian councils act 1909", "separate electorates", "lord minto", "councils act of 1909"] },
  { slug: "lucknow_pact_1916", anchor: "lucknow pact", keywords: ["lucknow pact", "1916", "lucknow", "congress-league pact", "joint electorates", "1916 agreement", "muslim league congress unity"] },
  { slug: "montagu_chelmsford_reforms_and_dyarchy_1919", anchor: "dyarchy", keywords: ["montagu-chelmsford", "montagu chelmsford", "1919", "dyarchy", "diarchy", "government of india act 1919", "montagu declaration", "august declaration", "reforms of 1919"] },
  { slug: "rowlatt_act_and_amritsar_massacre_1919", anchor: "amritsar", keywords: ["rowlatt", "amritsar", "jallianwala", "general dyer", "rowlatt act", "black act", "jallianwala bagh", "amritsar massacre", "rowlatt satyagraha"] },
  { slug: "khilafat_movement_and_hijrat_movement_1919_1924", anchor: "khilafat", keywords: ["khilafat", "hijrat", "hijrat movement", "ali brothers", "maulana muhammad ali", "maulana shaukat ali", "caliph", "khalifa", "ottoman", "turkey", "migration to afghanistan", "khilafat movement", "1924"] },
  { slug: "simon_commission_and_nehru_report_1927_1928", anchor: "simon commission", keywords: ["simon commission", "1927", "1928", "nehru report", "simon go back", "all-white commission", "motilal nehru", "statutory commission"] },
  { slug: "jinnah_14_points_1929", anchor: "14 points", keywords: ["14 points", "fourteen points", "jinnah's 14 points", "1929", "jinnah fourteen points", "response to nehru report"] },
  { slug: "allahabad_address_1930", anchor: "allahabad address", keywords: ["allahabad address", "allahabad", "1930", "iqbal", "allama iqbal", "separate muslim state", "north-western india", "allahabad speech"] },
  { slug: "round_table_conferences_and_communal_award_1930_1932", anchor: "round table", keywords: ["round table", "round table conference", "communal award", "1931", "1932", "first round table", "second round table", "third round table", "london conference"] },
  // "cambridge" was REMOVED from this rule: it matched the "Cambridge O Level" /
  // "PapaCambridge" watermark printed on EVERY paper, so rahmat_ali ballooned to
  // 669 chunks (52% of them 2059/02 Geography) and stole geography content away
  // from the Paper-2 pool. Only Rahmat Ali's distinctive phrases are kept.
  { slug: "rahmat_ali_and_now_or_never_1933", anchor: "now or never", keywords: ["rahmat ali", "choudhary rahmat ali", "now or never", "1933", "the word pakistan", "pakistan pamphlet"] },
  { slug: "government_of_india_act_1935", anchor: "government of india act 1935", keywords: ["government of india act 1935", "act of 1935", "1935", "provincial autonomy", "federation of india", "1935 act", "new constitution 1935"] },
  { slug: "elections_1937_and_congress_rule_1937_1939", anchor: "congress rule", keywords: ["elections 1937", "1937 elections", "congress rule", "congress ministries", "1937", "1939", "bande mataram", "resignation of congress ministries", "vidya mandir"] },
  { slug: "lahore_resolution_1940", anchor: "lahore resolution", keywords: ["lahore resolution", "pakistan resolution", "1940", "23 march 1940", "minarat-e-pakistan", "fazlul haq", "two nation theory", "resolution of 1940"] },
  { slug: "cripps_mission_and_quit_india_1942", anchor: "cripps mission", keywords: ["cripps mission", "cripps", "quit india", "1942", "do or die", "stafford cripps", "cripps proposals", "quit india movement"] },
  { slug: "gandhi_jinnah_talks_1944_and_simla_conference_1945", anchor: "gandhi-jinnah talks", keywords: ["gandhi-jinnah talks", "gandhi jinnah", "gandhi-jinnah", "1944", "bombay talks", "september 1944", "simla conference", "1945", "rajagopalachari", "c r formula", "rajagopalachari formula", "wavel", "simla hill conference"] },
  { slug: "elections_1945_1946_and_cabinet_mission_1946", anchor: "cabinet mission", keywords: ["elections 1945", "1945-46 elections", "1946", "cabinet mission", "grouping", "interim government", "cabinet mission plan", "direct action day"] },
  { slug: "3rd_june_plan_and_partition_1947", anchor: "3 june plan", keywords: ["3 june plan", "3rd june plan", "june plan", "1947", "mountbatten", "radcliffe", "radcliffe award", "independence act 1947", "partition of india"] },

  // ── Pakistan Studies 2059 · Paper 2 — Geography (Topography & Climate) ────
  { slug: "northern_and_western_mountains", anchor: "northern mountains", keywords: ["northern mountains", "western mountains", "himalaya", "karakoram", "hindu kush", "k2", "godwin austen", "siachen", "mountain ranges of pakistan", "khyber pass", "nanga parbat"] },
  { slug: "plateaus", anchor: "potwar", keywords: ["potwar", "potwar plateau", "balochistan plateau", "plateau", "salt range", "kirthar", "chagai", "upland plateau", "karez", "qanat"] },
  { slug: "indus_plains_and_delta", anchor: "indus plain", keywords: ["indus plain", "indus delta", "alluvial plain", "doab", "river indus", "indus basin", "upper indus", "lower indus", "delta of the indus", "canal irrigation", "irrigation canal", "canal", "perennial canal", "inundation canal"] },
  { slug: "deserts", anchor: "thar", keywords: ["thar", "thal", "kharan", "desert", "cholistan", "sand dunes", "deserts of pakistan", "tharparkar", "hamun", "playa"] },
  { slug: "climate_zones_and_seasons", anchor: "climatic zones", keywords: ["climate of pakistan", "climatic zones", "climate zones", "seasons", "monsoon season", "four seasons", "summer season", "winter season", "highland climate"] },
  { slug: "rainfall_sources", anchor: "rainfall", keywords: ["rainfall", "monsoon", "western disturbances", "cyclonic", "sources of rainfall", "precipitation", "monsoon rainfall", "rainfall in pakistan"] },
  { slug: "temperature_variations_and_factors", anchor: "temperature", keywords: ["temperature", "temperature variation", "altitude", "continentality", "factors affecting temperature", "temperature of pakistan", "mean temperature"] },
  { slug: "climatic_hazards", anchor: "climatic hazards", keywords: ["climatic hazards", "flood", "drought", "cyclone", "earthquake", "natural hazards", "floods in pakistan", "famine"] },
];

/** Escape a literal string for safe interpolation into a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a keyword into a case-insensitive, word-boundary regex. Internal
 * spaces become flexible whitespace runs so "624   AD" still matches "624 ad".
 */
function keywordRegex(keyword: string): RegExp {
  const body = keyword
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  return new RegExp(`\\b${body}\\b`, "i");
}

interface CompiledRule extends SubTopicKeywordRule {
  keywordPatterns: RegExp[];
  anchorPattern: RegExp | null;
}

function compileRule(rule: SubTopicKeywordRule): CompiledRule {
  return {
    ...rule,
    keywordPatterns: rule.keywords.map(keywordRegex),
    anchorPattern: rule.anchor ? keywordRegex(rule.anchor) : null,
  };
}

/**
 * Build a deterministic, per-subject tagger. Returns null only when the subject
 * code is unknown (nothing sensible to fall back to). Subjects whose taxonomy
 * contains none of the keyword rules still get a valid tagger that assigns
 * `general<subject_code>` to every chunk.
 */
export function createSubTopicTagger(
  subject: SubjectId,
  subjectCode: string
): SubTopicTagger | null {
  if (!subjectCode) return null;

  // Only compile rules whose slug is a real sub-topic for THIS subject, so
  // islamiyat's Badr/Uhud slugs can never be applied to pak-studies / urdu.
  const taxonomy = getEffectiveTaxonomy(subject);
  const validSlugs = new Set(
    (taxonomy?.papers.flatMap((paper) => paper.topics) ?? []).map((t) => t.id)
  );
  const rules = SUBTOPIC_KEYWORD_RULES.filter((rule) =>
    validSlugs.has(rule.slug)
  ).map(compileRule);

  const generalTag = `general${subjectCode}`;
  const stats: SubTopicTagStats = { keyword: 0, ambiguous: 0, general: 0 };

  return {
    subjectCode,
    ruleCount: rules.length,
    stats,
    tagChunk(content: string, sourceFilename = ""): string {
      // Single normalised haystack: content is the primary signal, the filename
      // is a secondary signal (e.g. "Islamiyat_Badr.pdf"). Whitespace collapsed
      // so multi-word keywords tolerate arbitrary spacing.
      const haystack = `${content ?? ""} ${sourceFilename ?? ""}`.replace(
        /\s+/g,
        " "
      );

      const matches: Array<{ rule: CompiledRule; hits: number }> = [];
      for (const rule of rules) {
        let hits = 0;
        for (const pattern of rule.keywordPatterns) {
          if (pattern.test(haystack)) hits++;
        }
        if (hits > 0) matches.push({ rule, hits });
      }

      if (matches.length === 0) {
        stats.general++;
        return generalTag;
      }

      // Event isolation: when a matched rule's ANCHOR is present, veto the slugs
      // it excludes. Uhud's anchor vetoes Badr -> a chunk naming Uhud is never
      // tagged Badr (the core anti-cross-contamination guarantee).
      const vetoed = new Set<string>();
      for (const match of matches) {
        if (match.rule.anchorPattern?.test(haystack)) {
          for (const excluded of match.rule.excludes ?? []) vetoed.add(excluded);
        }
      }
      const candidates = matches.filter((m) => !vetoed.has(m.rule.slug));
      if (candidates.length === 0) {
        stats.general++;
        return generalTag;
      }

      // Strongest match wins (most distinct keywords). A tie means the chunk is
      // genuinely cross-cutting, so leave it general rather than guess.
      candidates.sort((a, b) => b.hits - a.hits);
      if (candidates.length > 1 && candidates[0].hits === candidates[1].hits) {
        stats.ambiguous++;
        return generalTag;
      }

      stats.keyword++;
      return candidates[0].rule.slug;
    },
  };
}
