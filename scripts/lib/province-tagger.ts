/**
 * scripts/lib/province-tagger.ts
 * -----------------------------------------------------------------------------
 * DETERMINISTIC, keyword-based `province` tagging for Pakistan Studies (2059)
 * kb_chunks — the metadata counterpart to the SPATIAL BOUNDARY MATRIX injected
 * into the 2059/02 Geography system prompt.
 *
 * WHY: Geography notes were mixing landforms across provincial boundaries (e.g.
 * placing the Kharan Desert in Sindh, or the Thar in Balochistan). This tagger
 * stamps each chunk with the province its place-names belong to, so the
 * `metadata.province` key records the correct regional bucket for inspection
 * and downstream verification. It is intentionally SEPARATE from sub_topic
 * tagging and never affects retrieval isolation.
 *
 * METHOD (identical discipline to subtopic-tagger.ts — NO embeddings, NO API
 * calls, fully reproducible): exact, case-insensitive, WORD-BOUNDARY keyword
 * matching over the chunk CONTENT + SOURCE FILENAME. A chunk earns the province
 * whose rule scores the MOST distinct keyword hits; an equal-top tie (genuinely
 * cross-province content) or no match yields `undefined` — no province key is
 * written, because we NEVER guess a boundary.
 *
 * KEYWORDS follow the product-owner's Fix #2 spec, plus a few obvious spelling
 * variants (Chagai/Chaghai, Suleiman/Sulaiman, Hindu Kush/Hindukush,
 * Potwar/Potowar, Karakoram/Karakorum, Himalaya/Himalayas) so recall is not
 * lost to orthography. Bare "indus" is deliberately NOT a keyword: only the
 * directional phrases ("lower indus plain" = Sindh, "upper indus plain" =
 * Punjab) are used, so the shared river name never creates a false match.
 */

/** The four provincial / regional buckets used by the 2059/02 matrix. */
export type Province = "balochistan" | "sindh" | "punjab" | "kpk_north";

export interface ProvinceKeywordRule {
  province: Province;
  keywords: string[];
}

/**
 * The deterministic province keyword table (Fix #2 spec + spelling variants).
 */
export const PROVINCE_KEYWORD_RULES: ProvinceKeywordRule[] = [
  {
    province: "balochistan",
    keywords: [
      "kharan",
      "chaghai",
      "chagai",
      "makran",
      "sulaiman",
      "suleiman",
      "quetta",
    ],
  },
  {
    province: "sindh",
    keywords: [
      "thar",
      "tharparkar",
      "indus delta",
      "delta of the indus",
      "kirthar",
      "lower indus plain",
      "lower indus",
    ],
  },
  {
    province: "punjab",
    keywords: [
      "thal",
      "cholistan",
      "potwar",
      "potowar",
      "salt range",
      "upper indus plain",
      "upper indus",
    ],
  },
  {
    province: "kpk_north",
    keywords: [
      "karakoram",
      "karakorum",
      "hindu kush",
      "hindukush",
      "himalaya",
      "himalayas",
      "swat",
      "gilgit",
    ],
  },
];

export interface ProvinceTagStats {
  balochistan: number;
  sindh: number;
  punjab: number;
  kpk_north: number;
  /** Matched two+ provinces equally -> left untagged (safety, never guess). */
  ambiguous: number;
  /** Matched no province keyword -> untagged. */
  untagged: number;
}

export interface ProvinceTagger {
  /** Number of deterministic province rules compiled. */
  readonly ruleCount: number;
  readonly stats: ProvinceTagStats;
  /**
   * Resolve the province for one chunk, deterministically. Returns `undefined`
   * when the chunk matches no province keyword, or ties across provinces.
   * @param content        the chunk text (primary keyword source)
   * @param sourceFilename original file name (secondary keyword source)
   */
  tagChunk(content: string, sourceFilename?: string): Province | undefined;
}

/** Escape a literal string for safe interpolation into a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a keyword into a case-insensitive, word-boundary regex. Internal
 * spaces become flexible whitespace runs so "lower  indus" still matches.
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

interface CompiledProvinceRule extends ProvinceKeywordRule {
  keywordPatterns: RegExp[];
}

/**
 * Build the deterministic province tagger. Subject-agnostic: the keywords are
 * Pakistan-geography-specific, so callers apply it to pak-studies chunks, but
 * it is safe on any text (non-geography content simply matches nothing).
 */
export function createProvinceTagger(): ProvinceTagger {
  const rules: CompiledProvinceRule[] = PROVINCE_KEYWORD_RULES.map((rule) => ({
    ...rule,
    keywordPatterns: rule.keywords.map(keywordRegex),
  }));

  const stats: ProvinceTagStats = {
    balochistan: 0,
    sindh: 0,
    punjab: 0,
    kpk_north: 0,
    ambiguous: 0,
    untagged: 0,
  };

  return {
    ruleCount: rules.length,
    stats,
    tagChunk(content: string, sourceFilename = ""): Province | undefined {
      // Single normalised haystack: content is the primary signal, the filename
      // a secondary one. Whitespace collapsed so multi-word keywords tolerate
      // arbitrary spacing.
      const haystack = `${content ?? ""} ${sourceFilename ?? ""}`.replace(
        /\s+/g,
        " "
      );

      const matches: Array<{ province: Province; hits: number }> = [];
      for (const rule of rules) {
        let hits = 0;
        for (const pattern of rule.keywordPatterns) {
          if (pattern.test(haystack)) hits++;
        }
        if (hits > 0) matches.push({ province: rule.province, hits });
      }

      if (matches.length === 0) {
        stats.untagged++;
        return undefined;
      }

      // Strongest match wins (most distinct keywords). A tie means the chunk is
      // genuinely cross-province, so leave it untagged rather than guess.
      matches.sort((a, b) => b.hits - a.hits);
      if (matches.length > 1 && matches[0].hits === matches[1].hits) {
        stats.ambiguous++;
        return undefined;
      }

      const winner = matches[0].province;
      stats[winner]++;
      return winner;
    },
  };
}
