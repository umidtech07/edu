import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

function buildCategorySlideSequence(
  topicType: string,
  structureItems: string[],
  isPrimary: boolean
): string {
  switch (topicType) {
    case "collection": {
      const items = structureItems.slice(0, 6);
      const itemLines = items.length > 0
        ? items.map((item, i) => `  ${i + 3}. fact or explanation — dedicated slide covering: "${item}"`).join("\n")
        : `  3–8. fact or explanation — one dedicated slide per subject in the collection`;
      const compSlide = items.length + 3;
      const recapSlide = items.length + 4;
      return `Slide sequence for this COLLECTION topic (${Math.max(recapSlide, 10)} slides in total; use exactly 10):
  1. intro — introduce the collection as a whole
  2. columns (MANDATORY) — one card per subject in the collection; each card: short label = subject name, description = one sentence about it, imageQuery = English photo search term for that subject
${itemLines}
  ${compSlide <= 9 ? compSlide : 9}. comparison — compare the two most contrasting subjects side by side
  10. recap — key takeaways from the full collection`;
    }

    case "process": {
      const items = structureItems.slice(0, 6);
      const stepLines = items.length > 0
        ? items.map((step, i) => `  ${i + 3}. explanation — step ${i + 1}: "${step}"`).join("\n")
        : `  3–8. explanation — one slide per step in sequence`;
      const quizSlide = items.length + 3;
      return `Slide sequence for this PROCESS topic (use exactly 10 slides):
  1. intro — introduce the process and why it matters
  2. explanation — overview: where and when this process occurs
${stepLines}
  ${quizSlide <= 9 ? quizSlide : 9}. quiz — true/false question about a key step (no answer given)
  10. recap — walk through the full process from start to finish`;
    }

    case "narrative": {
      const items = structureItems.slice(0, 6);
      const phaseLines = items.length > 0
        ? items.map((phase, i) => `  ${i + 3}. ${i % 2 === 0 ? "explanation" : "fact"} — "${phase}"`).join("\n")
        : `  3–8. explanation or fact — one slide per phase/milestone in chronological order`;
      const reflectSlide = items.length + 3;
      return `Slide sequence for this NARRATIVE topic (use exactly 10 slides):
  1. intro — set the scene and hook the audience
  2. explanation — historical context and background
${phaseLines}
  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection — what lessons does this story teach? (no image)
  10. recap — summarize the key moments and their lasting significance`;
    }

    case "comparison": {
      const thingA = structureItems[0] ?? "Subject A";
      const thingB = structureItems[1] ?? "Subject B";
      const compStyle = isPrimary ? "side-by-side visual comparison" : "analytical comparison";
      return `Slide sequence for this COMPARISON topic (use exactly 10 slides):
  1. intro — introduce both "${thingA}" and "${thingB}" and why comparing them is insightful
  2. explanation — background context needed to understand the comparison
  3. explanation — deep dive into "${thingA}": key features and characteristics
  4. explanation — deep dive into "${thingB}": key features and characteristics
  5. comparison — ${compStyle}: shared similarities between both
  6. comparison — ${compStyle}: key differences that set them apart
  7. comparison — ${compStyle}: strengths and weaknesses of each
  8. fact — a surprising fact that applies to both or highlights their contrast
  9. quiz — true/false question comparing the two (no answer given)
  10. recap — balanced summary: which excels at what, and overall takeaway`;
    }

    case "cause-effect": {
      const items = structureItems.slice(0, 4);
      const causeLines = items.length > 0
        ? items.map((item, i) => `  ${i + 4}. ${i < Math.ceil(items.length / 2) ? "explanation" : "fact"} — "${item}"`).join("\n")
        : `  4–7. explanation or fact — one slide per cause or effect`;
      const compSlide = items.length + 4;
      const reflectSlide = items.length + 5;
      return `Slide sequence for this CAUSE-EFFECT topic (use exactly 10 slides):
  1. intro — introduce the situation and why understanding it matters
  2. explanation — background: the root context or starting conditions
  3. columns (MANDATORY) — 3–4 main causes or contributing factors as visual cards; each card: label = cause name, description = one sentence explaining it, imageQuery = English photo search term
${causeLines}
  ${compSlide <= 8 ? compSlide : 8}. comparison — contrast the most important cause with the most significant effect
  ${reflectSlide <= 9 ? reflectSlide : 9}. reflection — what could have changed the outcome? (no image)
  10. recap — summarize causes, effects, and key lessons learned`;
    }

    default: // single-subject
      return `Slide sequence for this SINGLE-SUBJECT topic (use exactly 10 slides):
  1. intro — title/hook slide presenting the subject
  2. explanation — define or describe the subject clearly
  3. columns (MANDATORY) — 3–4 key features, parts, or characteristics as visual cards; each card: label = feature name, description = one sentence, imageQuery = English photo search term
  4. fact — surprising or little-known fact about the subject
  5. example — a real-world example or application
  6. explanation — how it works or why it matters (deeper layer)
  7. fact — another interesting fact from a different angle
  8. example — another example or use case showing variety
  9. quiz — one true/false question about the subject (no answer given)
  10. recap — summary of the main points`;
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
- "single-subject" — one focused concept, organism, person, or idea that doesn't fit above (e.g. "photosynthesis", "Albert Einstein")

Then list ${contentSlides} specific items the lesson content should cover:
- collection    → the distinct subjects/people/places to include
- process       → the steps in order
- narrative     → key phases or milestones in chronological order
- comparison    → EXACTLY 2 items: the two things being compared
- cause-effect  → the main causes or effects to address
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
    } = await req.json();

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
    const VALID_TOPIC_TYPES = ["collection", "process", "narrative", "comparison", "cause-effect", "single-subject"];
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
    const hasCyrillic = /[\u0400-\u04FF]/.test(topic);
    const imageQueryEnglishRule = `\n- CRITICAL: "imageQuery" is sent to English-language stock photo APIs. It MUST be written in English regardless of the topic language. Never write imageQuery in Uzbek, Russian, or any other language.\n  ✗ WRONG:   "imageQuery": "vulqon va tog' taqqoslash"\n  ✓ CORRECT: "imageQuery": "volcano mountain comparison"`;
    const languageInstruction = isUzbekCurriculum
      ? hasCyrillic
        ? `\n- The topic is written in Russian. Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Russian.${imageQueryEnglishRule}`
        : `\n- Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in Uzbek (Latin script).${imageQueryEnglishRule}`
      : `\n- Detect the language of the topic. Generate ALL slide text fields (deckTitle, title, bullets, content, sideALabel, sideBLabel, sideABullets, sideBBullets, sideAContent, sideBContent, and each column's label and description) in that same language. If the topic is in English, respond in English.${imageQueryEnglishRule}`;

    const visualTypeRule = `
- "visualType": choose based on what best illustrates the slide:
  - "diagram" — labeled cross-sections (volcano, cell, heart), timelines, process/cycle flows (photosynthesis, water cycle), food chains, historical sequences, anatomy, maps, system diagrams
  - "photo" — concrete real-world objects, animals, places, people, scenes that a photograph captures well
  - null — quiz, reflection, true/false, or recap slides that need no image
- "imageStrategy" (only when visualType is "photo"):
  - "literal" — the concept is CONCRETE (animal, object, landmark, food item) — a camera captures it directly; imageQuery is a short photo search term (e.g. "coral reef underwater", "bald eagle in flight")
  - "metaphor" — the concept is ABSTRACT (emotion, process, comparison, idea, rule) — imageQuery must describe a VISUAL SCENE that represents the concept (e.g. for "clear thinking" → "person following a well-marked path through a forest"; for "hard work" → "athlete training alone on a track at sunrise"; for "confusion" → "person staring at a tangled mess of road signs")
  - null — when visualType is "diagram" or null`;

    const slideTypeRule = `
- "slideType": classify each slide as exactly one of: "intro" | "explanation" | "example" | "fact" | "comparison" | "columns" | "reflection" | "question" | "quiz" | "recap"
  - "intro" — opening/title slide (always has an image)
  - "explanation" — teaches a key concept (can have an image)
  - "example" — concrete example or application (can have an image)
  - "fact" — surprising or interesting fact (can have an image)
  - "comparison" — compares two things, sides, or viewpoints (can have an image); MUST include "sideALabel", "sideBLabel", and either "sideABullets"+"sideBBullets" (primary) or "sideAContent"+"sideBContent" (secondary) — each side describes a DIFFERENT thing/perspective
  - "columns" — 2–4 items displayed side by side in a visual card grid; use for rules, tips, features, categories, or any content that benefits from multiple visual cards. MUST include a "columns" array of 2–4 objects, each: {"label":"string (short bold title)","description":"string (1 sentence)","imageQuery":"string (English stock photo search term)"}. Top-level imageQuery MUST be null. Do NOT include bullets or content for this slide type.
  - MANDATORY "columns" slides: wherever the slide sequence above marks a slide as "columns (MANDATORY)", you MUST output slideType: "columns" with a populated "columns" array — never substitute another slide type in that position.
  - "reflection" — asks students to think or reflect — imageQuery MUST be null
  - "question" — open discussion prompt — imageQuery MUST be null
  - "quiz" — true/false or multiple choice — imageQuery MUST be null
  - "recap" — summary or review — imageQuery MUST be null
  - Slides with slideType "reflection", "question", "quiz", or "recap" MUST have imageQuery: null, imageStrategy: null, visualType: null
  - Slides with slideType "columns" MUST have imageQuery: null, imageStrategy: null, visualType: null (images are inside each column object)`;

    const imageQueryUniquenessRule = `
- EVERY eligible slide (intro, explanation, example, fact, comparison) MUST have a non-null imageQuery — do NOT leave visual slides without one.
- CRITICAL — ALL imageQuery values across the entire deck MUST be visually distinct from each other. Each query must describe a clearly different scene, subject, angle, or setting. No two slides may share the same subject, action, or composition.
- Make each imageQuery highly specific to THAT slide's unique content — not just the general topic. Imagine you are picking a different photograph for each slide from a photo library, each one illustrating a distinct aspect.
  ✗ WRONG (all similar): "volcano eruption", "volcano lava", "volcano smoke"
  ✓ CORRECT (all distinct): "red hot magma flowing down mountain slope", "ash cloud rising above volcano crater aerial view", "geologist measuring volcanic rock samples up close"
- For "literal" imageStrategy: use a precise, descriptive noun phrase that names the specific object, animal, place, or scene depicted on that slide (e.g. "monarch butterfly on orange flower", "ancient roman aqueduct ruins").
- For "metaphor" imageStrategy: paint a vivid, concrete visual scene that metaphorically represents the abstract concept (e.g. for "momentum": "freight train speeding through a mountain tunnel at night"; for "teamwork": "rowers in a rowing shell perfectly synchronized on a misty river").
- Avoid generic stock-photo clichés: never use "students learning", "teacher in classroom", "people smiling", "colorful background", or single-word queries.`;

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
- For "comparison" slides: omit "bullets" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideABullets" (2–3 bullets about thing A), "sideBBullets" (2–3 bullets about thing B). Each side MUST describe a DIFFERENT thing or perspective.${imageQueryUniquenessRule}${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}${languageInstruction}`
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
- For "comparison" slides: omit "content" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideAContent" (2–3 rich sentences about thing A with bold/italic where helpful), "sideBContent" (2–3 rich sentences about thing B with bold/italic where helpful). Each side MUST describe a DIFFERENT thing or perspective.${imageQueryUniquenessRule}${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}${languageInstruction}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.6,
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
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
      });

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
    });
  } catch (err: any) {
    console.error("Text generation error:", err);
    return NextResponse.json(
      { error: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
