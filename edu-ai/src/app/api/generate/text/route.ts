import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { searchCurriculum, compressCurriculumContext } from "@/lib/curriculum-rag";

export const runtime = "nodejs";

const COLUMNS_CARD = `each card: {label, description (1 sentence), imageQuery (English)}`;

function buildCategorySlideSequence(
  topicType: string,
  structureItems: string[],
  isPrimary: boolean
): string {
  switch (topicType) {
    case "collection": {
      const items = structureItems.slice(0, 6);
      const compSlide = items.length + 3;
      const itemLines = items.length > 0
        ? items.map((item, i) => `  ${i + 3}. fact or explanation — "${item}"`).join("\n") +
          `\n  ${compSlide <= 9 ? compSlide : 9}. comparison — two most contrasting subjects`
        : `  3–8. fact or explanation — one slide per subject\n  9. comparison — two most contrasting subjects`;
      return `Slide sequence — COLLECTION (exactly 10 slides):
  1. intro
  2. columns (MANDATORY) — one card per subject; ${COLUMNS_CARD}
${itemLines}
  10. recap`;
    }

    case "process": {
      const items = structureItems.slice(0, 5);
      const quizSlide = items.length + 4;
      const stepLines = items.length > 0
        ? items.map((step, i) => `  ${i + 4}. explanation — step ${i + 1}: "${step}"`).join("\n") +
          `\n  ${quizSlide <= 9 ? quizSlide : 9}. quiz (no image)`
        : `  4–8. explanation — one slide per step\n  9. quiz (no image)`;
      return `Slide sequence — PROCESS (exactly 10 slides):
  1. intro
  2. explanation — overview
  3. columns (MANDATORY) — 3–4 stages as cards; ${COLUMNS_CARD}
${stepLines}
  10. recap`;
    }

    case "narrative": {
      const items = structureItems.slice(0, 5);
      const reflectSlide = items.length + 4;
      const phaseLines = items.length > 0
        ? items.map((phase, i) => `  ${i + 4}. ${i % 2 === 0 ? "explanation" : "fact"} — "${phase}"`).join("\n") +
          `\n  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection (no image)`
        : `  4–8. explanation or fact — one slide per phase/milestone\n  9. reflection (no image)`;
      return `Slide sequence — NARRATIVE (exactly 10 slides):
  1. intro
  2. explanation — historical context
  3. columns (MANDATORY) — 3–4 key people/places/milestones as cards; ${COLUMNS_CARD}
${phaseLines}
  10. recap`;
    }

    case "comparison": {
      const thingA = structureItems[0] ?? "Subject A";
      const thingB = structureItems[1] ?? "Subject B";
      const compStyle = isPrimary ? "side-by-side visual comparison" : "analytical comparison";
      return `Slide sequence — COMPARISON (exactly 10 slides):
  1. intro — introduce "${thingA}" and "${thingB}"
  2. explanation — background context
  3. columns (MANDATORY) — 3–4 comparison dimensions as cards; ${COLUMNS_CARD}
  4. explanation — deep dive: "${thingA}"
  5. explanation — deep dive: "${thingB}"
  6. comparison (${compStyle}) — similarities
  7. comparison (${compStyle}) — differences
  8. comparison (${compStyle}) — strengths & weaknesses
  9. quiz (no image)
  10. recap`;
    }

    case "cause-effect": {
      const items = structureItems.slice(0, 4);
      const compSlide = items.length + 4;
      const reflectSlide = items.length + 5;
      const causeLines = items.length > 0
        ? items.map((item, i) => `  ${i + 4}. ${i < Math.ceil(items.length / 2) ? "explanation" : "fact"} — "${item}"`).join("\n") +
          `\n  ${compSlide <= 8 ? compSlide : 8}. comparison — key cause vs. key effect` +
          `\n  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection (no image)`
        : `  4–7. explanation or fact — one slide per cause or effect\n  8. comparison — key cause vs. key effect\n  9. reflection (no image)`;
      return `Slide sequence — CAUSE-EFFECT (exactly 10 slides):
  1. intro
  2. explanation — background context
  3. columns (MANDATORY) — 3–4 main causes as cards; ${COLUMNS_CARD}
${causeLines}
  10. recap`;
    }

    case "formula": {
      const items = structureItems.slice(0, 5);
      let itemLines: string;
      if (items.length > 0) {
        const itemSlides = items.map((item, i) => `  ${i + 4}. explanation — "${item}": exact notation + 2–3 examples`).join("\n");
        const lastItemSlide = items.length + 3; // item i maps to slide i+4; last = items.length-1+4 = items.length+3
        const gapSlides: string[] = [];
        for (let s = lastItemSlide + 1; s <= 8; s++) {
          gapSlides.push(`  ${s}. example — additional worked example applying the formula`);
        }
        itemLines = itemSlides + (gapSlides.length > 0 ? "\n" + gapSlides.join("\n") : "");
      } else {
        itemLines = `  4–8. explanation — one slide per form/rule/component`;
      }
      return `Slide sequence — FORMULA/RULE (exactly 10 slides):
  1. intro
  2. explanation — NOTATION slide: primary/canonical notation only (one form, one line); each variant gets its own slide
  3. columns (MANDATORY) — one card per component; ${COLUMNS_CARD}; imageQuery = metaphorical scene
${itemLines}
  9. quiz (no image)
  10. recap — full notation + usage rules`;
    }

    default: // single-subject
      return `Slide sequence — SINGLE-SUBJECT (exactly 10 slides):
  1. intro
  2. explanation — define the subject
  3. columns (MANDATORY) — 3–4 key features as cards; ${COLUMNS_CARD}
  4. fact
  5. example
  6. explanation — deeper layer
  7. fact
  8. example
  9. quiz (no image)
  10. recap`;
  }
}

// ── Per-category slide content schemas ───────────────────────────────────────
// Each category has a distinct JSON shape per slide type so every deck feels
// structurally different and is optimised for teaching that content type.
// The cheap gpt-4.1-nano pre-pass sets `topicType`; these schemas drive the
// per-slide content calls in phase 2.

const CATEGORY_SLIDE_SCHEMAS: Record<
  string,
  Record<string, { schemaHint: string; contentRules: string }>
