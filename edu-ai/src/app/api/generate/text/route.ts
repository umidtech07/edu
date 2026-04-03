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

// ── Phase 1: Outline prompt ────────────────────────────────────────────────
// Generates slide titles, slideTypes, imageQueries, and columns cards.
// Keeps the prompt focused on structure — content is deferred to phase 2.

function buildOutlinePrompt(params: {
  topic: string;
  grade: string;
  curriculum: string;
  curriculumContext: string;
  categorySlideSequence: string;
  effectiveSlideCount: number;
  isUzbekCurriculum: boolean;
  hasCyrillic: boolean;
}): string {
  const {
    topic, grade, curriculum, curriculumContext,
    categorySlideSequence, effectiveSlideCount,
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
  boldInstruction: string;
  formulaInstruction: string;
  languageInstruction: string;
  ragContext?: string; // reserved for Graph RAG integration
}): string {
  const {
    slide, slideIndex, totalSlides, topic, grade, deckTitle,
    outlineSummary, otherSlideTitles, isPrimary, boldInstruction, formulaInstruction,
    languageInstruction, ragContext,
  } = params;

  const isComparison = slide.slideType === "comparison";

  const schemaHint = isPrimary
    ? isComparison
      ? `{"sideALabel":"string","sideBLabel":"string","sideABullets":["string"],"sideBBullets":["string"]}`
      : `{"bullets":["string","string","string"]}`
    : isComparison
    ? `{"sideALabel":"string","sideBLabel":"string","sideAContent":"string","sideBContent":"string"}`
    : `{"content":"string"}`;

  const contentRules = isPrimary
    ? isComparison
      ? `- sideABullets and sideBBullets: 2–3 bullets each, max 12 words, child-friendly, about DIFFERENT things`
      : `- bullets: 3–5 items, max 12 words each, child-friendly language`
    : isComparison
    ? `- sideAContent and sideBContent: 2–3 rich sentences each about DIFFERENT things; use **bold** and *italics* for key terms`
    : `- content: 5–6 sentences; use **bold** for key terms, *italics* for emphasis; mix prose with short fragments; include concrete examples, data, or surprising facts`;

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

    // ── Topic structure pre-pass ───────────────────────────────────────────────
    const topicStructure = await detectTopicStructure(topic);
    const VALID_TOPIC_TYPES = ["collection", "process", "narrative", "comparison", "cause-effect", "formula", "single-subject"];
    const safeTopicType = VALID_TOPIC_TYPES.includes(topicStructure.topicType)
      ? topicStructure.topicType
      : "single-subject";
    const structureItems = topicStructure.structureItems;

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
        ? `\n- The topic is written in Russian. Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Russian.${imageQueryEnglishRule}`
        : `\n- Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Uzbek (Latin script).${imageQueryEnglishRule}`
      : `\n- Look at the WRITTEN SCRIPT of the topic text itself (not the subject matter). Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in that same written language. IMPORTANT: If the topic is written using Latin/English characters (e.g. "the timurid empire", "photosynthesis"), respond entirely in English — even if the subject is historically associated with another culture or region.${imageQueryEnglishRule}`;

    const boldInstruction = buildBoldInstruction(safeTopicType);

    const formulaInstruction = safeTopicType === "formula"
      ? `\n\nFORMULA/RULE TOPIC — CRITICAL:
- The PRIMARY goal is to show STRUCTURE and NOTATION, not facts. Every slide must reinforce the formula.
- Slide 2 MUST prominently display the complete notation using exact symbols: + between parts, = for equations (e.g. **S** + **have/has** + **V3**, **a²** + **b²** = **c²**, **F** = **m** × **a**). Show ALL forms or variants on this slide.
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
      effectiveSlideCount,
      isUzbekCurriculum,
      hasCyrillic,
    });

    const outlineCompletion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.4,
      max_tokens: 1400,
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
          model: "gpt-4.1-nano",
          temperature: 0.9,
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

    // Treat as `parsed` so the post-processing block below is unchanged.
    const parsed = { deckTitle: outlineParsed.deckTitle, slides: mergedSlides };

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
