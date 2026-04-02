import { getDriver } from "@/lib/neo4j";
import { openai } from "@/lib/openai";

export interface CurriculumLesson {
  lessonNumber: number;
  title: string;
  chapter: string;
  content: string;
  score: number;
}

/**
 * Embeds the given topic and retrieves the top-K most relevant curriculum
 * lessons from Neo4j via vector similarity search.
 *
 * Returns an empty array if NEO4J_* env vars are missing or the index
 * doesn't exist yet (so existing slide generation still works).
 */
export async function searchCurriculum(
  topic: string,
  curriculumKey: "uzbek-dts",
  grade: number,
  topK = 3
): Promise<CurriculumLesson[]> {
  try {
    // Embed the topic query
    const embRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: topic,
    });
    const embedding = embRes.data[0].embedding;

    const driver = getDriver();
    const session = driver.session();
    try {
      const result = await session.run(
        `CALL db.index.vector.queryNodes('lesson_embedding', $topK, $embedding)
         YIELD node, score
         WHERE node.curriculumKey = $curriculumKey AND node.grade = $grade
         RETURN node.lessonNumber   AS lessonNumber,
                node.title          AS title,
                node.chapter        AS chapter,
                node.content        AS content,
                score
         ORDER BY score DESC`,
        { topK, embedding, curriculumKey, grade }
      );

      return result.records.map((r) => ({
        lessonNumber: r.get("lessonNumber").toNumber?.() ?? r.get("lessonNumber"),
        title: r.get("title") as string,
        chapter: r.get("chapter") as string,
        content: r.get("content") as string,
        score: r.get("score") as number,
      }));
    } finally {
      await session.close();
    }
  } catch {
    // Non-fatal: RAG is best-effort; slide generation continues without it
    return [];
  }
}

/**
 * Formats retrieved lessons into a compact prompt block.
 * Used as a lightweight fallback when compression is unavailable.
 */
export function formatCurriculumContext(lessons: CurriculumLesson[]): string {
  if (lessons.length === 0) return "";
  const items = lessons
    .map(
      (l) =>
        `- [Dars ${l.lessonNumber}] ${l.title} (${l.chapter})\n  ${l.content.slice(0, 400).replace(/\n/g, " ")}`
    )
    .join("\n");
  return `\nO'zbekiston DTS curriculum context (use these learning objectives and terminology):\n${items}`;
}

/**
 * Uses the full lesson content (no truncation) and asks gpt-4.1-nano to
 * distill it into a structured ~200-word context block before it reaches
 * the main prompt. Falls back to formatCurriculumContext on any error.
 */
export async function compressCurriculumContext(
  topic: string,
  lessons: CurriculumLesson[]
): Promise<string> {
  if (lessons.length === 0) return "";

  const rawContent = lessons
    .map((l) => `[Dars ${l.lessonNumber}: ${l.title} — ${l.chapter}]\n${l.content}`)
    .join("\n\n");

  try {
    const result = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      temperature: 0,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are a curriculum assistant. The following are textbook excerpts for the topic "${topic}".

Extract the most important information in this exact structure (preserve all terminology in the original language of the text):
1. Key vocabulary: up to 6 terms with brief definitions (one line each)
2. Core concepts: 2–3 sentences summarizing what students must understand
3. Key facts or examples: up to 3 specific facts, numbers, or examples from the text

Total output must not exceed 200 words.

Textbook content:
${rawContent}`,
        },
      ],
    });

    const compressed = result.choices[0]?.message?.content?.trim() ?? "";
    if (!compressed) return formatCurriculumContext(lessons);

    return `\nO'zbekiston DTS curriculum context (use these learning objectives and terminology):\n${compressed}`;
  } catch {
    // Non-fatal: fall back to simple formatter
    return formatCurriculumContext(lessons);
  }
}