> = {
  formula: {
    intro: {
      schemaHint: `{"mainParagraph":"string","lessonAimText":["string","string","string"]}`,
      contentRules: [
        `- mainParagraph: 2–3 sentences hooking the student into WHY this formula or rule matters; mention the notation or domain explicitly; use **bold** for the formula name`,
        `- lessonAimText: exactly 3 lesson aims each starting with an action verb (e.g. "Understand...", "Apply...", "Recognise..."); max 12 words each`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"notation":"string","notationBreakdown":"string"}`,
      contentRules: [
        `- notation: the CORRECT, complete formula or rule in canonical form — for grammar tenses ALWAYS lead with the AFFIRMATIVE (positive) form first, then negative, then interrogative/question (e.g. for Past Simple: "**Subject** + **V2**" affirmative first, then "**Subject** + **did not** + **base verb**" negative, then "**Did** + **subject** + **base verb**?" question); for math/science write components in standard left-to-right order (e.g. "a² + b² = c²"); double-check correctness before returning; wrap each component in **bold**`,
        `- notationBreakdown: 3–4 sentences unpacking what each component means with at least 1 worked example inline; use **bold** for component names`,
      ].join("\n"),
    },
    example: {
      schemaHint: `{"usageCase":"string","workedSteps":["string","string","string"]}`,
      contentRules: [
        `- usageCase: 1 sentence naming the specific scenario (e.g. "Finding the hypotenuse of a right-angled triangle" or "Describing a past action that has a present result")`,
        `- workedSteps: exactly 3 numbered steps showing the formula applied step-by-step; bold the formula components at each step; max 20 words per step`,
      ].join("\n"),
    },
    recap: {
      schemaHint: `{"fullNotation":"string","usageRules":["string","string","string"]}`,
      contentRules: [
        `- fullNotation: the complete formula/rule in its final canonical form, exactly as introduced on slide 2`,
        `- usageRules: 3 concise rules or tips for applying this formula correctly; start each with a verb; max 15 words each`,
      ].join("\n"),
    },
  },

  process: {
    intro: {
      schemaHint: `{"hook":"string","aimPoints":["string","string"]}`,
      contentRules: [
        `- hook: 1–2 engaging sentences that spark curiosity about this process; include a surprising fact or vivid analogy`,
        `- aimPoints: exactly 2 things the student will understand by the end; start each with "You will..." or "By the end..."; max 14 words each`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"stepName":"string","whatHappens":"string","whyItMatters":"string"}`,
      contentRules: [
        `- stepName: the name of this step in the process (e.g. "Evaporation", "Condensation", "Filtration")`,
        `- whatHappens: 2–3 sentences describing exactly what occurs in this step; use **bold** for key terms and named substances/agents`,
        `- whyItMatters: 1 sentence explaining why this step is critical to the overall process`,
      ].join("\n"),
    },
    recap: {
      schemaHint: `{"sequence":["string","string","string"],"keyTakeaway":"string"}`,
      contentRules: [
        `- sequence: 3–5 items listing the process steps in order, each as a brief label (max 6 words); reinforces the full sequence`,
        `- keyTakeaway: 1 memorable sentence capturing the most important insight about this process; use **bold** for the core concept`,
      ].join("\n"),
    },
  },

  narrative: {
    intro: {
      schemaHint: `{"hook":"string","timeSpan":"string","significance":"string"}`,
      contentRules: [
        `- hook: 1–2 gripping sentences placing the student in the historical moment or highlighting its drama`,
        `- timeSpan: a concise phrase giving the time period (e.g. "1789–1799" or "Ancient Greece, 5th century BCE")`,
        `- significance: 1 sentence explaining why this story still matters today; use **bold** for the key theme`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"period":"string","event":"string","impact":"string"}`,
      contentRules: [
        `- period: a short time label (e.g. "1914–1918", "Early Renaissance")`,
        `- event: 2–3 sentences describing what happened in this phase or milestone; use **bold** for key names and dates`,
        `- impact: 1 sentence explaining the direct consequence or change this event caused`,
      ].join("\n"),
    },
    fact: {
      schemaHint: `{"headline":"string","moment":"string","legacy":"string"}`,
      contentRules: [
        `- headline: a striking, newspaper-style statement about this historical fact; max 18 words`,
        `- moment: 2 sentences giving the specific detail, date, or context; use **bold** for names and dates`,
        `- legacy: 1 sentence on how this fact shaped what came after`,
      ].join("\n"),
    },
    reflection: {
      schemaHint: `{"content":"string"}`,
      contentRules: `- content: 1–2 thought-provoking sentences inviting the student to connect this historical event to today or their own life; write in second person ("you")`,
    },
    recap: {
      schemaHint: `{"timeline":["string","string","string"],"bigPicture":"string"}`,
      contentRules: [
        `- timeline: 3–5 key moments in chronological order, each as "PERIOD: event label" (max 10 words each)`,
        `- bigPicture: 1 sentence capturing the overarching lesson or pattern from this narrative`,
      ].join("\n"),
    },
  },

  collection: {
    intro: {
      schemaHint: `{"overview":"string","subjects":["string","string","string"]}`,
      contentRules: [
        `- overview: 2–3 sentences introducing the collection as a whole — what unifies these items and why they are worth studying together`,
        `- subjects: exactly 3 names of the specific subjects in this collection (use the real names from the lesson topic)`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"subjectName":"string","headline":"string","details":"string"}`,
      contentRules: [
        `- subjectName: the exact name of this subject from the collection`,
        `- headline: 1 punchy sentence capturing the single most defining characteristic; use **bold** for key terms`,
        `- details: 2–3 sentences giving rich supporting detail — origin, numbers, context; use **bold** for standout facts`,
      ].join("\n"),
    },
    fact: {
      schemaHint: `{"subjectName":"string","standoutFact":"string","context":"string"}`,
      contentRules: [
        `- subjectName: the exact name of this subject`,
        `- standoutFact: 1 surprising or record-breaking fact about this subject; max 22 words`,
        `- context: 1–2 sentences explaining why this fact is significant or how it compares to others in the collection`,
      ].join("\n"),
    },
    recap: {
      schemaHint: `{"highlights":["string","string","string"],"bigIdea":"string"}`,
      contentRules: [
        `- highlights: 3 memorable facts, one per subject, each as "SubjectName: one striking detail" (max 12 words each)`,
        `- bigIdea: 1 sentence capturing what all these subjects have in common or what makes them collectively important`,
      ].join("\n"),
    },
  },

  comparison: {
    intro: {
      schemaHint: `{"subjectA":"string","subjectB":"string","centralQuestion":"string"}`,
      contentRules: [
        `- subjectA: the full name of the first subject exactly as it will appear in the deck`,
        `- subjectB: the full name of the second subject`,
        `- centralQuestion: 1 guiding question that frames the entire comparison (e.g. "Which is better adapted for survival — the shark or the dolphin?")`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"subject":"string","characteristics":"string","uniquePoint":"string"}`,
      contentRules: [
        `- subject: the name of the subject this deep-dive slide covers`,
        `- characteristics: 2–3 sentences describing this subject's key properties, behaviour, or history; use **bold** for technical terms`,
        `- uniquePoint: 1 sentence highlighting the single most distinctive thing about this subject that sets it apart from the other`,
      ].join("\n"),
    },
    recap: {
      schemaHint: `{"similarities":["string","string"],"differences":["string","string"],"takeaway":"string"}`,
      contentRules: [
        `- similarities: 2 things both subjects share; max 12 words each`,
        `- differences: 2 key ways they differ; max 12 words each; start each with the relevant subject name`,
        `- takeaway: 1 sentence with the most important insight from the comparison; use **bold** for the core concept`,
      ].join("\n"),
    },
  },

  "cause-effect": {
    intro: {
      schemaHint: `{"phenomenon":"string","context":"string","hookFact":"string"}`,
      contentRules: [
        `- phenomenon: 1 sentence naming and defining the subject (e.g. "Climate change is the long-term shift in global temperatures and weather patterns.")`,
        `- context: 1–2 sentences giving background — when/where/how it began; use **bold** for key terms`,
        `- hookFact: 1 striking statistic or vivid fact that makes the scale of this phenomenon real`,
      ].join("\n"),
    },
    explanation: {
      schemaHint: `{"causeName":"string","mechanism":"string","evidence":"string"}`,
      contentRules: [
        `- causeName: the name of this cause (short, e.g. "Burning fossil fuels" or "Deforestation")`,
        `- mechanism: 2–3 sentences explaining exactly HOW this cause produces the outcome; use **bold** for key terms and agents`,
        `- evidence: 1 sentence citing a specific statistic, study, or historical example that demonstrates this cause`,
      ].join("\n"),
    },
    fact: {
      schemaHint: `{"effectName":"string","scale":"string","realWorldExample":"string"}`,
      contentRules: [
        `- effectName: the name of this effect (e.g. "Rising sea levels" or "Species extinction")`,
        `- scale: 1 sentence with a specific number, measurement, or magnitude showing how large this effect is`,
        `- realWorldExample: 1–2 sentences describing a specific, real-world instance of this effect that students can relate to`,
      ].join("\n"),
    },
    reflection: {
      schemaHint: `{"content":"string"}`,
      contentRules: `- content: 1–2 sentences asking the student to think about their own role or responsibility in this cause-effect chain; write in second person ("you")`,
    },
    recap: {
      schemaHint: `{"mainCauses":["string","string"],"mainEffects":["string","string"],"bigPicture":"string"}`,
      contentRules: [
        `- mainCauses: 2 concise cause labels (max 8 words each)`,
        `- mainEffects: 2 concise effect labels (max 8 words each)`,
        `- bigPicture: 1 sentence capturing the most important lesson about this cause-effect relationship`,
      ].join("\n"),
    },
  },

  "single-subject": {
    intro: {
      schemaHint: `{"hook":"string","definition":"string","whyItMatters":"string"}`,
      contentRules: [
        `- hook: 1–2 sentences creating curiosity or surprise about this subject`,
        `- definition: 1 clear, precise definition sentence; use **bold** for the subject name`,
        `- whyItMatters: 1 sentence explaining real-world relevance or importance`,
      ].join("\n"),
    },
    example: {
      schemaHint: `{"context":"string","instances":["string","string","string"]}`,
      contentRules: [
        `- context: 1 sentence framing what kind of examples will follow`,
        `- instances: 2–3 concrete, specific examples with **bold** key terms; max 18 words each`,
      ].join("\n"),
    },
    recap: {
      schemaHint: `{"bullets":["string","string","string","string"]}`,
      contentRules: `- bullets: 3–4 concise takeaway statements; start each with an active verb or the subject name; max 15 words each`,
    },
  },
};

function getCategorySchema(
  topicType: string,
  slideType: string,
): { schemaHint: string; contentRules: string } | null {
  return CATEGORY_SLIDE_SCHEMAS[topicType]?.[slideType] ?? null;
}

