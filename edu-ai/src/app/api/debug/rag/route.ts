import { NextResponse } from "next/server";
import { searchCurriculum, formatCurriculumContext, compressCurriculumContext } from "@/lib/curriculum-rag";

export const runtime = "nodejs";

/**
 * Debug endpoint — shows exactly what the RAG pipeline retrieves and
 * what context string gets appended to the OpenAI prompt.
 *
 * POST /api/debug/rag
 * Body: { topic: string, grade?: number, topK?: number }
 */
export async function POST(req: Request) {
  const { topic, grade = 5, topK = 3 } = await req.json();

  if (!topic || typeof topic !== "string") {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const startMs = Date.now();
  let lessons: Awaited<ReturnType<typeof searchCurriculum>> = [];
  let ragError: string | null = null;

  try {
    lessons = await searchCurriculum(topic, "uzbek-dts", grade, topK);
  } catch (err: any) {
    ragError = err?.message ?? String(err);
  }

  const elapsedMs = Date.now() - startMs;

  // rawContext: old truncated version (400 chars/lesson) — kept for comparison
  const rawContext = formatCurriculumContext(lessons);
  // compressedContext: what actually gets injected into the prompt now
  const compressedContext = await compressCurriculumContext(topic, lessons);

  // Build a representative snippet of what the final prompt looks like
  // (mirrors the appending logic in /api/generate/text/route.ts)
  const promptSnippet = compressedContext
    ? `...${compressedContext}\n[rest of slide generation prompt]`
    : "[no RAG context — curriculumContext is empty string, nothing appended to prompt]";

  return NextResponse.json({
    meta: {
      topic,
      grade,
      topK,
      elapsedMs,
      lessonsFound: lessons.length,
      ragError,
      neo4jConfigured: !!(
        process.env.NEO4J_URI &&
        process.env.NEO4J_USER &&
        process.env.NEO4J_PASSWORD
      ),
    },
    lessons,
    rawContext: rawContext || null,
    compressedContext: compressedContext || null,
    promptSnippet,
  });
}
