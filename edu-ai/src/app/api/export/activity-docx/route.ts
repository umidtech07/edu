import { NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  ImageRun,
  TableLayoutType,
  VerticalAlign,
  convertInchesToTwip,
} from "docx";

export const runtime = "nodejs";

// ── Design tokens ──────────────────────────────────────────────────────────
const GREEN_HEX = "166534";
const GREEN_LIGHT_HEX = "DCFCE7";
const GREEN_MID_HEX = "16A34A";
const BLACK_HEX = "302F2D";
const WHITE_HEX = "FFFFFF";

// ── Helpers ────────────────────────────────────────────────────────────────
function sanitize(t: string): string {
  return (t ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ");
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith("data:")) {
      const b64 = url.split(",")[1] ?? "";
      return Buffer.from(b64, "base64");
    }
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

async function searchPexelsSquare(query: string): Promise<string | null> {
  if (!process.env.PEXELS_API_KEY) return null;
  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", "3");
    url.searchParams.set("orientation", "square");
    const res = await fetch(url.toString(), {
      headers: { Authorization: process.env.PEXELS_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data.photos?.[0];
    return photo?.src?.medium ?? photo?.src?.large ?? null;
  } catch {
    return null;
  }
}

// ── Paragraph builders ─────────────────────────────────────────────────────
function headerPara(text: string) {
  return new Paragraph({
    children: [
      new TextRun({
        text: sanitize(text),
        bold: true,
        size: 44, // 22pt
        color: WHITE_HEX,
        font: "Arial Black",
      }),
    ],
    alignment: AlignmentType.CENTER,
    shading: { type: ShadingType.SOLID, color: GREEN_HEX, fill: GREEN_HEX },
    spacing: { before: 80, after: 80 },
  });
}

function subHeaderPara(text: string) {
  return new Paragraph({
    children: [
      new TextRun({
        text: sanitize(text),
        bold: true,
        size: 24,
        color: GREEN_HEX,
        font: "Arial",
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { before: 40, after: 40 },
  });
}

function nameDateRow() {
  const line = (label: string) =>
    new TableCell({
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: `${label}: `, bold: true, size: 20, font: "Arial" }),
            new TextRun({ text: "_".repeat(28), size: 20, font: "Courier New" }),
          ],
        }),
      ],
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: [line("Name"), line("Date"), line("Class")] })],
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    layout: TableLayoutType.FIXED,
  });
}

function noBorder() {
  return { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
}

function thickBorder(color = BLACK_HEX) {
  return { style: BorderStyle.THICK, size: 6, color };
}

function sectionHeader(emoji: string, title: string, num: number) {
  return new Paragraph({
    children: [
      new TextRun({
        text: `  ${emoji}  ${num}. ${sanitize(title)}  `,
        bold: true,
        size: 28,
        color: WHITE_HEX,
        font: "Arial Black",
      }),
    ],
    shading: { type: ShadingType.SOLID, color: BLACK_HEX, fill: BLACK_HEX },
    spacing: { before: 200, after: 120 },
  });
}

function spacer(pt = 80) {
  return new Paragraph({ children: [], spacing: { before: pt, after: 0 } });
}

function bullet(text: string, symbol = "▸") {
  return new Paragraph({
    children: [
      new TextRun({ text: `${symbol}  `, bold: true, color: GREEN_MID_HEX, size: 22, font: "Arial" }),
      new TextRun({ text: sanitize(text), size: 22, font: "Arial" }),
    ],
    spacing: { before: 60, after: 60 },
    indent: { left: convertInchesToTwip(0.25) },
  });
}

function answerLine() {
  return new Paragraph({
    children: [
      new TextRun({ text: "_".repeat(72), color: "AAAAAA", size: 20, font: "Courier New" }),
    ],
    spacing: { before: 80, after: 80 },
    indent: { left: convertInchesToTwip(0.4) },
  });
}

// ── Activity renderers ─────────────────────────────────────────────────────
function renderTrueFalse(activity: any, num: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    sectionHeader(activity.emoji ?? "✅", activity.title, num),
    new Paragraph({
      children: [new TextRun({ text: "Circle  T  for True  or  F  for False.", italics: true, size: 20, color: "555555", font: "Arial" })],
      spacing: { before: 0, after: 100 },
    }),
  ];

  for (let i = 0; i < (activity.items ?? []).length; i++) {
    const item = activity.items[i];
    blocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({
            children: [
              // Index
              new TableCell({
                width: { size: 5, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: `${i + 1}.`, bold: true, size: 22, font: "Arial" })], alignment: AlignmentType.RIGHT })],
                borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
                verticalAlign: VerticalAlign.CENTER,
              }),
              // T circle
              new TableCell({
                width: { size: 8, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: "  T  ", bold: true, size: 24, font: "Arial Black", color: GREEN_HEX })], alignment: AlignmentType.CENTER })],
                shading: { type: ShadingType.SOLID, color: GREEN_LIGHT_HEX, fill: GREEN_LIGHT_HEX },
                borders: { top: thickBorder(GREEN_HEX), bottom: thickBorder(GREEN_HEX), left: thickBorder(GREEN_HEX), right: thickBorder(GREEN_HEX) },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 60, bottom: 60, left: 60, right: 60 },
              }),
              // F circle
              new TableCell({
                width: { size: 8, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: "  F  ", bold: true, size: 24, font: "Arial Black", color: BLACK_HEX })], alignment: AlignmentType.CENTER })],
                borders: { top: thickBorder(), bottom: thickBorder(), left: thickBorder(), right: thickBorder() },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 60, bottom: 60, left: 60, right: 60 },
              }),
              // Statement
              new TableCell({
                width: { size: 79, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: sanitize(item.statement), size: 22, font: "Arial" })], indent: { left: 120 } })],
                borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 80, bottom: 80, left: 120, right: 0 },
              }),
            ],
          }),
        ],
        borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
      })
    );
    blocks.push(spacer(60));
  }
  return blocks;
}

