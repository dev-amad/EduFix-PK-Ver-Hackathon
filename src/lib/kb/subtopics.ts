/**
 * Product-defined 3-tier sub-topic taxonomy for the Notes module.
 *
 *   [Subject (route)] -> [Paper / Section] -> [Category] -> [Sub-Topic]
 *
 * IMPORTANT — what this file is and is not:
 *   • It is a NAVIGATION map: display labels + stable slugs the student picks
 *     from. It contains NO authored CAIE facts, answers, dates or mark schemes
 *     (rules.md §1). Every factual note is still produced at runtime from the
 *     retrieved knowledge base.
 *   • The slugs are NOT database metadata tags. The kb_chunks rows carry only
 *     subject_id / category / paper_code / year / session (verified against the
 *     live DB), so there is nothing to hard-filter on. Instead the selected
 *     sub-topic label + slug drive a targeted *semantic* query (query-side
 *     scoping) in the notes API route.
 *
 * Subjects not listed here (e.g. Urdu 3248) fall back to the syllabus-derived
 * taxonomy in topics.json — see getEffectiveTaxonomy().
 */

import {
  getTopicTaxonomy,
  type PaperOption,
  type SubjectTaxonomy,
  type TopicOption,
} from "@/lib/kb/topics";
import type { SubjectId } from "@/lib/subjects";

export interface SubTopic {
  /** Student-facing display name (also the primary semantic-query signal). */
  label: string;
  /** Stable identifier sent to the API as `topicId`. */
  slug: string;
}

export interface SubTopicCategory {
  id: string;
  /** Rendered as a group header in the sub-topic dropdown. "" = ungrouped. */
  label: string;
  subTopics: SubTopic[];
}

export interface SubTopicSection {
  /** Paper/section id, matching the topics.json convention ("1", "2"). */
  id: string;
  label: string;
  categories: SubTopicCategory[];
}

export interface SubjectSubTopicMap {
  subjectCode: string;
  sections: SubTopicSection[];
}

/**
 * The strict mapping supplied by the product owner. Islamiyat is scoped to
 * Paper 1 (Life of the Prophet ﷺ); Pakistan Studies to Paper 1 History
 * (Section 2: 1906–1947) and Paper 2 Geography (Topography & Climate).
 */
