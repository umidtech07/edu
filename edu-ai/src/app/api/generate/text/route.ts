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
      const itemLines = items.length > 0
        ? items.map((item, i) => `  ${i + 3}. fact or explanation — "${item}"`).join("\n")
        : `  3–8. fact or explanation — one slide per subject`;
      const compSlide = items.length + 3;
      return `Slide sequence — COLLECTION (exactly 10 slides):
  1. intro
  2. columns (MANDATORY) — one card per subject; ${COLUMNS_CARD}
${itemLines}
  ${compSlide <= 9 ? compSlide : 9}. comparison — two most contrasting subjects
  10. recap`;
    }

    case "process": {
      const items = structureItems.slice(0, 5);
      const stepLines = items.length > 0
        ? items.map((step, i) => `  ${i + 4}. explanation — step ${i + 1}: "${step}"`).join("\n")
        : `  4–8. explanation — one slide per step`;
      const quizSlide = items.length + 4;
      return `Slide sequence — PROCESS (exactly 10 slides):
  1. intro
  2. explanation — overview
  3. columns (MANDATORY) — 3–4 stages as cards; ${COLUMNS_CARD}
${stepLines}
  ${quizSlide <= 9 ? quizSlide : 9}. quiz (no image)
  10. recap`;
    }

    case "narrative": {
      const items = structureItems.slice(0, 5);
      const phaseLines = items.length > 0
        ? items.map((phase, i) => `  ${i + 4}. ${i % 2 === 0 ? "explanation" : "fact"} — "${phase}"`).join("\n")
        : `  4–8. explanation or fact — one slide per phase/milestone`;
      const reflectSlide = items.length + 4;
      return `Slide sequence — NARRATIVE (exactly 10 slides):
  1. intro
  2. explanation — historical context
  3. columns (MANDATORY) — 3–4 key people/places/milestones as cards; ${COLUMNS_CARD}
${phaseLines}
  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection (no image)
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
      const causeLines = items.length > 0
        ? items.map((item, i) => `  ${i + 4}. ${i < Math.ceil(items.length / 2) ? "explanation" : "fact"} — "${item}"`).join("\n")
        : `  4–7. explanation or fact — one slide per cause or effect`;
      const compSlide = items.length + 4;
      const reflectSlide = items.length + 5;
      return `Slide sequence — CAUSE-EFFECT (exactly 10 slides):
  1. intro
  2. explanation — background context
  3. columns (MANDATORY) — 3–4 main causes as cards; ${COLUMNS_CARD}
${causeLines}
  ${compSlide <= 8 ? compSlide : 8}. comparison — key cause vs. key effect
  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection (no image)
  10. recap`;
    }

    case "formula": {
      const items = structureItems.slice(0, 5);
      const itemLines = items.length > 0
        ? items.map((item, i) => `  ${i + 4}. explanation — "${item}": exact notation + 2–3 examples`).join("\n")
        : `  4–8. explanation — one slide per form/rule/component`;
      const quizSlide = Math.min(items.length + 4, 9);
      return `Slide sequence — FORMULA/RULE (exactly 10 slides):
  1. intro
  2. explanation — NOTATION slide: full formula with **bold** components, all forms/variants
  3. columns (MANDATORY) — one card per component; ${COLUMNS_CARD}; imageQuery = metaphorical scene
${itemLines}
  ${quizSlide}. quiz (no image)
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

async function detectTopicStructure(
  topic: string,
): Promise<{ topicType: string; structureItems: string[] }> {
  // Request exactly 6 content items — matches the 6 content-slide slots in each category template
  const contentSlides = 6;
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Classify this lesson topic and extract its key structure.

Topic: "${topic}"

Choose ONE category:
- "collection"     — multiple distinct people, places, animals, or examples (e.g. "famous inventors", "world capitals")
- "process"        — a step-by-step sequence of how something works or happens (e.g. "water cycle", "how digestion works")
- "narrative"      — a chronological story or historical arc (e.g. "history of the internet", "the French Revolution")
- "comparison"     — explicitly comparing exactly two distinct things, sides, or viewpoints (e.g. "plants vs animals")
- "cause-effect"   — explains the causes and/or effects of something (e.g. "causes of climate change")
- "formula"        — a specific mathematical theorem, grammar tense/rule, or scientific law that can be expressed as a compact notation with discrete named components (e.g. "present perfect tense" → S+have/has+V3, "Pythagorean theorem" → a²+b²=c², "Newton's second law" → F=ma, "quadratic formula", "order of operations", "passive voice"). Domain MUST be mathematics, grammar/language, physics, or chemistry. Does NOT include: game rules, behavioral rules, life advice, or general principles.
- "single-subject" — one focused concept, organism, person, or idea that doesn't fit above (e.g. "photosynthesis", "Albert Einstein")

Then list ${contentSlides} specific items the lesson content should cover:
- collection    → the distinct subjects/people/places to include
- process       → the steps in order
- narrative     → key phases or milestones in chronological order
- comparison    → EXACTLY 2 items: the two things being compared
- cause-effect  → the main causes or effects to address
- formula       → the named forms, usage rules, or components to cover (e.g. for "present perfect": ["Affirmative form (S + have/has + V3)", "Negative form (S + haven't/hasn't + V3)", "Question form (Have/Has + S + V3?)", "Time expressions (already, just, yet, ever, never, since, for)", "Usage: completed actions with present result"])
- single-subject → return []

Return ONLY JSON: {"topicType": string, "structureItems": string[]}`,
        },
      ],
    });
    const parsed = safeJsonParse(result.choices[0]?.message?.content ?? "");
    if (
      parsed &&
      typeof parsed.topicType === "string" &&
      Array.isArray(parsed.structureItems)
    ) {
      return { topicType: parsed.topicType, structureItems: parsed.structureItems as string[] };
    }
  } catch {
    // Non-critical — fall back gracefully
  }
  return { topicType: "single-subject", structureItems: [] };
}

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

    // ── Topic structure pre-pass ───────────────────────────────────────────────
    // Classify the topic and extract structural items (subjects, steps, phases, etc.)
    // so the main prompt can enforce coverage diversity / ordering.
    const topicStructure = await detectTopicStructure(topic);
    const VALID_TOPIC_TYPES = ["collection", "process", "narrative", "comparison", "cause-effect", "formula", "single-subject"];
    const safeTopicType = VALID_TOPIC_TYPES.includes(topicStructure.topicType)
      ? topicStructure.topicType
      : "single-subject";
    const structureItems = topicStructure.structureItems;

    const categorySlideSequence = buildCategorySlideSequence(safeTopicType, structureItems, isPrimary);

    // ── Language handling ──────────────────────────────────────────────────────
    // "O'zbekiston MMTV" curriculum forces Uzbek/Russian output regardless of topic language.
    // For all other curricula, OpenAI auto-detects the topic language and responds in kind.
    // imageQuery is ALWAYS English so Pexels/Unsplash/Pixabay search works correctly.
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
        ? `\n- The topic is written in Russian. Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Russian.${imageQueryEnglishRule}`
        : `\n- Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Uzbek (Latin script).${imageQueryEnglishRule}`
      : `\n- Detect the language of the topic. Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in that same language. If the topic is in English, respond in English.${imageQueryEnglishRule}`;

    const visualTypeRule = `
- "visualType": "diagram" for cross-sections/timelines/cycles/anatomy/maps; "photo" for real objects/places/people; null for quiz/reflection/recap/columns.
- "imageStrategy" (photo only): "literal" = concrete thing a camera captures directly; "metaphor" = abstract concept shown as a vivid visual scene; null when visualType is diagram/null.`;

    const slideTypeRule = `
- "slideType": one of: "intro"|"explanation"|"example"|"fact"|"comparison"|"columns"|"reflection"|"question"|"quiz"|"recap"
  - "comparison": MUST include sideALabel, sideBLabel, and sideABullets+sideBBullets (primary) or sideAContent+sideBContent (secondary) — each side a DIFFERENT thing.
  - "columns": MUST include "columns" array of 2–4 objects: {"label":"string","description":"string","imageQuery":"string"}. Top-level imageQuery null. No bullets/content field.
  - MANDATORY columns: wherever the sequence marks "columns (MANDATORY)", output slideType:"columns" — never substitute another type.
  - "reflection", "question", "quiz", "recap", "columns": imageQuery, imageStrategy, visualType MUST all be null.`;

    const boldInstruction = buildBoldInstruction(safeTopicType);

    const formulaInstruction = safeTopicType === "formula"
      ? `\n\nFORMULA/RULE TOPIC — CRITICAL:
- The PRIMARY goal is to show STRUCTURE and NOTATION, not facts. Every slide must reinforce the formula.
- Slide 2 MUST prominently display the complete notation using exact symbols: + between parts, = for equations (e.g. **S** + **have/has** + **V3**, **a²** + **b²** = **c²**, **F** = **m** × **a**). Show ALL forms or variants on this slide.
- Slide 3 columns MUST break the formula into its named components — one card per component. Each column imageQuery MUST be a metaphorical scene representing that component (e.g. for "subject" → "person raising hand to speak in a group", for "helper verb" → "mechanic using a wrench to fix an engine", for "past participle" → "completed jigsaw puzzle on a table").
- Every explanation and example slide MUST include example sentences or worked calculations using the formula — do NOT write generic facts about the topic.
- NEVER use slideType "fact" — this is a formula topic. Every content slide must be "explanation" or "example". Slides with slideType "fact" will be rejected.`
      : "";

    const imageQueryUniquenessRule = `
- Every visual slide MUST have a non-null imageQuery — unique scene/subject/angle per slide, never the same concept twice across the deck.
- "literal": precise noun phrase for the concrete thing on that slide (e.g. "monarch butterfly on orange flower").
- "metaphor": vivid scene representing an abstract concept (e.g. for momentum: "freight train speeding through mountain tunnel at night").
- Avoid: single-word queries, "students learning", "teacher in classroom", generic clichés.`;

    const prompt = isPrimary
      ? `Create a ${effectiveSlideCount}-slide lesson deck for young students (grades 1–4).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","bullets":["string"],"imageQuery":"string|null","imageStrategy":"literal"|"metaphor"|null,"visualType":"photo"|"diagram"|null,"slideType":"intro"|"explanation"|"example"|"fact"|"comparison"|"columns"|"reflection"|"question"|"quiz"|"recap","columns":[{"label":"string","description":"string","imageQuery":"string"}]}]}

${categorySlideSequence}

Content rules:
- Very simple and child-friendly language
- Bullets: max 12 words each, 3–5 bullets per slide
- ALL intro, explanation, example, fact, and comparison slides MUST have a non-null imageQuery; only reflection, question, quiz, and recap slides have imageQuery: null
- When imageQuery is null, imageStrategy and visualType must also be null
- EVERY slide MUST have a non-empty "bullets" array with 3–5 bullets — no exceptions, including quiz, reflection, question, and recap slides
- For "comparison" slides: omit "bullets" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideABullets" (2–3 bullets about thing A), "sideBBullets" (2–3 bullets about thing B). Each side MUST describe a DIFFERENT thing or perspective.${boldInstruction}${imageQueryUniquenessRule}${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}${curriculumContext}${formulaInstruction}${languageInstruction}`
      : `Create a ${effectiveSlideCount}-slide lesson deck for upper-grade students (grades 5–8).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","content":"string","imageQuery":"string|null","imageStrategy":"literal"|"metaphor"|null,"visualType":"photo"|"diagram"|null,"slideType":"intro"|"explanation"|"example"|"fact"|"comparison"|"columns"|"reflection"|"question"|"quiz"|"recap","columns":[{"label":"string","description":"string","imageQuery":"string"}]}]}

${categorySlideSequence}

Content rules:
- "content" must be **5–6 sentences** for every slide — no shorter, no longer. Be creative and expressive: use **bold** for key terms, *italics* for emphasis or examples, and feel free to break the content into short indented sub-points or a mini-list when that helps clarity. Mix narrative prose with structured fragments — vary the format slide to slide so the deck feels alive.
- Use subject-specific vocabulary appropriate for the grade level
- Include concrete examples, data, vivid analogies, or surprising facts to make content memorable
- ALL intro, explanation, example, fact, and comparison slides MUST have a non-null imageQuery; only reflection, question, quiz, and recap slides have imageQuery: null
- When imageQuery is null, imageStrategy and visualType must also be null
- EVERY slide MUST have a non-empty "content" field — no exceptions, including quiz, reflection, question, and recap slides
- For "comparison" slides: omit "content" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideAContent" (2–3 rich sentences about thing A with bold/italic where helpful), "sideBContent" (2–3 rich sentences about thing B with bold/italic where helpful). Each side MUST describe a DIFFERENT thing or perspective.${boldInstruction}${imageQueryUniquenessRule}${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}${curriculumContext}${formulaInstruction}${languageInstruction}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.6,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const debugRawCompletion = raw;
    const parsed = safeJsonParse(raw);

    if (!parsed?.slides) {
      return NextResponse.json(
        { error: "Invalid JSON from OpenAI" },
        { status: 500 }
      );
    }

    const VALID_SLIDE_TYPES = ["intro","explanation","example","fact","comparison","columns","reflection","question","quiz","recap"];
    const NO_IMAGE_SLIDE_TYPES = new Set(["reflection","question","quiz","recap","columns"]);
    // Catch common AI variants that don't match the schema (e.g. "true_false", "true/false", "Comparison")
    // Also covers Uzbek Latin and Russian/Uzbek Cyrillic equivalents when slideType is null.
    const NO_IMAGE_TITLE_RE = /\b(quiz|true[\s/_-]?(?:or[\s/_-]?)?false|reflect(?:ion)?|recap|review|viktorina|xulosa|takrorlash|mulohaza|fikrlash)\b|викторин[аы]|тест(?![а-яёА-ЯЁ])|размышлени[еяй]|рефлекси[ия]|повторени[еяй]|хулоса|такрорлаш|мулоҳаза|фикрлаш/i;

    const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
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
                // Fallback: if AI omitted content but provided sideA/B (confused non-comparison slide), join them
                content: s.content || (!isComparison
                  ? [s.sideAContent, s.sideBContent].filter(Boolean).join(" ") || null
                  : null),
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
        // Primary: needs bullets; Secondary: needs content
        if (Array.isArray(s.bullets)) return s.bullets.length > 0;
        if ("content" in s) return !!(s.content && s.content.trim());
        return true;
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
          prompt,
          rawCompletion: debugRawCompletion,
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
