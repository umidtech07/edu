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

    const prompt = isPrimary
      ? `Create a ${effectiveSlideCount}-slide lesson deck for young students (grades 1–4).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","bullets":["string"],"imageQuery":"string|null"}]}

Slide mix (vary types across the deck):
- explanation, example, interesting fact, reflection question, true/false quiz (no answer), recap

Content rules:
- Very simple and child-friendly language
- Bullets: max 12 words each, 3–5 bullets per slide
- 2–3 visual slides; rest have imageQuery: null${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`
      : `Create a ${effectiveSlideCount}-slide lesson deck for upper-grade students (grades 5–8).

Topic: ${topic}${grade ? `\nGrade: ${grade}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON:
{"deckTitle":"string","slides":[{"title":"string","content":"string","imageQuery":"string|null"}]}

Slide mix (vary types across the deck):
- explanation, example, interesting fact, reflection question, true/false quiz (no answer), recap

Content rules:
- "content" is a single paragraph of 2–3 sentences for grades 5-7 and 4-5 sentences for above explaining the slide topic clearly
- Use subject-specific vocabulary appropriate for the grade level
- Include concrete examples, data, or evidence where relevant
- 2–3 visual slides; quiz/reflection slides get imageQuery: null${curriculum ? `\n- Follow ${curriculum} curriculum terminology and objectives` : ""}`;

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

    const slides = (Array.isArray(parsed.slides) ? parsed.slides : [])
      .slice(0, effectiveSlideCount)
      .map((s: any) => ({
        title: s.title ?? "",
        ...(isPrimary
          ? { bullets: Array.isArray(s.bullets) ? s.bullets : [] }
          : { content: s.content ?? "" }),
        imageQuery: s.imageQuery ?? null,
      }));

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
