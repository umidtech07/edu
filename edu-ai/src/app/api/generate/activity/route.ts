import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

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
    const { topic, grade = 5, curriculum = "", deckTitle = "" } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const isPrimary = Number(grade) <= 4;

    const isUzbekCurriculum = curriculum.replace(/[''']/g, "'").includes("O'zbekiston");
    const activityLanguageInstruction = isUzbekCurriculum
      ? "\n- Generate ALL activity text (titles, statements, questions, options, answers) in Uzbek (Latin script). If the topic is in Russian (Cyrillic), use Russian instead.\n- The 'imageQueries' array MUST always be in English."
      : "\n- Detect the language of the topic. Generate ALL activity text in that same language.\n- The 'imageQueries' array MUST always be in English.";

    const prompt = `Create a fun, engaging printable activity worksheet for Grade ${grade} students about: "${topic}"
${deckTitle ? `Lesson title: ${deckTitle}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}

Return ONLY valid JSON with this exact structure:
{
  "sheetTitle": "string (fun title for the worksheet)",
  "imageQueries": ["query1", "query2", "query3"],
  "activities": [
    {
      "type": "true-false",
      "title": "string",
      "emoji": "string (1 emoji)",
      "items": [{"statement": "string", "answer": true}]
    },
    {
      "type": "fill-in-the-blank",
      "title": "string",
      "emoji": "string",
      ${isPrimary ? `"wordBank": ["w1","w2","w3","w4","w5","w6","w7","w8"],` : ""}
      "items": [{"text": "The ___ is ...", "answer": "word"}]
    },
    {
      "type": "multiple-choice",
      "title": "string",
      "emoji": "string",
      "items": [{"question": "string", "options": ["A. opt","B. opt","C. opt","D. opt"], "answer": "A"}]
    },
    {
      "type": "matching",
      "title": "string",
      "emoji": "string",
      "pairs": [{"left": "string", "right": "string"}]
    },
    {
      "type": "short-answer",
      "title": "string",
      "emoji": "string",
      "questions": ["string"]
    }
  ]
}

Rules:
- true-false: 4 statements, keep them short and clear
- fill-in-the-blank: 4 sentences${isPrimary ? "; wordBank has 8 words (4 answers + 4 distractors)" : " (no word bank)"}; ___ marks the blank
- multiple-choice: 3 questions, 4 options each, answer is just the letter (A/B/C/D)
- matching: 4 pairs, concept on left, definition/example on right
- short-answer: 2 open questions, not heavily worded
- imageQueries: 3 search phrases for topic-relevant small illustrations (e.g. "volcano eruption cartoon", "cell biology diagram")
- Use ${isPrimary ? "simple, fun" : "clear, age-appropriate"} language for Grade ${grade}${curriculum ? ` (${curriculum})` : ""}
- Vary question difficulty — mix easy and medium
- All content must be factually correct${activityLanguageInstruction}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.5,
      messages: [
        { role: "system", content: "Return strict JSON only. No markdown, no extra text." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = safeJsonParse(raw);

    if (!parsed?.activities) {
      console.error("Activity parse failed. Raw response:", raw.slice(0, 500));
      return NextResponse.json({ error: "Invalid response from OpenAI", raw: raw.slice(0, 300) }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (err: any) {
    console.error("Activity generation error:", err);
    return NextResponse.json({ error: err?.message ?? "unknown error" }, { status: 500 });
  }
}