export const SUBTOPIC_MAPS: Partial<Record<SubjectId, SubjectSubTopicMap>> = {
  islamiyat: {
    subjectCode: "2058",
    sections: [
      {
        id: "1",
        label: "Paper 1 — Life of the Prophet (PBUH)",
        categories: [
          {
            id: "life-in-makkah",
            label: "Life in Makkah",
            subTopics: [
              { label: "Pre-Islamic Arabia (Jahiliyyah)", slug: "conditions_pre_islamic_arabia" },
              { label: "Early Life & Pre-Prophethood", slug: "early_life_and_pre_prophethood" },
              { label: "Call to Prophethood & Revelation", slug: "call_to_prophethood_and_early_revelation" },
              { label: "Early Preaching (Secret & Open)", slug: "early_preaching_secret_and_open" },
              { label: "Persecution of Early Muslims", slug: "persecution_of_prophet_and_early_muslims" },
              { label: "Migration to Abyssinia", slug: "migration_to_abbysinia" },
              { label: "Boycott of Banu Hashim & Year of Sorrow", slug: "boycott_of_banu_hashim_and_year_of_sorrow" },
              { label: "Visit to Ta'if, Isra wal Mi'raj & Pledges of Aqaba", slug: "visit_to_taif_isra_wal_miraj_and_pledges_of_aqaba" },
            ],
          },
          {
            id: "life-in-madinah",
            label: "Life in Madinah",
            subTopics: [
              { label: "The Hijrah to Madinah", slug: "the_hijrah_to_madinah" },
              { label: "Establishment of Community & Charter", slug: "establishment_of_community" },
              { label: "Battle of Badr (624 AD)", slug: "battle_of_badr_624ad" },
              { label: "Battle of Uhud (625 AD)", slug: "battle_of_uhud_625ad" },
              { label: "Battle of Trench / Khandaq (627 AD)", slug: "battle_of_trench_khandaq_627ad" },
              { label: "Treaties & Jewish Tribes", slug: "treaties_and_jewish_tribes" },
              { label: "Conquest of Khaybar & Battle of Mu'tah", slug: "conquest_of_khaybar_and_battle_of_mutah" },
              { label: "Conquest of Makkah, Hunain & Tabuk", slug: "conquest_of_makkah_battle_of_hunain_and_tabuk" },
              { label: "Farewell Pilgrimage & Death", slug: "farewell_pilgrimage_and_death_of_prophet" },
            ],
          },
        ],
      },
    ],
  },

  "pak-studies": {
    subjectCode: "2059",
    sections: [
      {
        id: "1",
        label: "Paper 1 — History (1906–1947)",
        categories: [
          {
            // Single, unlabeled category: Paper 1 History is a flat sub-topic list.
            id: "history-1906-1947",
            label: "",
            subTopics: [
              { label: "Partition of Bengal & Swadeshi (1905–1911)", slug: "partition_of_bengal_and_swadeshi_1905_1911" },
              { label: "Simla Deputation & AIML Formation (1906)", slug: "simla_deputation_and_aiml_formation_1906" },
              { label: "Morley-Minto Reforms (1909)", slug: "morley_minto_reforms_1909" },
              { label: "Lucknow Pact (1916)", slug: "lucknow_pact_1916" },
              { label: "Montagu-Chelmsford Reforms & Dyarchy (1919)", slug: "montagu_chelmsford_reforms_and_dyarchy_1919" },
              { label: "Rowlatt Act & Amritsar Massacre (1919)", slug: "rowlatt_act_and_amritsar_massacre_1919" },
              { label: "Khilafat & Hijrat Movement (1919–1924)", slug: "khilafat_movement_and_hijrat_movement_1919_1924" },
              { label: "Simon Commission & Nehru Report (1927–1928)", slug: "simon_commission_and_nehru_report_1927_1928" },
              { label: "Jinnah's 14 Points (1929)", slug: "jinnah_14_points_1929" },
              { label: "Allahabad Address (1930)", slug: "allahabad_address_1930" },
              { label: "Round Table Conferences & Communal Award (1930–1932)", slug: "round_table_conferences_and_communal_award_1930_1932" },
              { label: "Rahmat Ali & 'Now or Never' (1933)", slug: "rahmat_ali_and_now_or_never_1933" },
              { label: "Government of India Act (1935)", slug: "government_of_india_act_1935" },
              { label: "Elections 1937 & Congress Rule (1937–1939)", slug: "elections_1937_and_congress_rule_1937_1939" },
              { label: "Lahore Resolution (1940)", slug: "lahore_resolution_1940" },
              { label: "Cripps Mission & Quit India (1942)", slug: "cripps_mission_and_quit_india_1942" },
              { label: "Gandhi-Jinnah Talks & Simla Conference (1944–1945)", slug: "gandhi_jinnah_talks_1944_and_simla_conference_1945" },
              { label: "Elections 1945–46 & Cabinet Mission (1946)", slug: "elections_1945_1946_and_cabinet_mission_1946" },
              { label: "3rd June Plan & Partition (1947)", slug: "3rd_june_plan_and_partition_1947" },
            ],
          },
        ],
      },
      {
        id: "2",
        label: "Paper 2 — Geography (Topography & Climate)",
        categories: [
          {
            id: "topography",
            label: "Topography (Landforms & Drainage)",
            subTopics: [
              { label: "Northern & Western Mountains", slug: "northern_and_western_mountains" },
              { label: "Potwar & Balochistan Plateaus", slug: "plateaus" },
              { label: "Indus Plains & Delta", slug: "indus_plains_and_delta" },
              { label: "Deserts (Thar, Thal, Kharan)", slug: "deserts" },
            ],
          },
          {
            id: "climate",
            label: "Climate & Weather Hazards",
            subTopics: [
              { label: "Climate Zones & Seasons", slug: "climate_zones_and_seasons" },
              { label: "Rainfall Sources (Monsoon, Western Disturbances)", slug: "rainfall_sources" },
              { label: "Temperature Variations & Factors", slug: "temperature_variations_and_factors" },
              { label: "Climatic Hazards (Floods, Droughts, Cyclones)", slug: "climatic_hazards" },
            ],
          },
        ],
      },
    ],
  },
};

/** True when a subject has a product-defined granular sub-topic map. */
export function hasSubTopicMap(subject: SubjectId): boolean {
  return SUBTOPIC_MAPS[subject] !== undefined;
}

/**
 * Flatten a sub-topic map into the shared SubjectTaxonomy shape so the existing
 * selector + route plumbing works unchanged. Category labels become each topic's
 * optional `group` (empty label -> ungrouped).
 */
export function subTopicMapToTaxonomy(map: SubjectSubTopicMap): SubjectTaxonomy {
  const papers: PaperOption[] = map.sections.map((section) => ({
    id: section.id,
    title: section.label,
    topics: section.categories.flatMap<TopicOption>((category) =>
      category.subTopics.map((subTopic) => ({
        id: subTopic.slug,
        title: subTopic.label,
        group: category.label.length > 0 ? category.label : undefined,
      }))
    ),
  }));

  return {
    syllabus_file: `product sub-topic map (${map.subjectCode})`,
    papers,
  };
}

/** The granular sub-topic taxonomy for a subject, or undefined if it has none. */
export function getSubTopicTaxonomy(
  subject: SubjectId
): SubjectTaxonomy | undefined {
  const map = SUBTOPIC_MAPS[subject];
  return map ? subTopicMapToTaxonomy(map) : undefined;
}

/**
 * The taxonomy the Notes module should actually use: the product-defined
 * granular sub-topic map when one exists, otherwise the syllabus-derived
 * topics.json taxonomy (e.g. Urdu).
 */
export function getEffectiveTaxonomy(
  subject: SubjectId
): SubjectTaxonomy | undefined {
  return getSubTopicTaxonomy(subject) ?? getTopicTaxonomy(subject);
}

/**
 * Turn a sub-topic slug into extra semantic-query keywords, e.g.
 * "battle_of_badr_624ad" -> "battle of badr 624ad". Strengthens query-side
 * scoping without needing any database metadata tag.
 */
export function slugToQueryKeywords(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}