function buildBoldInstruction(topicType: string): string {
  switch (topicType) {
    case "formula":
      return ""; // handled by formulaInstruction
    case "single-subject":
      return `\n- BOLD: use **bold** for 1–3 key domain-specific nouns or technical terms per bullet/sentence (e.g. **photosynthesis**). Never bold common words or full phrases.`;
    case "process":
      return `\n- BOLD: use **bold** for each named stage or step (e.g. **evaporation**). Bold the step name at first mention on its slide.`;
    case "narrative":
      return `\n- BOLD: use **bold** for names of people, places, and pivotal dates/events (e.g. **Apollo 11**, **1969**).`;
    case "collection":
      return `\n- BOLD: use **bold** for each subject's name on its dedicated slide and its single most defining characteristic.`;
    case "comparison":
      return `\n- BOLD: use **bold** for both subjects' names and key differentiating properties (e.g. **warm-blooded** vs **cold-blooded**).`;
    case "cause-effect":
      return `\n- BOLD: use **bold** for each named cause and each named effect to make the causal chain easy to trace.`;
    default:
      return `\n- BOLD: use **bold** for 1–2 key domain-specific terms per bullet/sentence. Bold specific nouns only, never generic words or full phrases.`;
  }
}

// ── Step 1: Ultra-fast category classifier — returns ONLY the category string ─
// max_tokens=10 so the model is forced to stop after the single word.
async function classifyTopicCategory(topic: string): Promise<string> {
  const VALID = ["collection","process","narrative","comparison","cause-effect","formula","single-subject"];
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 10,
      messages: [
        {
          role: "system",
          content: "You are a topic classifier. Reply with ONLY the category name. One word (or hyphenated word). No punctuation. No explanation. Stop immediately after.",
        },
        {
          role: "user",
          content: `Categories: collection | process | narrative | comparison | cause-effect | formula | single-subject

MANDATORY rules:
- formula = ANY grammar/tense/voice/conjugation/parts-of-speech topic (e.g. "present simple", "past continuous", "the present perfect", "passive voice", "articles", "modal verbs", "nouns"), ANY math equation/theorem/formula/operation, ANY physics or chemistry law or equation — NO exceptions. Tense names always → formula.
- comparison = ONLY when the topic explicitly compares exactly two things.
- single-subject = one focused concept that fits none of the above.

Examples:
"the present simple" → formula
"present perfect tense" → formula
"passive voice" → formula
"photosynthesis" → process
"the water cycle" → process
"World War II" → narrative
"cats vs dogs" → comparison
"Newton's second law" → formula
"the solar system" → collection

Topic: "${topic}"`,
        },
      ],
    });
    const raw = (result.choices[0]?.message?.content ?? "").trim().toLowerCase().replace(/[^a-z-]/g, "");
    if (VALID.includes(raw)) return raw;
  } catch { /* fall through */ }
  return "single-subject";
}

// ── Step 2: Get structure items for the identified category ───────────────────
// Called after classifyTopicCategory — uses the known category to ask the right question.
async function getStructureItems(topic: string, topicType: string): Promise<string[]> {
  if (topicType === "single-subject") return [];
  const ITEM_HINT: Record<string, string> = {
    collection:    "the distinct subjects/people/places/animals to include — their exact names",
    process:       "the steps in order — short action labels (e.g. 'Evaporation', 'Condensation')",
    narrative:     "key phases or milestones in strict chronological order",
    comparison:    "EXACTLY 2 items: the two things being compared — nothing else",
    "cause-effect":"the main causes or effects to address (mix both if applicable)",
    formula:       `the named forms, usage rules, or components to cover (e.g. for "present perfect": ["Affirmative (S+have/has+V3)", "Negative (S+haven't/hasn't+V3)", "Question (Have/Has+S+V3?)", "Time expressions (already, just, yet, ever, never, since, for)", "Usage: completed actions with present result"])`,
  };
  const hint = ITEM_HINT[topicType] ?? "the key items to cover";
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: "system", content: "Return strict JSON only. No markdown." },
        {
          role: "user",
          content: `Topic: "${topic}"
Category: ${topicType}

List up to 6 specific items — ${hint}.

Return ONLY JSON: {"items":["string"]}`,
        },
      ],
    });
    const parsed = safeJsonParse(result.choices[0]?.message?.content ?? "");
    if (Array.isArray(parsed?.items)) return parsed.items as string[];
  } catch { /* fall through */ }
  return [];
}

