/**
 * One-time script: parses informatika_5_uzb.pdf and ingests lesson chunks
 * into Neo4j with OpenAI vector embeddings.
 *
 * Run from the project root:
 *   node scripts/ingest-curriculum.mjs
 *
 * Requires: NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD, OPENAI_API_KEY in .env.local
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Load .env.local ────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)="?([^"]*)"?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

// ── Imports (after env is set) ─────────────────────────────────────────────
import pdf from "pdf-parse/lib/pdf-parse.js";
import neo4j from "neo4j-driver";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Chapter map ────────────────────────────────────────────────────────────
const CHAPTER_MAP = {
  1: "I BOB. INFORMATIKA VA AXBOROT OLAMI",
  2: "I BOB. INFORMATIKA VA AXBOROT OLAMI",
  3: "I BOB. INFORMATIKA VA AXBOROT OLAMI",
  4: "I BOB. INFORMATIKA VA AXBOROT OLAMI",
  5: "I BOB. INFORMATIKA VA AXBOROT OLAMI",
  6: "II BOB. KOMPYUTER TEXNOLOGIYALARI",
  7: "II BOB. KOMPYUTER TEXNOLOGIYALARI",
  8: "II BOB. KOMPYUTER TEXNOLOGIYALARI",
  9: "II BOB. KOMPYUTER TEXNOLOGIYALARI",
  10: "III BOB. KOMPYUTER DASTURLARI",
  11: "III BOB. KOMPYUTER DASTURLARI",
  12: "III BOB. KOMPYUTER DASTURLARI",
  13: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  14: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  15: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  16: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  17: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  18: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  19: "IV BOB. MATN PROTSESSORIDA HUJJATLAR YARATISH",
  20: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  21: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  22: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  23: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  24: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  25: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  26: "V BOB. GRAFIK MUHARRIRLAR BILAN ISHLASH",
  27: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  28: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  29: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  30: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  31: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  32: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  33: "VI BOB. DASTURLASH TEXNOLOGIYASI",
  34: "VI BOB. DASTURLASH TEXNOLOGIYASI",
};

// ── PDF parsing ─────────────────────────────────────────────────────────────
function cleanText(raw) {
  return raw
    .replace(/http:\/\/eduportal\.uz/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // control chars
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLessons(fullText) {
  const lines = fullText.split("\n");
  const lessonStarts = []; // { lineIdx, lessonNum, title }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match "6-dars. KOMPYUTER VA UNING TUZILISHI" (mixed case)
    const m = line.match(/^(\d+)-dars\.\s+(.+)/i);
    if (m) {
      const num = parseInt(m[1], 10);
      // Skip duplicate — keep first occurrence per lesson number
      if (!lessonStarts.find((ls) => ls.lessonNum === num)) {
        // Title may continue on the next line (PDF line-wrap)
        // Only accept continuation if it looks like uppercase title text (no URLs, no digits)
        let title = m[2].trim();
        const next = (lines[i + 1] ?? "").trim();
        if (
          next &&
          next.length < 80 &&
          /^[A-Z\u2018\u2019\u02BB\u02BC'"\-\s()]+$/.test(next) && // uppercase + apostrophes only
          !/^\d+-dars\./i.test(next) &&
          !/^[IVX]+\s+BOB/i.test(next)
        ) {
          title = title + " " + next;
          i++; // consume the continuation line
        }
        // Clean: remove URLs and stray artifacts
        title = title.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
        lessonStarts.push({ lineIdx: i, lessonNum: num, title });
      }
    }
  }

  const lessons = [];
  for (let k = 0; k < lessonStarts.length; k++) {
    const start = lessonStarts[k];
    const endLine =
      k + 1 < lessonStarts.length ? lessonStarts[k + 1].lineIdx : lines.length;

    // Collect content lines between this lesson and the next
    const contentLines = lines.slice(start.lineIdx + 1, endLine).filter((l) => {
      const t = l.trim();
      // Skip page markers, page numbers, repeated uppercase headers
      if (!t) return false;
      if (t === "http://eduportal.uz") return false;
      if (/^\d+$/.test(t)) return false; // lone page numbers
      // Skip uppercase repeated lesson headers like "6-DARS."
      if (/^\d+-DARS\.\s*/i.test(t) && t === t.toUpperCase()) return false;
      // Skip chapter headers (all caps BOB lines)
      if (/^[IVX]+\s+BOB\./.test(t) && t.length < 60) return false;
      return true;
    });

    const content = cleanText(contentLines.join("\n"));
    if (content.length < 50) continue; // skip near-empty chunks

    lessons.push({
      lessonNum: start.lessonNum,
      title: start.title,
      chapter: CHAPTER_MAP[start.lessonNum] ?? "Unknown Chapter",
      content,
    });
  }

  return lessons;
}

// ── Embed with retry ──────────────────────────────────────────────────────
async function embed(text) {
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text.slice(0, 8000), // stay within token limit
  });
  return res.data[0].embedding;
}

// ── Neo4j ingestion ───────────────────────────────────────────────────────
async function ingest(lessons) {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
  );

  const session = driver.session();
  try {
    // Create vector index (idempotent)
    console.log("Creating vector index...");
    await session.run(`
      CREATE VECTOR INDEX lesson_embedding IF NOT EXISTS
      FOR (l:Lesson) ON l.embedding
      OPTIONS {
        indexConfig: {
          \`vector.dimensions\`: 1536,
          \`vector.similarity_function\`: 'cosine'
        }
      }
    `);

    // Clear existing grade-5 uzbek-dts lessons so re-run is safe
    await session.run(
      `MATCH (l:Lesson {curriculumKey: 'uzbek-dts', grade: 5}) DETACH DELETE l`
    );

    console.log(`Ingesting ${lessons.length} lessons...`);
    for (const lesson of lessons) {
      process.stdout.write(`  Embedding lesson ${lesson.lessonNum}: ${lesson.title.slice(0, 40)}...`);

      // Embed title + first 1500 chars of content for best semantic signal
      const textToEmbed = `${lesson.title}\n${lesson.content.slice(0, 1500)}`;
      const embedding = await embed(textToEmbed);

      await session.run(
        `CREATE (l:Lesson {
           curriculumKey: $curriculumKey,
           grade:         $grade,
           lessonNumber:  $lessonNum,
           title:         $title,
           chapter:       $chapter,
           content:       $content,
           embedding:     $embedding
         })`,
        {
          curriculumKey: "uzbek-dts",
          grade: 5,
          lessonNum: lesson.lessonNum,
          title: lesson.title,
          chapter: lesson.chapter,
          content: lesson.content.slice(0, 3000), // cap stored content
          embedding,
        }
      );

      console.log(" done");
    }

    console.log("\nAll lessons ingested.");
  } finally {
    await session.close();
    await driver.close();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const pdfPath = path.join(__dirname, "..", "src", "docs", "informatika_5_uzb.pdf");
  console.log("Parsing PDF:", pdfPath);
  const buf = fs.readFileSync(pdfPath);
  const data = await pdf(buf);
  console.log(`PDF has ${data.numpages} pages.`);

  const lessons = extractLessons(data.text);
  console.log(`Extracted ${lessons.length} lessons:`);
  lessons.forEach((l) =>
    console.log(`  ${l.lessonNum}. ${l.title} — ${l.content.length} chars`)
  );

  await ingest(lessons);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
