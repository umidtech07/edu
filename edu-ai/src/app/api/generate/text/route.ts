import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

function safeJsonParse(text: string) {
  try {
    return JSON.parse(
      text
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim()
    );
  } catch {
    return null;
  }
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
    const effectiveSlideCount = isPrimary ? 5 : slideCount;

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
- "slideType": classify each slide as exactly one of: "intro" | "explanation" | "example" | "fact" | "comparison" | "reflection" | "question" | "quiz" | "recap"
  - "intro" — opening/title slide (always has an image)
  - "explanation" — teaches a key concept (can have an image)
  - "example" — concrete example or application (can have an image)
  - "fact" — surprising or interesting fact (can have an image)
  - "comparison" — compares two things, sides, or viewpoints (can have an image); MUST include "sideALabel", "sideBLabel", and either "sideABullets"+"sideBBullets" (primary) or "sideAContent"+"sideBContent" (secondary) — each side describes a DIFFERENT thing/perspective
  - "reflection" — asks students to think or reflect — imageQuery MUST be null
  - "question" — open discussion prompt — imageQuery MUST be null
  - "quiz" — true/false or multiple choice — imageQuery MUST be null
  - "recap" — summary or review — imageQuery MUST be null
  - Slides with slideType "reflection", "question", "quiz", or "recap" MUST have imageQuery: null, imageStrategy: null, visualType: null`;

    const prompt = isPrimary
      ? `Create a ${effectiveSlideCount}-slide lesson deck for young students (grades 1–4).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","bullets":["string"],"imageQuery":"string|null","imageStrategy":"literal"|"metaphor"|null,"visualType":"photo"|"diagram"|null,"slideType":"intro"|"explanation"|"example"|"fact"|"comparison"|"reflection"|"question"|"quiz"|"recap"}]}

Slide mix (vary types across the deck):
- intro (slide 1), explanation, example, interesting fact, comparison, reflection question, true/false quiz (no answer), recap

Content rules:
- Very simple and child-friendly language
- Bullets: max 12 words each, 3–5 bullets per slide
- 2–3 visual slides; rest have imageQuery: null, imageStrategy: null, and visualType: null
- When imageQuery is null, imageStrategy and visualType must also be null
- EVERY slide MUST have a non-empty "bullets" array with 3–5 bullets — no exceptions, including quiz, reflection, question, and recap slides
- For "comparison" slides: omit "bullets" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideABullets" (2–3 bullets about thing A), "sideBBullets" (2–3 bullets about thing B). Each side MUST describe a DIFFERENT thing or perspective.${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`
      : `Create a ${effectiveSlideCount}-slide lesson deck for upper-grade students (grades 5–8).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","content":"string","imageQuery":"string|null","imageStrategy":"literal"|"metaphor"|null,"visualType":"photo"|"diagram"|null,"slideType":"intro"|"explanation"|"example"|"fact"|"comparison"|"reflection"|"question"|"quiz"|"recap"}]}

Slide mix (vary types across the deck):
- intro (slide 1), explanation, example, interesting fact, comparison, reflection question, true/false quiz (no answer), recap

Content rules:
- "content" is a single paragraph of 2–3 sentences for grades 5-7 and 4-5 sentences for above explaining the slide topic clearly
- Use subject-specific vocabulary appropriate for the grade level
- Include concrete examples, data, or evidence where relevant
- 2–3 visual slides; quiz/reflection slides get imageQuery: null, imageStrategy: null, and visualType: null
- When imageQuery is null, imageStrategy and visualType must also be null
- EVERY slide MUST have a non-empty "content" field — no exceptions, including quiz, reflection, question, and recap slides
- For "comparison" slides: omit "content" and instead add "sideALabel" (name of thing A), "sideBLabel" (name of thing B), "sideAContent" (1–2 sentences about thing A), "sideBContent" (1–2 sentences about thing B). Each side MUST describe a DIFFERENT thing or perspective.${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`;

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

    const VALID_SLIDE_TYPES = ["intro","explanation","example","fact","comparison","reflection","question","quiz","recap"];
    const NO_IMAGE_SLIDE_TYPES = new Set(["reflection","question","quiz","recap"]);
    // Catch common AI variants that don't match the schema (e.g. "true_false", "true/false", "Comparison")
    const NO_IMAGE_TITLE_RE = /\b(quiz|true[\s/_-]?(?:or[\s/_-]?)?false|reflect(?:ion)?|recap|review)\b/i;

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
        const isNoImg = slideType
          ? NO_IMAGE_SLIDE_TYPES.has(slideType)
          : NO_IMAGE_TITLE_RE.test(s.title ?? "");
        const isComparison = slideType === "comparison";
        return {
          title: s.title ?? "",
          ...(isPrimary
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
            : {
                // Fallback: if AI omitted content but provided sideA/B (confused non-comparison slide), join them
                content: s.content || (!isComparison
                  ? [s.sideAContent, s.sideBContent].filter(Boolean).join(" ") || null
                  : null),
              }),
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
          imageQuery: isNoImg ? null : (s.imageQuery ?? (isComparison ? (s.title ?? null) : null)),
          imageStrategy: isNoImg ? null : ((s.imageStrategy === "literal" || s.imageStrategy === "metaphor") ? s.imageStrategy : (isComparison && !s.imageQuery ? "metaphor" : null)),
          visualType: isNoImg ? null : ((s.visualType === "diagram" || s.visualType === "photo") ? s.visualType : (isComparison && !s.imageQuery ? "photo" : null)),
          slideType,
        };
      });

    return NextResponse.json({
      deckTitle: parsed.deckTitle ?? topic,
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