// ── Per-category slide JSON structures ───────────────────────────────────────
// Each entry defines the FULL deck schema for its category — slide positions,
// types, and the exact field shapes the AI should produce per slide.
// classifyTopicCategory() picks the category → the matching structure is
// serialised and injected into the outline prompt so the model knows exactly
// what to generate and in what shape.
const CATEGORY_SLIDE_STRUCTURES: Record<string, object> = {
  formula: {
    description: "Formula / Grammar rule / Math theorem / Physics law deck",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { mainParagraph: "2-3 hook sentences — WHY this rule matters; mention notation or domain explicitly", lessonAimText: ["aim 1 (start with action verb e.g. Understand…)", "aim 2 (e.g. Apply…)", "aim 3 (e.g. Recognise…)"] },
      },
      {
        n: 2, slideType: "explanation", purpose: "NOTATION — display the complete canonical formula with ALL forms or variants",
        fields: { notation: "full canonical notation e.g. S + have/has + V3  or  a²+b²=c²  or  F=ma; wrap each component in **bold**", notationBreakdown: "3-4 sentences unpacking every component with at least 1 worked example inline" },
      },
      {
        n: 3, slideType: "columns", purpose: "one card per formula component — break the notation into named parts",
        fields: { columns: [{ label: "component name e.g. Subject", description: "1 sentence role this component plays", imageQuery: "metaphorical English scene e.g. 'person raising hand to speak'" }] },
      },
      {
        n: "4-8", slideType: "explanation | example", purpose: "one slide per form / usage rule / worked calculation",
        fields: { notation: "exact notation for this specific form e.g. S + haven't/hasn't + V3", explanation: "2-3 sentences on meaning and when to use this form", examples: ["step-by-step worked example 1", "step-by-step worked example 2"] },
      },
      {
        n: 9, slideType: "quiz",
        fields: { bullets: ["A. option", "B. option", "C. option", "D. option"], correctIndex: "0-based integer (0=A … 3=D)" },
      },
      {
        n: 10, slideType: "recap", purpose: "reinforce the full formula + usage rules",
        fields: { fullNotation: "canonical formula repeated exactly as on slide 2", usageRules: ["concise rule/tip 1 starting with a verb", "rule/tip 2", "rule/tip 3"] },
      },
    ],
  },

  process: {
    description: "Step-by-step sequence — how something works or happens",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { hook: "1-2 sentences sparking curiosity — surprising stat or vivid analogy", aimPoints: ["You will understand…", "By the end you will be able to…"] },
      },
      {
        n: 2, slideType: "explanation", purpose: "overview of the entire process end-to-end",
        fields: { overview: "2-3 sentences covering the full sequence from start to finish", keyTerms: ["essential term 1", "essential term 2", "essential term 3"] },
      },
      {
        n: 3, slideType: "columns", purpose: "3-4 key stages summarised as cards",
        fields: { columns: [{ label: "stage name", description: "1 sentence what happens here", imageQuery: "English stock-photo query" }] },
      },
      {
        n: "4-8", slideType: "explanation", purpose: "one slide per step in sequence order",
        fields: { stepName: "step label e.g. Evaporation", stepNumber: "integer position", whatHappens: "2-3 sentences — exactly what occurs in this step with **bold** key terms", whyItMatters: "1 sentence — why this step is critical to the whole process" },
      },
      {
        n: 9, slideType: "quiz",
        fields: { bullets: ["A. option", "B. option", "C. option", "D. option"], correctIndex: "0-3" },
      },
      {
        n: 10, slideType: "recap",
        fields: { sequence: ["step 1 label", "step 2 label", "step 3 label", "…"], keyTakeaway: "1 memorable sentence — the single most important insight about this process" },
      },
    ],
  },

  narrative: {
    description: "Chronological story / historical arc",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { hook: "1-2 gripping sentences placing the student in the historical moment", timeSpan: "concise date range e.g. 1789–1799", significance: "1 sentence — why this story still matters today" },
      },
      {
        n: 2, slideType: "explanation", purpose: "historical backdrop / context before the main events",
        fields: { period: "time label e.g. Before 1789", event: "2-3 sentences on what set the stage", impact: "1 sentence on what it triggered" },
      },
      {
        n: 3, slideType: "columns", purpose: "3-4 key figures / places / milestones as cards",
        fields: { columns: [{ label: "name or place", description: "1 sentence role in the story", imageQuery: "English photo or illustration query" }] },
      },
      {
        n: "4-8", slideType: "explanation | fact", purpose: "one slide per phase or milestone in strict chronological order",
        fields: { period: "time label e.g. 1793–1794", headline: "newspaper-style statement max 18 words", moment: "2 sentences with specific names, dates, and detail", legacy: "1 sentence — what changed after this moment" },
      },
      {
        n: 9, slideType: "reflection",
        fields: { content: "1-2 thought-provoking sentences connecting the history to today — written in second person (you)" },
      },
      {
        n: 10, slideType: "recap",
        fields: { timeline: ["PERIOD: event label", "PERIOD: event label", "PERIOD: event label"], bigPicture: "1 sentence — the overarching lesson or pattern from this narrative" },
      },
    ],
  },

  collection: {
    description: "Multiple distinct subjects — people / places / animals / examples",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { overview: "2-3 sentences introducing the collection — what unifies these subjects and why they are worth studying together", subjects: ["subject 1 exact name", "subject 2 exact name", "subject 3 exact name"] },
      },
      {
        n: 2, slideType: "columns", purpose: "one card per subject — at-a-glance overview grid",
        fields: { columns: [{ label: "subject name", description: "1 sentence — single most defining characteristic", imageQuery: "English photo query" }] },
      },
      {
        n: "3-8", slideType: "explanation | fact", purpose: "one dedicated spotlight slide per subject",
        fields: { subjectName: "exact subject name", headline: "1 punchy defining sentence with **bold** key term", details: "2-3 sentences — origin, numbers, context with **bold** standout facts", standoutFact: "1 surprising or record-breaking fact about this subject" },
      },
      {
        n: 9, slideType: "comparison", purpose: "two most contrasting subjects placed side-by-side",
        fields: { sideALabel: "subject A name", sideBLabel: "subject B name", sideAContent: "2-3 sentences on subject A", sideBContent: "2-3 sentences on subject B" },
      },
      {
        n: 10, slideType: "recap",
        fields: { highlights: ["SubjectName: one striking detail", "SubjectName: one striking detail", "SubjectName: one striking detail"], bigIdea: "1 sentence — what all subjects share or why they matter collectively" },
      },
    ],
  },

  comparison: {
    description: "Two distinct subjects compared analytically",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { subjectA: "full name of first subject", subjectB: "full name of second subject", centralQuestion: "guiding question framing the whole comparison e.g. Which is better adapted for survival — the shark or the dolphin?" },
      },
      {
        n: 2, slideType: "explanation", purpose: "shared background context for both subjects",
        fields: { subject: "both subject names", characteristics: "2-3 sentences on shared context or historical backdrop", uniquePoint: "1 sentence — the key tension or contrast between them" },
      },
      {
        n: 3, slideType: "columns", purpose: "3-4 comparison dimensions as cards",
        fields: { columns: [{ label: "dimension e.g. Speed", description: "1 sentence framing this dimension", imageQuery: "English photo query" }] },
      },
      {
        n: 4, slideType: "explanation", purpose: "deep dive — subject A only",
        fields: { subject: "subject A name", characteristics: "2-3 sentences on subject A's key properties/behaviour/history", uniquePoint: "1 sentence — what makes subject A distinctively different from B" },
      },
      {
        n: 5, slideType: "explanation", purpose: "deep dive — subject B only",
        fields: { subject: "subject B name", characteristics: "2-3 sentences on subject B's key properties/behaviour/history", uniquePoint: "1 sentence — what makes subject B distinctively different from A" },
      },
      {
        n: "6-8", slideType: "comparison", purpose: "one slide each: similarities / differences / strengths-weaknesses",
        fields: { sideALabel: "subject A name", sideBLabel: "subject B name", sideAContent: "2-3 sentences on A's angle for this dimension", sideBContent: "2-3 sentences on B's angle for this dimension" },
      },
      {
        n: 9, slideType: "quiz",
        fields: { bullets: ["A. option", "B. option", "C. option", "D. option"], correctIndex: "0-3" },
      },
      {
        n: 10, slideType: "recap",
        fields: { similarities: ["shared trait 1", "shared trait 2"], differences: ["SubjectA: key difference", "SubjectB: key difference"], takeaway: "1 sentence — the single most important insight from the comparison" },
      },
    ],
  },

  "cause-effect": {
    description: "Causes and/or effects of a phenomenon",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { phenomenon: "1 sentence naming and defining the subject", context: "1-2 sentences on when/where/how it began with **bold** key terms", hookFact: "1 striking statistic or vivid fact that makes the scale real" },
      },
      {
        n: 2, slideType: "explanation", purpose: "background — the causal mechanism at a high level",
        fields: { causeName: "overarching name of the primary cause chain", mechanism: "2-3 sentences on HOW the causes produce the outcome with **bold** key terms", evidence: "1 sentence citing a specific stat or historical example" },
      },
      {
        n: 3, slideType: "columns", purpose: "3-4 main causes as cards",
        fields: { columns: [{ label: "cause name", description: "1 sentence mechanism", imageQuery: "English photo query" }] },
      },
      {
        n: "4-7", slideType: "explanation | fact", purpose: "one slide per cause or effect alternating",
        fields: { causeName: "cause name  OR  effectName: effect name", mechanism: "2-3 sentences HOW this cause/effect operates with **bold** agents", scale: "1 sentence with a specific number or magnitude", realWorldExample: "1-2 sentences — concrete real-world instance students can relate to" },
      },
      {
        n: 8, slideType: "comparison", purpose: "key cause vs key effect placed side-by-side",
        fields: { sideALabel: "Cause", sideBLabel: "Effect", sideAContent: "2-3 sentences on the primary cause", sideBContent: "2-3 sentences on the primary effect" },
      },
      {
        n: 9, slideType: "reflection",
        fields: { content: "1-2 sentences asking students to think about their own role in this cause-effect chain — second person (you)" },
      },
      {
        n: 10, slideType: "recap",
        fields: { mainCauses: ["cause 1 label", "cause 2 label"], mainEffects: ["effect 1 label", "effect 2 label"], bigPicture: "1 sentence — the most important lesson about this cause-effect relationship" },
      },
    ],
  },

  "single-subject": {
    description: "One focused concept, organism, person, or idea",
    slides: [
      {
        n: 1, slideType: "intro",
        fields: { hook: "1-2 sentences creating curiosity or surprise", definition: "1 clear precise definition with **bold** subject name", whyItMatters: "1 sentence — real-world relevance or importance" },
      },
      {
        n: 2, slideType: "explanation", purpose: "define and unpack the subject in depth",
        fields: { content: "4-5 rich sentences — mechanism, origin, or defining properties with **bold** key terms" },
      },
      {
        n: 3, slideType: "columns", purpose: "3-4 key features or aspects as cards",
        fields: { columns: [{ label: "feature name", description: "1 sentence description", imageQuery: "English photo query" }] },
      },
      {
        n: 4, slideType: "fact",
        fields: { keyStatement: "1 surprising impactful sentence max 22 words", content: "2-3 sentences expanding with context/evidence/examples" },
      },
      {
        n: 5, slideType: "example",
        fields: { context: "1 sentence framing what kind of examples follow", instances: ["concrete example 1 with **bold** key terms", "concrete example 2", "concrete example 3"] },
      },
      {
        n: 6, slideType: "explanation", purpose: "deeper layer — mechanism, controversy, or real-world application",
        fields: { content: "4-5 sentences on a distinctly different aspect from slide 2 with **bold** key terms" },
      },
      {
        n: 7, slideType: "fact",
        fields: { keyStatement: "1 surprising impactful sentence — different from slide 4", content: "2-3 sentences expanding with new context or evidence" },
      },
      {
        n: 8, slideType: "example",
        fields: { context: "1 sentence framing the examples", instances: ["concrete example 1", "concrete example 2", "concrete example 3"] },
      },
      {
        n: 9, slideType: "quiz",
        fields: { bullets: ["A. option", "B. option", "C. option", "D. option"], correctIndex: "0-3" },
      },
      {
        n: 10, slideType: "recap",
        fields: { bullets: ["takeaway 1 starting with active verb or subject name", "takeaway 2", "takeaway 3", "takeaway 4"] },
      },
    ],
  },
};

