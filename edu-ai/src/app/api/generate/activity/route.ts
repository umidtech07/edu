import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

function safeJsonParse(text: string) {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try { return JSON.parse(clean); } catch { /* fall through */ }
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

/** Detect topic category when slides aren't available (activity-only mode). */
async function detectTopicType(topic: string): Promise<string> {
  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: `Classify this lesson topic into ONE category:
- "collection" — multiple distinct people/places/animals/examples
- "process" — step-by-step sequence of how something works
- "narrative" — chronological story or historical arc
- "comparison" — explicitly comparing two distinct things
- "cause-effect" — explains causes and/or effects of something
- "formula" — a mathematical theorem, grammar tense/rule, or scientific law with compact notation
- "single-subject" — one focused concept that doesn't fit above

Topic: "${topic}"
Return ONLY JSON: {"topicType":"string"}`,
        },
      ],
    });
    const parsed = safeJsonParse(result.choices[0]?.message?.content ?? "");
    const VALID = ["collection","process","narrative","comparison","cause-effect","formula","single-subject"];
    if (parsed?.topicType && VALID.includes(parsed.topicType)) return parsed.topicType;
  } catch { /* fall through */ }
  return "single-subject";
}

/** Build category-specific instructions for worksheet question focus. */
function buildCategoryActivityRules(topicType: string, isPrimary: boolean): string {
  switch (topicType) {
    case "formula":
      return `\nCategory focus (FORMULA): fill-in-the-blank = blank out notation (e.g. "S + ___ + V3"); multiple-choice = pick correct form for a scenario; matching = components to roles; short-answer = write own example.`;
    case "process":
      return `\nCategory focus (PROCESS): fill-in-the-blank = blank stage names/action verbs; multiple-choice = next step questions; matching = stages to outputs; short-answer = explain why a step matters.`;
    case "narrative":
      return `\nCategory focus (NARRATIVE): fill-in-the-blank = blank names/dates/events; multiple-choice = who/when/result questions; matching = people/places to roles; short-answer = explain significance.`;
    case "collection":
      return `\nCategory focus (COLLECTION): fill-in-the-blank = blank item names or defining traits; multiple-choice = "Which ___ is known for ___?"; matching = items to key facts; short-answer = compare two items.`;
    case "comparison":
      return `\nCategory focus (COMPARISON): fill-in-the-blank = blank which subject owns a property; multiple-choice = "Which subject has ___?"; matching = properties to subjects; short-answer = key difference or similarity.`;
    case "cause-effect":
      return `\nCategory focus (CAUSE-EFFECT): fill-in-the-blank = blank cause/effect names; multiple-choice = "What caused ___?" / "What was the effect?"; matching = causes to effects; short-answer = trace one cause to its effect.`;
    default:
      return `\nCategory focus (SINGLE SUBJECT): fill-in-the-blank = blank key technical term; multiple-choice = properties/functions/examples; matching = terms to definitions; short-answer = explain how/why.`;
  }
}

/** Strip images and non-content fields from slides for the activity prompt. */
function buildSlideSourceContent(slides: any[]): string {
  const SKIP_TYPES = new Set(["columns", "reflection", "question"]);
  const lines: string[] = [];
  for (const s of slides) {
    if (SKIP_TYPES.has(s.slideType)) continue;
    const title = s.title ?? "";
    // Gather text content
    const textParts: string[] = [];
    if (s.content && typeof s.content === "string") {
      // Strip markdown bold/italic for cleaner source
      textParts.push(s.content.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1"));
    }
    if (Array.isArray(s.bullets) && s.bullets.length > 0) {
      textParts.push(...s.bullets.map((b: string) => b.replace(/\*\*(.+?)\*\*/g, "$1")));
    }
    // Comparison sides
    if (s.sideALabel && s.sideBLabel) {
      const sideA = [s.sideAContent, ...(s.sideABullets ?? [])].filter(Boolean).join(" | ");
      const sideB = [s.sideBContent, ...(s.sideBBullets ?? [])].filter(Boolean).join(" | ");
      if (sideA) textParts.push(`${s.sideALabel}: ${sideA}`);
      if (sideB) textParts.push(`${s.sideBLabel}: ${sideB}`);
    }
    if (textParts.length > 0) {
      lines.push(`[${s.slideType ?? "slide"}] ${title}: ${textParts.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      grade = 5,
      curriculum = "",
      deckTitle = "",
      slides = null,
      topicType: passedTopicType = null,
    } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const isPrimary = Number(grade) <= 4;

    // Resolve topic type: use passed value, or detect if not available
    const topicType: string = passedTopicType ??
      (Array.isArray(slides) && slides.length > 0 ? "single-subject" : await detectTopicType(topic));

    // Build source content from slide deck when available
    const hasSlides = Array.isArray(slides) && slides.length > 0;
    const slideSourceContent = hasSlides ? buildSlideSourceContent(slides) : "";
    const sourceBlock = slideSourceContent
      ? `\nSLIDE DECK SOURCE MATERIAL (derive ALL questions and answers from this content — do not invent facts not present here):\n${slideSourceContent}\n`
      : "";

    const categoryRules = buildCategoryActivityRules(topicType, isPrimary);

    const isUzbekCurriculum = curriculum.replace(/[''']/g, "'").includes("O'zbekiston");
    const activityLanguageInstruction = isUzbekCurriculum
      ? "\n- Generate ALL activity text (titles, statements, questions, options, answers) in Uzbek (Latin script). If the topic is in Russian (Cyrillic), use Russian instead.\n- The 'imageQueries' array MUST always be in English."
      : "\n- Detect the language of the topic. Generate ALL activity text in that same language.\n- The 'imageQueries' array MUST always be in English.";

    const prompt = `Create a fun, engaging printable activity worksheet for Grade ${grade} students about: "${topic}"
${deckTitle ? `Lesson title: ${deckTitle}` : ""}${curriculum ? `\nCurriculum: ${curriculum}` : ""}
${sourceBlock}
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
- All content must be factually correct${hasSlides ? "\n- CRITICAL: Every question, statement, and answer MUST be directly derivable from the slide deck source material above — do not introduce facts that aren't in the slides" : ""}
${categoryRules}${activityLanguageInstruction}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0.5,
      response_format: { type: "json_object" },
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
