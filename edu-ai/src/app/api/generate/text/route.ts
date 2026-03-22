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
  - "comparison" — compares two things, sides, or viewpoints (can have an image)
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
- When imageQuery is null, imageStrategy and visualType must also be null${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`
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
- When imageQuery is null, imageStrategy and visualType must also be null${visualTypeRule}${slideTypeRule}${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`;

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
    // Catch common AI variants that don't match the schema (e.g. "true_false", "true/false")
    const NO_IMAGE_TITLE_RE = /\b(quiz|true[\s/_-]?(?:or[\s/_-]?)?false|reflect(?:ion)?|recap|review)\b/i;

    const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
      .slice(0, effectiveSlideCount)
      .map((s: any) => {
        const slideType = VALID_SLIDE_TYPES.includes(s.slideType) ? s.slideType : null;
        const isNoImg = slideType
          ? NO_IMAGE_SLIDE_TYPES.has(slideType)
          : NO_IMAGE_TITLE_RE.test(s.title ?? "");
        return {
          title: s.title ?? "",
          ...(isPrimary
            ? { bullets: Array.isArray(s.bullets) ? s.bullets : [] }
            : { content: s.content ?? "" }),
          imageQuery: isNoImg ? null : (s.imageQuery ?? null),
          imageStrategy: isNoImg ? null : ((s.imageStrategy === "literal" || s.imageStrategy === "metaphor") ? s.imageStrategy : null),
          visualType: isNoImg ? null : ((s.visualType === "diagram" || s.visualType === "photo") ? s.visualType : null),
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