function renderFillBlank(activity: any, num: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    sectionHeader(activity.emoji ?? "✏️", activity.title, num),
  ];

  if (activity.wordBank?.length) {
    // Word bank box
    blocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: "📦 Word Bank: ", bold: true, size: 22, font: "Arial Black", color: GREEN_HEX })],
                    spacing: { before: 60, after: 40 },
                  }),
                  new Paragraph({
                    children: activity.wordBank.map((w: string, i: number) => [
                      new TextRun({ text: `  ${sanitize(w)}  `, bold: true, size: 22, font: "Arial", color: BLACK_HEX }),
                      i < activity.wordBank.length - 1 ? new TextRun({ text: "│", size: 22, color: GREEN_MID_HEX }) : new TextRun({ text: "" }),
                    ]).flat(),
                    spacing: { before: 0, after: 60 },
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                borders: { top: thickBorder(GREEN_HEX), bottom: thickBorder(GREEN_HEX), left: thickBorder(GREEN_HEX), right: thickBorder(GREEN_HEX) },
                shading: { type: ShadingType.SOLID, color: GREEN_LIGHT_HEX, fill: GREEN_LIGHT_HEX },
                margins: { top: 80, bottom: 80, left: 160, right: 160 },
              }),
            ],
          }),
        ],
      })
    );
    blocks.push(spacer(80));
  } else {
    blocks.push(new Paragraph({
      children: [new TextRun({ text: "Complete each sentence with the correct word.", italics: true, size: 20, color: "555555", font: "Arial" })],
      spacing: { before: 0, after: 100 },
    }));
  }

  for (let i = 0; i < (activity.items ?? []).length; i++) {
    const item = activity.items[i];
    blocks.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}.  `, bold: true, size: 22, font: "Arial" }),
          new TextRun({ text: sanitize(item.text), size: 22, font: "Arial" }),
        ],
        spacing: { before: 80, after: 40 },
      })
    );
  }
  return blocks;
}

function renderMultipleChoice(activity: any, num: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    sectionHeader(activity.emoji ?? "🔘", activity.title, num),
    new Paragraph({
      children: [new TextRun({ text: "Circle the correct answer.", italics: true, size: 20, color: "555555", font: "Arial" })],
      spacing: { before: 0, after: 100 },
    }),
  ];

  for (let i = 0; i < (activity.items ?? []).length; i++) {
    const item = activity.items[i];
    blocks.push(
      new Paragraph({
        children: [new TextRun({ text: `${i + 1}.  ${sanitize(item.question)}`, bold: true, size: 22, font: "Arial" })],
        spacing: { before: 100, after: 60 },
      })
    );
    for (const opt of item.options ?? []) {
      blocks.push(
        new Paragraph({
          children: [
            new TextRun({ text: "  ○  ", bold: true, size: 22, color: GREEN_MID_HEX, font: "Arial" }),
            new TextRun({ text: sanitize(opt), size: 22, font: "Arial" }),
          ],
          spacing: { before: 40, after: 40 },
          indent: { left: convertInchesToTwip(0.3) },
        })
      );
    }
    blocks.push(spacer(60));
  }
  return blocks;
}

function renderMatching(activity: any, num: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    sectionHeader(activity.emoji ?? "🔗", activity.title, num),
    new Paragraph({
      children: [new TextRun({ text: "Draw a line to match each item on the left with its pair on the right.", italics: true, size: 20, color: "555555", font: "Arial" })],
      spacing: { before: 0, after: 120 },
    }),
  ];

  const pairs: { left: string; right: string }[] = activity.pairs ?? [];
  const shuffledRight = [...pairs].sort(() => Math.random() - 0.5).map(p => p.right);

  const rows = pairs.map((pair, i) =>
    new TableRow({
      children: [
        new TableCell({
          width: { size: 42, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `${i + 1}.  `, bold: true, size: 22, color: GREEN_HEX, font: "Arial" }),
                new TextRun({ text: sanitize(pair.left), size: 22, font: "Arial" }),
              ],
            }),
          ],
          shading: { type: ShadingType.SOLID, color: GREEN_LIGHT_HEX, fill: GREEN_LIGHT_HEX },
          borders: { top: thickBorder(GREEN_HEX), bottom: thickBorder(GREEN_HEX), left: thickBorder(GREEN_HEX), right: thickBorder(GREEN_HEX) },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          width: { size: 16, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [new TextRun({ text: "  ___  ", size: 22, color: "AAAAAA", font: "Courier New" })], alignment: AlignmentType.CENTER })],
          borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() },
          verticalAlign: VerticalAlign.CENTER,
        }),
        new TableCell({
          width: { size: 42, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: `${String.fromCharCode(65 + i)}.  `, bold: true, size: 22, color: BLACK_HEX, font: "Arial" }),
                new TextRun({ text: sanitize(shuffledRight[i]), size: 22, font: "Arial" }),
              ],
            }),
          ],
          borders: { top: thickBorder(), bottom: thickBorder(), left: thickBorder(), right: thickBorder() },
          margins: { top: 100, bottom: 100, left: 120, right: 120 },
          verticalAlign: VerticalAlign.CENTER,
        }),
      ],
    })
  );

  blocks.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.FIXED,
      rows,
      borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
    })
  );
  return blocks;
}

function renderShortAnswer(activity: any, num: number): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [
    sectionHeader(activity.emoji ?? "💬", activity.title, num),
    new Paragraph({
      children: [new TextRun({ text: "Write your answers in full sentences.", italics: true, size: 20, color: "555555", font: "Arial" })],
      spacing: { before: 0, after: 100 },
    }),
  ];

  for (let i = 0; i < (activity.questions ?? []).length; i++) {
    const q = activity.questions[i];
    blocks.push(
      new Paragraph({
        children: [new TextRun({ text: `${i + 1}.  ${sanitize(q)}`, bold: true, size: 22, font: "Arial" })],
        spacing: { before: 100, after: 80 },
      })
    );
    blocks.push(answerLine());
    blocks.push(answerLine());
    blocks.push(answerLine());
    blocks.push(spacer(60));
  }
  return blocks;
}

// ── Answer key ─────────────────────────────────────────────────────────────
function buildAnswerKey(activities: any[]): Paragraph[] {
  const paras: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: "✦  Answer Key  ✦", bold: true, size: 32, color: WHITE_HEX, font: "Arial Black" })],
      alignment: AlignmentType.CENTER,
      shading: { type: ShadingType.SOLID, color: BLACK_HEX, fill: BLACK_HEX },
      spacing: { before: 400, after: 200 },
      pageBreakBefore: true,
    }),
  ];

  for (let ai = 0; ai < activities.length; ai++) {
    const a = activities[ai];
    paras.push(
      new Paragraph({
        children: [new TextRun({ text: `${a.emoji ?? ""} ${ai + 1}. ${sanitize(a.title)}`, bold: true, size: 24, color: GREEN_HEX, font: "Arial" })],
        spacing: { before: 160, after: 80 },
      })
    );

    if (a.type === "true-false") {
      for (let i = 0; i < (a.items ?? []).length; i++) {
        paras.push(bullet(`${i + 1}.  ${a.items[i].answer ? "True ✓" : "False ✗"}`, ""));
      }
    } else if (a.type === "fill-in-the-blank") {
      for (let i = 0; i < (a.items ?? []).length; i++) {
        paras.push(bullet(`${i + 1}.  ${sanitize(a.items[i].answer)}`, ""));
      }
    } else if (a.type === "multiple-choice") {
      for (let i = 0; i < (a.items ?? []).length; i++) {
        paras.push(bullet(`${i + 1}.  ${a.items[i].answer}`, ""));
      }
    } else if (a.type === "matching") {
      for (let i = 0; i < (a.pairs ?? []).length; i++) {
        paras.push(bullet(`${i + 1}.  ${sanitize(a.pairs[i].left)}  →  ${sanitize(a.pairs[i].right)}`, ""));
      }
    }
  }

  return paras;
}

// ── Main handler ──────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      sheetTitle = "Activity Sheet",
      activities = [],
      imageQueries = [],
      topic = "",
      grade,
      deckTitle = "",
    } = body;

    // Fetch up to 3 topic images in parallel (best-effort)
    const imageUrls = await Promise.all(
      (imageQueries as string[]).slice(0, 3).map((q) => searchPexelsSquare(q))
    );
    const imageBuffers = await Promise.all(
      imageUrls.map((url) => (url ? fetchImageBytes(url) : Promise.resolve(null)))
    );

    // ── Build image paragraph helper ──────────────────────────────────────
    function imageRow(bufs: (Buffer | null)[]): Table | null {
      const valid = bufs.filter(Boolean) as Buffer[];
      if (!valid.length) return null;

      const cells = valid.slice(0, 3).map((buf) =>
        new TableCell({
          width: { size: Math.floor(100 / valid.length), type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              children: [
                new ImageRun({
                  data: buf,
                  transformation: { width: 130, height: 130 },
                  type: "jpg",
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 60, after: 60 },
            }),
          ],
          borders: { top: thickBorder(GREEN_HEX), bottom: thickBorder(GREEN_HEX), left: thickBorder(GREEN_HEX), right: thickBorder(GREEN_HEX) },
          margins: { top: 80, bottom: 80, left: 80, right: 80 },
          shading: { type: ShadingType.SOLID, color: GREEN_LIGHT_HEX, fill: GREEN_LIGHT_HEX },
          verticalAlign: VerticalAlign.CENTER,
        })
      );

      return new Table({
        width: { size: 70, type: WidthType.PERCENTAGE },
        layout: TableLayoutType.FIXED,
        rows: [new TableRow({ children: cells })],
        borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideHorizontal: noBorder(), insideVertical: noBorder() },
        alignment: AlignmentType.CENTER,
      });
    }

    // ── Build document sections ───────────────────────────────────────────
    const children: (Paragraph | Table)[] = [];

    // Header
    children.push(headerPara(sanitize(sheetTitle || deckTitle || topic)));

    // Grade / curriculum subtitle
    const subtitle = [grade ? `Grade ${grade}` : "", deckTitle ? deckTitle : ""].filter(Boolean).join("  •  ");
    if (subtitle) children.push(subHeaderPara(subtitle));

    // Name / date / class
    children.push(spacer(80));
    children.push(nameDateRow());
    children.push(spacer(80));

    // Divider
    children.push(
      new Paragraph({
        children: [],
        border: { bottom: { style: BorderStyle.THICK, size: 6, color: GREEN_HEX } },
        spacing: { before: 40, after: 120 },
      })
    );

    // Images row (after header)
    const imgTable = imageRow(imageBuffers);
    if (imgTable) {
      children.push(imgTable);
      children.push(spacer(120));
    }

    // Activities
    for (let i = 0; i < activities.length; i++) {
      const a = activities[i];
      let rendered: (Paragraph | Table)[] = [];

      if (a.type === "true-false") rendered = renderTrueFalse(a, i + 1);
      else if (a.type === "fill-in-the-blank") rendered = renderFillBlank(a, i + 1);
      else if (a.type === "multiple-choice") rendered = renderMultipleChoice(a, i + 1);
      else if (a.type === "matching") rendered = renderMatching(a, i + 1);
      else if (a.type === "short-answer") rendered = renderShortAnswer(a, i + 1);

      children.push(...rendered);
      children.push(spacer(80));
    }

    // Answer key
    children.push(...buildAnswerKey(activities));

    // Footer note
    children.push(
      new Paragraph({
        children: [new TextRun({ text: "Generated by Classory AI  •  AI content may contain errors — please verify before use.", size: 16, color: "888888", font: "Arial", italics: true })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 0 },
      })
    );

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: { font: "Arial", size: 22, color: BLACK_HEX },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: convertInchesToTwip(0.6), bottom: convertInchesToTwip(0.6), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) },
            },
          },
          children,
        },
      ],
    });

    const buf = await Packer.toBuffer(doc);
    const filename =
      (sheetTitle || topic || "activity-sheet")
        .replace(/[^a-z0-9-_ ]/gi, "")
        .trim()
        .replace(/\s+/g, "_") + "_activity.docx";

    return new NextResponse(buf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    console.error("Activity DOCX export error:", err);
    return NextResponse.json(
      { error: "activity docx failed", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