function safeJsonParse(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  // Try direct parse first
  try { return JSON.parse(clean); } catch { /* fall through */ }
  // Extract first {...} block in case model added preamble/postamble
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

// ── Phase 1: Outline prompt ────────────────────────────────────────────────
// Generates slide titles, slideTypes, imageQueries, and columns cards.
// Keeps the prompt focused on structure — content is deferred to phase 2.

function buildOutlinePrompt(params: {
  topic: string;
  grade: string;
  curriculum: string;
  curriculumContext: string;
  categorySlideSequence: string;
  categorySlideStructureJson: string;
  effectiveSlideCount: number;
  isUzbekCurriculum: boolean;
  hasCyrillic: boolean;
}): string {
  const {
    topic, grade, curriculum, curriculumContext,
    categorySlideSequence, categorySlideStructureJson, effectiveSlideCount,
    isUzbekCurriculum, hasCyrillic,
  } = params;

  const imageQueryEnglishRule = `\n- imageQuery MUST be in English (stock photo API). ✓ "volcano eruption lava flow"  ✗ "vulqon otilishi"`;

  const titleLanguageNote = isUzbekCurriculum
    ? hasCyrillic
      ? `Generate deckTitle and slide titles in Russian.${imageQueryEnglishRule}`
      : `Generate deckTitle and slide titles in Uzbek (Latin script).${imageQueryEnglishRule}`
    : `Detect topic language; generate deckTitle and slide titles in that language.${imageQueryEnglishRule}`;

  return `Outline a ${effectiveSlideCount}-slide lesson deck.

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}${curriculumContext ? `\n\nCurriculum context:\n${curriculumContext}` : ""}

${categorySlideSequence}

Category slide structure — follow this schema when assigning slide types and planning per-slide content shapes:
${categorySlideStructureJson}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","slideType":"string","imageQuery":"string|null","imageStrategy":"literal"|"metaphor"|null,"visualType":"photo"|"diagram"|null}]}

Rules:
- slideType: intro|explanation|example|fact|comparison|columns|reflection|question|quiz|recap
- MANDATORY columns: where sequence marks "columns (MANDATORY)", use slideType "columns", add "columns":[{"label":"string","description":"string","imageQuery":"string|null"}]; top-level imageQuery null
- quiz/reflection/question/recap/columns: imageQuery, imageStrategy, visualType all null
- Every visual slide: unique imageQuery in English, 3–6 words; "literal"=concrete noun phrase; "metaphor"=vivid scene for abstract concept
- "visualType": "diagram" for timelines/cycles/cross-sections/anatomy/maps; "photo" for real objects/people/places
- ${titleLanguageNote}`;
}

// ── Phase 2: Per-slide content prompt ─────────────────────────────────────
// Called in parallel for every non-columns slide.
// Receives the full deck outline as context for coherence.
// ragContext slot is empty now — Graph RAG will populate it per slide later.

function buildSlideContentPrompt(params: {
  slide: { title: string; slideType: string };
  slideIndex: number;
  totalSlides: number;
  topic: string;
  grade: string;
  deckTitle: string;
  outlineSummary: string;
  otherSlideTitles: string[];
  isPrimary: boolean;
  topicType: string;
  boldInstruction: string;
  formulaInstruction: string;
  languageInstruction: string;
  ragContext?: string; // reserved for Graph RAG integration
}): string {
  const {
    slide, slideIndex, totalSlides, topic, grade, deckTitle,
    outlineSummary, otherSlideTitles, isPrimary, topicType, boldInstruction, formulaInstruction,
    languageInstruction, ragContext,
  } = params;

  const isComparison = slide.slideType === "comparison";
  const isQuiz = slide.slideType === "quiz";
  const isRecap = slide.slideType === "recap";
  const isFact = slide.slideType === "fact";
  const isExample = slide.slideType === "example";
  const isIntro = slide.slideType === "intro";
  const isReflection = slide.slideType === "reflection" || slide.slideType === "question";
  const isFormulaTopic = formulaInstruction !== "";

  // Schema and rules vary by slide type so each slide gets the right content shape
  let schemaHint: string;
  let contentRules: string;

  if (isQuiz) {
    schemaHint = `{"bullets":["A. option","B. option","C. option","D. option"],"correctIndex":0}`;
    contentRules = `- bullets: exactly 4 answer options as "A. ...", "B. ...", "C. ...", "D. ...", max 12 words each\n- correctIndex: 0-based index of the correct answer (0=A, 1=B, 2=C, 3=D)`;
  } else if (isPrimary) {
    if (isComparison) {
      schemaHint = `{"sideALabel":"string","sideBLabel":"string","sideABullets":["string"],"sideBBullets":["string"]}`;
      contentRules = `- sideABullets and sideBBullets: 2–3 bullets each, max 12 words, child-friendly, about DIFFERENT things`;
    } else if (isFact) {
      schemaHint = `{"keyStatement":"string","bullets":["string"]}`;
      contentRules = `- keyStatement: 1 simple, surprising fact, child-friendly, max 18 words\n- bullets: 1–2 fun supporting details, max 12 words each`;
    } else {
      schemaHint = `{"bullets":["string","string","string"]}`;
      contentRules = `- bullets: exactly 3 items, max 12 words each, child-friendly language`;
    }
  } else {
    // Secondary grades — use category-specific schema first, then fall back to generic per slide type
    const catSchema = !isComparison ? getCategorySchema(topicType, slide.slideType) : null;
    if (catSchema) {
      schemaHint = catSchema.schemaHint;
      contentRules = catSchema.contentRules;
    } else if (isComparison) {
      schemaHint = `{"sideALabel":"string","sideBLabel":"string","sideAContent":"string","sideBContent":"string"}`;
      contentRules = `- sideAContent and sideBContent: 2–3 rich sentences each about DIFFERENT things; use **bold** and *italics* for key terms`;
    } else if (isFact) {
      schemaHint = `{"keyStatement":"string","content":"string"}`;
      contentRules = `- keyStatement: 1 surprising, impactful sentence — the single most memorable fact on this slide; max 22 words\n- content: 2–3 sentences expanding on the fact with context, evidence, or striking examples; use **bold** for key terms`;
    } else if (isRecap) {
      schemaHint = `{"bullets":["string","string","string","string"]}`;
      contentRules = `- bullets: 3–4 concise takeaway statements summarising what students learned, 10–15 words each; start each with an active verb or key concept`;
    } else if (isReflection) {
      schemaHint = `{"content":"string"}`;
      contentRules = `- content: 1–2 thought-provoking sentences that invite students to connect the topic to their own experience or form an opinion; write in second person ("you")`;
    } else if (isFormulaTopic) {
      schemaHint = `{"keyStatement":"string","content":"string","formulaBox":"string|null"}`;
      contentRules = `- keyStatement: the EXACT, CORRECT notation or rule for this slide (e.g. "a² + b² = c²" or "S + have/has + V3" or "Subject + verb + -s/-es"); for grammar tenses always write AFFIRMATIVE form first, then negative, then interrogative; for math/science write in standard left-to-right order; no character limit — accuracy is more important than brevity\n- content: 3–4 sentences explaining the rule's meaning with **bold** notation and concrete examples or worked calculations\n- formulaBox: exact notation string for the highlight box; for grammar tenses show AFFIRMATIVE form only (e.g. "Subject + V2"), or null`;
    } else if (isIntro) {
      schemaHint = `{"content":"string","bullets":["string","string"]}`;
      contentRules = `- content: 2–3 sentences that hook the reader, frame the topic, and spark curiosity; use **bold** for the core concept\n- bullets: 2 key themes or questions this lesson will explore, max 12 words each`;
    } else if (isExample) {
      schemaHint = `{"content":"string","bullets":["string","string","string"]}`;
      contentRules = `- content: 1–2 sentences that set up the example context\n- bullets: 2–3 concrete worked examples or real-world instances with **bold** key terms, max 18 words each`;
    } else {
      // explanation (default)
      schemaHint = `{"content":"string"}`;
      contentRules = `- content: 4–5 rich sentences explaining the concept; use **bold** for key terms, vary sentence length, include concrete data or examples`;
    }
  }

  const avoidList = otherSlideTitles.length > 0
    ? `\nANTI-REPETITION — Do NOT cover these topics (they belong to other slides):\n${otherSlideTitles.map(t => `  • ${t}`).join("\n")}\nWrite ONLY about what is unique to "${slide.title}". Every fact, example, and sentence must be specific to this slide's angle — do not restate generic topic introductions.`
    : "";

  return `Write content for slide ${slideIndex + 1}/${totalSlides} in a lesson deck.

Deck: "${deckTitle}" | Topic: ${topic}${grade ? ` | Grade: ${grade}` : ""}
This slide: "${slide.title}" (type: ${slide.slideType})
${avoidList}
Deck outline (reference only):
${outlineSummary}
${ragContext ? `\nCurriculum context:\n${ragContext}` : ""}
Return ONLY valid JSON: ${schemaHint}

${contentRules}${boldInstruction}${formulaInstruction}${languageInstruction}`;
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      grade = "",
      slideCount = 8,
      primaryMode = false,
      curriculum = "",
      debug: debugRequested = false,
    } = await req.json();

    // Debug output is only ever returned in local development.
    // Even if a client sends debug:true, production ignores it completely.
    const debug = debugRequested && process.env.NODE_ENV === "development";

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const numericGrade =
      typeof grade === "number" ? grade : Number(String(grade).trim());
    const isPrimary =
      primaryMode || (!Number.isNaN(numericGrade) && numericGrade <= 4);
    const effectiveSlideCount = slideCount;

    // ── Topic structure pre-pass (two steps) ──────────────────────────────────
    // Step 1: ultra-fast call → returns ONLY the category name as plain text.
    const VALID_TOPIC_TYPES = ["collection", "process", "narrative", "comparison", "cause-effect", "formula", "single-subject"];
    const rawCategory = await classifyTopicCategory(topic);
    const safeTopicType = VALID_TOPIC_TYPES.includes(rawCategory) ? rawCategory : "single-subject";

    // Step 2: category-aware structure items call (sequential — needs category).
    const structureItems = await getStructureItems(topic, safeTopicType);

    // Resolve per-category slide JSON structure (synchronous lookup).
    const slideStructure = CATEGORY_SLIDE_STRUCTURES[safeTopicType] ?? CATEGORY_SLIDE_STRUCTURES["single-subject"];
    const categorySlideStructureJson = JSON.stringify(slideStructure, null, 2);

    const categorySlideSequence = buildCategorySlideSequence(safeTopicType, structureItems, isPrimary);

    // ── Language handling ──────────────────────────────────────────────────────
    const isUzbekCurriculum = curriculum.replace(/[''']/g, "'").includes("O'zbekiston");

    // ── Curriculum RAG (O'zbekiston DTS only for now) ──────────────────────
    let curriculumContext = "";
    let debugRagLessons: Awaited<ReturnType<typeof searchCurriculum>> = [];
    if (isUzbekCurriculum && numericGrade === 5) {
      debugRagLessons = await searchCurriculum(topic, "uzbek-dts", 5, 5);
      curriculumContext = await compressCurriculumContext(topic, debugRagLessons);
    }
    const hasCyrillic = /[\u0400-\u04FF]/.test(topic);
    const imageQueryEnglishRule = `\n- CRITICAL: "imageQuery" is sent to English-language stock photo APIs. It MUST be written in English regardless of the topic language. Never write imageQuery in Uzbek, Russian, or any other language.\n  ✗ WRONG:   "imageQuery": "vulqon va tog' taqqoslash"\n  ✓ CORRECT: "imageQuery": "volcano mountain comparison"`;
    const languageInstruction = isUzbekCurriculum
      ? hasCyrillic
        ? `\n- The topic is written in Russian. Generate ALL slide text fields (deckTitle, title, keyStatement, content, bullets, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Russian.${imageQueryEnglishRule}`
        : `\n- Generate ALL slide text fields (deckTitle, title, keyStatement, content, bullets, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Uzbek (Latin script).${imageQueryEnglishRule}`
      : `\n- Look at the WRITTEN SCRIPT of the topic text itself (not the subject matter). Generate ALL slide text fields (deckTitle, title, keyStatement, content, bullets, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in that same written language. IMPORTANT: If the topic is written using Latin/English characters (e.g. "the timurid empire", "photosynthesis"), respond entirely in English — even if the subject is historically associated with another culture or region.${imageQueryEnglishRule}`;

    const boldInstruction = buildBoldInstruction(safeTopicType);

    const formulaInstruction = safeTopicType === "formula"
      ? `\n\nFORMULA/RULE TOPIC — CRITICAL:
- ACCURACY IS NON-NEGOTIABLE. Every formula, notation, and rule must be factually and grammatically correct. Write components in the correct order. Double-check before returning.
- The PRIMARY goal is to show STRUCTURE and NOTATION, not facts. Every slide must reinforce the formula.
- Slide 2 MUST display ONLY the single primary/canonical notation — one concise line using exact symbols (e.g. **S** + **have/has** + **V3**, **a²** + **b²** = **c²**, **F** = **m** × **a**). Do NOT list multiple variants, forms, or cases here. Each variant (negative, interrogative, rearrangements, special cases, etc.) gets its own dedicated slide later (slides 4–8).
- Slide 3 columns MUST break the formula into its named components — one card per component. Each column imageQuery MUST be a metaphorical scene representing that component (e.g. for "subject" → "person raising hand to speak in a group", for "helper verb" → "mechanic using a wrench to fix an engine", for "past participle" → "completed jigsaw puzzle on a table").
- Every explanation and example slide MUST include example sentences or worked calculations using the formula — do NOT write generic facts about the topic.
- NEVER use slideType "fact" — this is a formula topic. Every content slide must be "explanation" or "example". Slides with slideType "fact" will be rejected.`
      : "";

    // ── Phase 1: Generate outline ──────────────────────────────────────────────
    // Returns titles, slideTypes, imageQueries, and columns cards for all slides.
    const outlinePrompt = buildOutlinePrompt({
      topic,
      grade,
      curriculum,
      curriculumContext,
      categorySlideSequence,
      categorySlideStructureJson,
      effectiveSlideCount,
      isUzbekCurriculum,
      hasCyrillic,
    });

    const outlineCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.4,
      max_tokens: 2200,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: outlinePrompt },
      ],
    });

    const outlineRaw = outlineCompletion.choices[0]?.message?.content ?? "";
    const outlineParsed = safeJsonParse(outlineRaw);

    if (!outlineParsed?.slides) {
      return NextResponse.json(
        { error: "Invalid JSON from OpenAI (outline)" },
        { status: 500 }
      );
    }

    // ── Phase 2: Generate content per slide (parallel) ────────────────────────
    // columns slides are fully generated in phase 1 — skip them here.
    // The outline summary gives each call enough context to avoid repetition.
    const outlineSummary = (outlineParsed.slides as any[])
      .map((s: any, i: number) => `${i + 1}. ${s.title} [${s.slideType}]`)
      .join("\n");

    let debugSampleContentPrompt: string | null = null;

    const contentResults = await Promise.all(
      (outlineParsed.slides as any[]).map((slide: any, i: number) => {
        if (slide.slideType === "columns") return Promise.resolve({});

        const otherSlideTitles = (outlineParsed.slides as any[])
          .filter((_: any, j: number) => j !== i && (outlineParsed.slides as any[])[j].slideType !== "columns")
          .map((s: any) => s.title as string);

        const prompt = buildSlideContentPrompt({
          slide,
          slideIndex: i,
          totalSlides: (outlineParsed.slides as any[]).length,
          topic,
          grade,
          deckTitle: outlineParsed.deckTitle,
          outlineSummary,
          otherSlideTitles,
          isPrimary,
          topicType: safeTopicType,
          boldInstruction,
          formulaInstruction,
          languageInstruction,
          ragContext: curriculumContext || undefined,
        });

        // Store first non-columns prompt for debug output
        if (debug && debugSampleContentPrompt === null) {
          debugSampleContentPrompt = prompt;
        }

        return openai.chat.completions.create({
          // Formula/grammar topics use mini for better factual accuracy (V-ing vs V3, etc.)
          model: safeTopicType === "formula" ? "gpt-4.1-mini" : "gpt-4.1-nano",
          temperature: safeTopicType === "formula" ? 0.3 : 0.9,
          max_tokens: isPrimary ? 500 : 900,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return strict JSON only." },
            { role: "user", content: prompt },
          ],
        })
          .then((r) => safeJsonParse(r.choices[0]?.message?.content ?? "") ?? {})
          .catch((err) => {
            console.error(`Slide ${i + 1} content error:`, err);
            return {};
          });
      })
    );

    // ── Merge outline + content → same shape as before ────────────────────────
    // The merged slides match the structure the post-processing block expects.
    const mergedSlides = (outlineParsed.slides as any[]).map(
      (outlineSlide: any, i: number) => ({ ...outlineSlide, ...contentResults[i] })
    );

    // ── Normalize category-specific fields → standard content fields ──────────
    // Each CATEGORY_SLIDE_SCHEMAS entry produces custom field names (e.g. `notation`,
    // `mainParagraph`, `workedSteps`). The renderer only knows `content`, `bullets`,
    // `keyStatement`, and `formulaBox`. Map here so slides are never blank.
    function normalizeCategoryFields(s: any, topicType: string): any {
      const type = s.slideType ?? "";
      // Helper: join multiple string values into one content string
      const join = (...vals: (string | null | undefined)[]) =>
        vals.filter((v): v is string => typeof v === "string" && v.trim().length > 0).join("\n\n");

      switch (topicType) {
        case "formula":
          if (type === "intro") {
            if (!s.content && s.mainParagraph) s.content = s.mainParagraph;
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.lessonAimText)) s.bullets = s.lessonAimText;
          } else if (type === "explanation") {
            if (!s.formulaBox && s.notation) s.formulaBox = s.notation;
            if (!s.content && s.notationBreakdown) s.content = s.notationBreakdown;
          } else if (type === "example") {
            if (!s.content) s.content = join(s.usageCase);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.workedSteps)) s.bullets = s.workedSteps;
          } else if (type === "recap") {
            if (!s.keyStatement && s.fullNotation) s.keyStatement = s.fullNotation;
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.usageRules)) s.bullets = s.usageRules;
          }
          break;

        case "process":
          if (type === "intro") {
            if (!s.content) s.content = join(s.hook);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.aimPoints)) s.bullets = s.aimPoints;
          } else if (type === "explanation") {
            if (!s.keyStatement && s.stepName) s.keyStatement = s.stepName;
            if (!s.content) s.content = join(s.whatHappens, s.whyItMatters);
          } else if (type === "recap") {
            if (!s.content) s.content = join(s.keyTakeaway);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.sequence)) s.bullets = s.sequence;
          }
          break;

        case "narrative":
          if (type === "intro") {
            if (!s.content) s.content = join(s.hook, s.significance);
            if ((!s.bullets || s.bullets.length === 0) && s.timeSpan) s.bullets = [s.timeSpan];
          } else if (type === "explanation") {
            if (!s.keyStatement && s.period) s.keyStatement = s.period;
            if (!s.content) s.content = join(s.event, s.impact);
          } else if (type === "fact") {
            if (!s.keyStatement && s.headline) s.keyStatement = s.headline;
            if (!s.content) s.content = join(s.moment, s.legacy);
          } else if (type === "recap") {
            if (!s.content) s.content = join(s.bigPicture);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.timeline)) s.bullets = s.timeline;
          }
          break;

        case "collection":
          if (type === "intro") {
            if (!s.content) s.content = join(s.overview);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.subjects)) s.bullets = s.subjects;
          } else if (type === "explanation") {
            if (!s.keyStatement && s.subjectName) s.keyStatement = s.subjectName;
            if (!s.content) s.content = join(s.headline, s.details);
          } else if (type === "fact") {
            if (!s.keyStatement && s.subjectName) s.keyStatement = s.subjectName;
            if (!s.content) s.content = join(s.standoutFact, s.context);
          } else if (type === "recap") {
            if (!s.content) s.content = join(s.bigIdea);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.highlights)) s.bullets = s.highlights;
          }
          break;

        case "comparison":
          if (type === "intro") {
            if (!s.content) s.content = join(s.centralQuestion);
            if ((!s.bullets || s.bullets.length === 0)) {
              const parts = [s.subjectA, s.subjectB].filter(Boolean);
              if (parts.length > 0) s.bullets = parts;
            }
          } else if (type === "explanation") {
            if (!s.keyStatement && s.subject) s.keyStatement = s.subject;
            if (!s.content) s.content = join(s.characteristics, s.uniquePoint);
          } else if (type === "recap") {
            if (!s.content) s.content = join(s.takeaway);
            if (!s.bullets || s.bullets.length === 0) {
              const combined = [...(Array.isArray(s.similarities) ? s.similarities : []), ...(Array.isArray(s.differences) ? s.differences : [])];
              if (combined.length > 0) s.bullets = combined;
            }
          }
          break;

        case "cause-effect":
          if (type === "intro") {
            if (!s.content) s.content = join(s.phenomenon, s.context);
            if ((!s.bullets || s.bullets.length === 0) && s.hookFact) s.bullets = [s.hookFact];
          } else if (type === "explanation") {
            if (!s.keyStatement && s.causeName) s.keyStatement = s.causeName;
            if (!s.content) s.content = join(s.mechanism, s.evidence);
          } else if (type === "fact") {
            if (!s.keyStatement && s.effectName) s.keyStatement = s.effectName;
            if (!s.content) s.content = join(s.scale, s.realWorldExample);
          } else if (type === "recap") {
            if (!s.content) s.content = join(s.bigPicture);
            if (!s.bullets || s.bullets.length === 0) {
              const combined = [...(Array.isArray(s.mainCauses) ? s.mainCauses : []), ...(Array.isArray(s.mainEffects) ? s.mainEffects : [])];
              if (combined.length > 0) s.bullets = combined;
            }
          }
          break;

        case "single-subject":
          if (type === "intro") {
            if (!s.content) s.content = join(s.hook, s.definition, s.whyItMatters);
          } else if (type === "example") {
            if (!s.content) s.content = join(s.context);
            if ((!s.bullets || s.bullets.length === 0) && Array.isArray(s.instances)) s.bullets = s.instances;
          }
          break;
      }
      return s;
    }

    const normalizedSlides = mergedSlides.map((s: any) => normalizeCategoryFields(s, safeTopicType));

    // Treat as `parsed` so the post-processing block below is unchanged.
    const parsed = { deckTitle: outlineParsed.deckTitle, slides: normalizedSlides };

    // ── Post-processing (unchanged) ────────────────────────────────────────────
    const VALID_SLIDE_TYPES = ["intro","explanation","example","fact","comparison","columns","reflection","question","quiz","recap"];
    const NO_IMAGE_SLIDE_TYPES = new Set(["reflection","question","quiz","recap","columns"]);
    // Catch common AI variants that don't match the schema (e.g. "true_false", "true/false", "Comparison")
    // Also covers Uzbek Latin and Russian/Uzbek Cyrillic equivalents when slideType is null.
    const NO_IMAGE_TITLE_RE = /\b(quiz|true[\s/_-]?(?:or[\s/_-]?)?false|reflect(?:ion)?|recap|review|viktorina|xulosa|takrorlash|mulohaza|fikrlash)\b|викторин[аы]|тест(?![а-яёА-ЯЁ])|размышлени[еяй]|рефлекси[ия]|повторени[еяй]|хулоса|такрорлаш|мулоҳаза|фикрлаш/i;

    const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
      .filter((s: any) => s != null)
      .slice(0, effectiveSlideCount)
      .map((s: any) => {
        // Normalize slideType: lowercase + trim so AI variants like "Comparison" still match
        const rawType = typeof s.slideType === "string" ? s.slideType.toLowerCase().trim() : "";
        let slideType: string | null = VALID_SLIDE_TYPES.includes(rawType) ? rawType : null;
        // Fallback: if AI returned sideA/sideB fields but forgot slideType:"comparison", infer it
        if (!slideType && (s.sideALabel || s.sideAContent || s.sideABullets || s.sideBContent || s.sideBBullets)) {
          slideType = "comparison";
        }
        // Fallback: if AI returned a columns array but forgot slideType:"columns", infer it
        if (!slideType && Array.isArray(s.columns) && s.columns.length > 0) {
          slideType = "columns";
        }
        const isNoImg = slideType
          ? NO_IMAGE_SLIDE_TYPES.has(slideType)
          : NO_IMAGE_TITLE_RE.test(s.title ?? "");
        const isComparison = slideType === "comparison";
        const isColumns = slideType === "columns";
        return {
          title: s.title ?? "",
          ...(isPrimary && !isColumns
            ? {
                // Fallback: if AI omitted bullets but provided sideA/B (confused non-comparison slide), merge them
                bullets: Array.isArray(s.bullets) && s.bullets.length > 0
                  ? s.bullets
                  : !isComparison && (Array.isArray(s.sideABullets) || Array.isArray(s.sideBBullets))
                  ? [...(Array.isArray(s.sideABullets) ? s.sideABullets : []), ...(Array.isArray(s.sideBBullets) ? s.sideBBullets : [])]
                  : typeof s.content === "string" && s.content.trim()
                  ? s.content.split(/(?<=[.!?])\s+/).filter(Boolean)
                  : [],
              }
            : !isColumns
            ? {
                // Secondary grades: paragraph content + optional keyStatement/bullets/formulaBox
                keyStatement: typeof s.keyStatement === "string" && s.keyStatement.trim() ? s.keyStatement.trim() : null,
                content: typeof s.content === "string" && s.content.trim() ? s.content.trim() : null,
                bullets: Array.isArray(s.bullets) && s.bullets.length > 0 ? s.bullets : [],
                formulaBox: typeof s.formulaBox === "string" && s.formulaBox.trim() ? s.formulaBox.trim() : null,
              }
            : {}),
          ...(isComparison && {
            sideALabel: s.sideALabel ?? null,
            sideBLabel: s.sideBLabel ?? null,
            ...(isPrimary
              ? {
                  sideABullets: Array.isArray(s.sideABullets) ? s.sideABullets : null,
                  sideBBullets: Array.isArray(s.sideBBullets) ? s.sideBBullets : null,
                }
              : (() => {
                  // Use explicit side fields when provided (truthy check — empty string is not valid content)
                  if (s.sideAContent || s.sideBContent) {
                    return { sideAContent: s.sideAContent || null, sideBContent: s.sideBContent || null };
                  }
                  // Fallback: AI returned bullets instead of side content — split them
                  if (Array.isArray(s.sideABullets) && s.sideABullets.length > 0) {
                    return { sideAContent: s.sideABullets.join(" "), sideBContent: Array.isArray(s.sideBBullets) ? s.sideBBullets.join(" ") : null };
                  }
                  // Fallback: split content field in half between the two sides
                  const raw = (s.content ?? "").trim();
                  if (raw) {
                    const sentences = raw.split(/(?<=[.!?]['"'"\u2018\u2019\u201c\u201d]?)\s+/).filter((x: string) => x.trim());
                    const mid = Math.ceil(sentences.length / 2);
                    return { sideAContent: sentences.slice(0, mid).join(" ") || null, sideBContent: sentences.slice(mid).join(" ") || null };
                  }
                  return { sideAContent: null, sideBContent: null };
                })()),
          }),
          ...(isColumns && {
            columns: Array.isArray(s.columns)
              ? s.columns.slice(0, 4).map((c: any) => ({
                  label: typeof c.label === "string" ? c.label : "",
                  description: typeof c.description === "string" ? c.description : "",
                  imageQuery: typeof c.imageQuery === "string" && c.imageQuery.trim() ? c.imageQuery.trim() : null,
                }))
              : null,
          }),
          ...(slideType === "quiz" && {
            correctIndex: typeof s.correctIndex === "number" ? s.correctIndex : null,
          }),
          // Pass through any category-specific fields the AI returned that aren't
          // already covered by the standard post-processing above.
          ...(() => {
            const STANDARD_FIELDS = new Set([
              "title","slideType","imageQuery","imageStrategy","visualType",
              "columns","bullets","content","keyStatement","formulaBox",
              "sideALabel","sideBLabel","sideAContent","sideBContent",
              "sideABullets","sideBBullets","correctIndex",
            ]);
            return Object.fromEntries(
              Object.entries(s as Record<string, unknown>).filter(
                ([k, v]) => !STANDARD_FIELDS.has(k) && v != null && v !== "",
              ),
            );
          })(),
          imageQuery: isNoImg ? null : (s.imageQuery ?? null),
          imageStrategy: isNoImg ? null : ((s.imageStrategy === "literal" || s.imageStrategy === "metaphor") ? s.imageStrategy : null),
          visualType: isNoImg ? null : ((s.visualType === "diagram" || s.visualType === "photo") ? s.visualType : null),
          slideType,
        };
      })
      .filter((s: any) => {
        // Drop slides that have no renderable content
        if (s.slideType === "columns") {
          return Array.isArray(s.columns) && s.columns.length > 0;
        }
        if (s.slideType === "comparison") {
          const hasA = !!(s.sideAContent || (Array.isArray(s.sideABullets) && s.sideABullets.length));
          const hasB = !!(s.sideBContent || (Array.isArray(s.sideBBullets) && s.sideBBullets.length));
          return hasA || hasB;
        }
        // Keep if has standard content fields
        if (s.content && typeof s.content === "string" && s.content.trim()) return true;
        if (s.keyStatement && typeof s.keyStatement === "string" && s.keyStatement.trim()) return true;
        if (Array.isArray(s.bullets) && s.bullets.length > 0) return true;
        // Keep if has category-specific pass-through content (notation, mainParagraph, workedSteps, etc.)
        const STANDARD_FILTER_FIELDS = new Set([
          "title","slideType","imageQuery","imageStrategy","visualType",
          "columns","bullets","content","keyStatement","formulaBox",
          "sideALabel","sideBLabel","sideAContent","sideBContent",
          "sideABullets","sideBBullets","correctIndex",
        ]);
        return Object.entries(s as Record<string, unknown>).some(
          ([k, v]) => !STANDARD_FILTER_FIELDS.has(k) && v != null && v !== "" &&
            !(Array.isArray(v) && (v as unknown[]).length === 0)
        );
      });

    // ── Formula: remap stray "fact" slides to "explanation" ──────────────────
    // The AI sometimes ignores the sequence spec and outputs slideType:"fact" for
    // formula/grammar topics. Silently upgrade them so the deck stays on-structure.
    if (safeTopicType === "formula") {
      for (const s of slides as Array<Record<string, unknown>>) {
        if (s.slideType === "fact") s.slideType = "explanation";
      }
    }

    // ── Guarantee English imageQuery ──────────────────────────────────────────
    // Step 1: Clear any imageQuery the model wrote in Cyrillic script.
    const CYRILLIC_RE = /[\u0400-\u04FF]/;
    for (const s of slides as Array<Record<string, unknown>>) {
      if (typeof s.imageQuery === "string" && CYRILLIC_RE.test(s.imageQuery)) {
        s.imageQuery = null;
        s.imageStrategy = null;
        s.visualType = null;
      }
      // Also clear Cyrillic column imageQueries
      if (Array.isArray(s.columns)) {
        for (const col of s.columns as Array<Record<string, unknown>>) {
          if (typeof col.imageQuery === "string" && CYRILLIC_RE.test(col.imageQuery)) {
            col.imageQuery = null;
          }
        }
      }
    }

    // Step 2: If the deck appears non-English (Uzbek curriculum, Cyrillic/Arabic
    // in titles, or Uzbek Latin special chars), batch-translate all remaining
    // non-null imageQuery values to English in a single cheap call.
    const UZBEK_LATIN_RE = /[\u02BB\u2018\u2019\u02BC]|[oO][\u02BB\u2018\u2019\u02BC']|[gG][\u02BB\u2018\u2019\u02BC']/;
    const deckText = [parsed.deckTitle ?? "", ...slides.map((s: any) => s.title ?? "")].join(" ");
    const isNonEnglish =
      isUzbekCurriculum ||
      /[\u0400-\u04FF\u0600-\u06FF\u4E00-\u9FFF]/.test(deckText) ||
      UZBEK_LATIN_RE.test(deckText);

    let englishDeckTitle: string | null = null;

    if (isNonEnglish) {
      const deckTitleRaw = parsed.deckTitle ?? topic;
      // Include the deckTitle at index 0 so slide 0's imageQuery is also correctly sourced
      type TranslateItem = { i: number | "deck"; q: string } | { colSlide: number; colIdx: number; q: string };
      const toTranslate: TranslateItem[] = [
        { i: "deck", q: deckTitleRaw },
        ...(slides as Array<Record<string, unknown>>)
          .flatMap((s, i) => {
            const items: TranslateItem[] = [];
            if (typeof s.imageQuery === "string" && (s.imageQuery as string).trim()) {
              items.push({ i, q: s.imageQuery as string });
            }
            if (Array.isArray(s.columns)) {
              (s.columns as Array<Record<string, unknown>>).forEach((col, colIdx) => {
                if (typeof col.imageQuery === "string" && (col.imageQuery as string).trim()) {
                  items.push({ colSlide: i, colIdx, q: col.imageQuery as string });
                }
              });
            }
            return items;
          }),
      ];

      if (toTranslate.length > 0) {
        try {
          const tx = await openai.chat.completions.create({
            model: "gpt-4.1-nano",
            temperature: 0,
            messages: [
              {
                role: "user",
                content: `Translate each item to a concise English stock photo search term (3–5 words). Return ONLY a JSON array of strings in the same order, no extra text.\n${JSON.stringify(toTranslate.map((x) => x.q))}`,
              },
            ],
          });
          const translated = safeJsonParse(tx.choices[0]?.message?.content ?? "");
          if (Array.isArray(translated)) {
            toTranslate.forEach((item, tIdx) => {
              if (typeof translated[tIdx] === "string" && translated[tIdx].trim()) {
                if ("i" in item && item.i === "deck") {
                  englishDeckTitle = translated[tIdx].trim();
                } else if ("i" in item) {
                  (slides as Array<Record<string, unknown>>)[item.i as number].imageQuery = translated[tIdx].trim();
                } else if ("colSlide" in item) {
                  const cols = (slides as Array<Record<string, unknown>>)[item.colSlide].columns as Array<Record<string, unknown>>;
                  if (cols?.[item.colIdx]) {
                    cols[item.colIdx].imageQuery = translated[tIdx].trim();
                  }
                }
              }
            });
          }
        } catch {
          // Translation failed — leave imageQuery as-is; Pexels may still find something
        }
      }
    }

    return NextResponse.json({
      deckTitle: parsed.deckTitle ?? topic,
      englishDeckTitle,
      slides,
      isPrimary,
      topicType: safeTopicType,
      ...(debug && {
        _debug: {
          topicStructure: { topicType: safeTopicType, structureItems },
          ragLessons: debugRagLessons,
          ragContext: curriculumContext || null,
          outlinePrompt,
          sampleContentPrompt: debugSampleContentPrompt,
          outlineRaw,
        },
      }),
    });
  } catch (err: any) {
    console.error("Text generation error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
