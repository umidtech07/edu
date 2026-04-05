import { NextResponse } from "next/server";
import { PDFDocument, rgb, PDFName, PDFArray, PDFString, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 60;
export const maxRequestBodySize = "50mb";

type Slide = {
  title: string;
  bullets: string[];
  content?: string | null;
  keyStatement?: string | null;
  formulaBox?: string | null;
  correctIndex?: number | null;
  image?: string | null;
  imageCredit?: string | null;
  youtubeVideoId?: string | null;
  slideType?: string | null;
  sideALabel?: string | null;
  sideBLabel?: string | null;
  sideABullets?: string[] | null;
  sideBBullets?: string[] | null;
  sideAContent?: string | null;
  sideBContent?: string | null;
  imageB?: string | null;
  imageBCredit?: string | null;
  columns?: Array<{
    label: string;
    description: string;
    image?: string | null;
    imageCredit?: string | null;
  }> | null;
};

async function fetchBytes(url: string): Promise<Uint8Array> {
  if (url.startsWith("data:")) {
    const base64 = url.split(",")[1] ?? "";
    return Buffer.from(base64, "base64");
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/** Normalize punctuation to plain equivalents. */
function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "\u2022")
    .replace(/\u00A0/g, " ");
}

/** Strip **bold** markers for length measurement */
function stripMarkers(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/gs, "$1");
}

/** Plain wrap (for text without bold markers) */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (test.length > maxChars) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Wrap text that may contain **bold** markers — strips them for length measurement, preserves in output */
function wrapRichText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  let lineLen = 0;
  for (const w of words) {
    const wLen = stripMarkers(w).length;
    const testLen = lineLen ? lineLen + 1 + wLen : wLen;
    if (testLen > maxChars) {
      if (line) lines.push(line);
      line = w;
      lineLen = wLen;
    } else {
      line = line ? `${line} ${w}` : w;
      lineLen = testLen;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Draw a single line with **bold** marker support, auto-advancing x per segment */
function drawRichLine(
  page: any,
  text: string,
  x: number, y: number, size: number,
  font: any, fontBold: any,
  color: any,
): number /* returns ending x */ {
  const sanitized = sanitize(text);
  type Seg = { text: string; bold: boolean };
  const segs: Seg[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sanitized)) !== null) {
    if (m.index > last) segs.push({ text: sanitized.slice(last, m.index), bold: false });
    segs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < sanitized.length) segs.push({ text: sanitized.slice(last), bold: false });
  if (segs.length === 0) {
    page.drawText(sanitized, { x, y, size, font, color });
    return x + font.widthOfTextAtSize(sanitized, size);
  }
  let curX = x;
  for (const seg of segs) {
    if (!seg.text) continue;
    const f = seg.bold ? fontBold : font;
    page.drawText(seg.text, { x: curX, y, size, font: f, color });
    curX += f.widthOfTextAtSize(seg.text, size);
  }
  return curX;
}

const EMBED_MAX_W = 1200;
const EMBED_MAX_H = 800;

async function loadAndEmbedImage(pdf: PDFDocument, imageUrl: string) {
  if (imageUrl.startsWith("data:image/svg+xml")) {
    const svgBase64 = imageUrl.split(",")[1] ?? "";
    let svgBuf = Buffer.from(svgBase64, "base64");
    let pngBytes: Uint8Array;
    try {
      pngBytes = new Uint8Array(await sharp(svgBuf)
        .resize({ width: EMBED_MAX_W, height: EMBED_MAX_H, fit: "inside", withoutEnlargement: true })
        .png().toBuffer());
    } catch {
      const fixedSvg = svgBuf.toString("utf8").replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
      pngBytes = new Uint8Array(await sharp(Buffer.from(fixedSvg, "utf8"))
        .resize({ width: EMBED_MAX_W, height: EMBED_MAX_H, fit: "inside", withoutEnlargement: true })
        .png().toBuffer());
    }
    return pdf.embedPng(pngBytes);
  } else {
    const raw = await fetchBytes(imageUrl);
    const jpgBytes = new Uint8Array(await sharp(raw)
      .resize({ width: EMBED_MAX_W, height: EMBED_MAX_H, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer());
    return pdf.embedJpg(jpgBytes);
  }
}

/** Draw an image covering (filling) a rectangular area, clipped to the box bounds. */
function drawImageCover(
  page: { pushOperators: (...ops: any[]) => void; drawImage: (img: any, opts: any) => void },
  embedded: { width: number; height: number; scale: (s: number) => { width: number; height: number } },
  boxX: number, boxY: number, boxW: number, boxH: number,
) {
  const dims = embedded.scale(1);
  const scale = Math.max(boxW / dims.width, boxH / dims.height);
  const drawW = dims.width * scale;
  const drawH = dims.height * scale;
  const dx = boxX + (boxW - drawW) / 2;
  const dy = boxY + (boxH - drawH) / 2;

  page.pushOperators(
    pushGraphicsState(),
    moveTo(boxX, boxY),
    lineTo(boxX + boxW, boxY),
    lineTo(boxX + boxW, boxY + boxH),
    lineTo(boxX, boxY + boxH),
    closePath(),
    clip(),
    endPath(),
  );
  page.drawImage(embedded, { x: dx, y: dy, width: drawW, height: drawH });
  page.pushOperators(popGraphicsState());
}

// Design tokens
const NAVY         = rgb(0.086, 0.396, 0.204);  // #166534
const NAVY_DARK    = rgb(0.08,  0.325, 0.176);  // #14532d
const BLUE         = rgb(0.086, 0.639, 0.290);  // #16a34a
const WHITE        = rgb(1, 1, 1);
const DARK         = rgb(0.08, 0.08, 0.13);
const MID          = rgb(0.42, 0.42, 0.48);
const LIGHT        = rgb(0.96, 0.97, 0.99);
const RULE         = rgb(0.88, 0.90, 0.94);
const SIDE_A_BG    = rgb(0.941, 0.992, 0.957); // #f0fdf4
const RECAP_BORDER = rgb(0.733, 0.969, 0.816); // #bbf7d0
const FORMULA_BDR  = rgb(0.302, 0.871, 0.502); // #4ade80
const FOOTER_TEXT  = rgb(0.733, 0.969, 0.816); // #bbf7d0
const BADGE_BG     = rgb(0.06, 0.27, 0.14);    // slightly darker than NAVY
const BADGE_BORDER = rgb(0.55, 0.85, 0.65);
const GREY_BADGE   = rgb(0.90, 0.91, 0.93);    // #e5e7eb
const GREY_TEXT    = rgb(0.22, 0.24, 0.27);    // #374151

const SLIDE_TYPE_LABELS: Record<string, string> = {
  reflection: "Reflect",
  question: "Question",
  quiz: "Quiz",
  recap: "Recap",
  comparison: "Compare",
  columns: "Grid",
  fact: "Fact",
  example: "Example",
  intro: "Intro",
  explanation: "Explain",
};

export async function POST(req: Request) {
  try {
    const { deckTitle = "Lesson", slides } = (await req.json()) as {
      deckTitle?: string;
      slides: Slide[];
    };

    if (!slides?.length) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }

    const pageW  = 960;
    const pageH  = 540;
    const HEADER_H = 80;
    const FOOTER_H = 28;

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fontsDir = path.join(process.cwd(), "public", "fonts");
    const fontBytes     = fs.readFileSync(path.join(fontsDir, "NotoSans-Regular.ttf"));
    const fontBoldBytes = fs.readFileSync(path.join(fontsDir, "NotoSans-Bold.ttf"));
    const font     = await pdf.embedFont(fontBytes);
    const fontBold = await pdf.embedFont(fontBoldBytes);

    // ── Title page ────────────────────────────────────────────────
    {
      const page = pdf.addPage([pageW, pageH]);
      const coverImageUrl = slides[0]?.image ?? null;
      const hasCovarImage = Boolean(coverImageUrl);

      if (hasCovarImage) {
        const textPanelW = Math.round(pageW * 0.55);
        const imgPanelX  = textPanelW;
        const imgPanelW  = pageW - textPanelW;

        page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: NAVY });
        page.drawRectangle({ x: imgPanelX, y: 0, width: imgPanelW, height: pageH, color: NAVY_DARK });
        try {
          const embedded = await loadAndEmbedImage(pdf, coverImageUrl!);
          const dims  = embedded.scale(1);
          const pad   = 16;
          const scale = Math.min((imgPanelW - pad * 2) / dims.width, (pageH - pad * 2) / dims.height);
          const drawW = dims.width * scale;
          const drawH = dims.height * scale;
          page.drawImage(embedded, {
            x: imgPanelX + (imgPanelW - drawW) / 2,
            y: (pageH - drawH) / 2,
            width: drawW, height: drawH, opacity: 0.85,
          });
        } catch { /* leave dark panel */ }

        page.drawRectangle({ x: 0, y: 0, width: 10, height: pageH, color: BLUE });

        const titleSize  = 40;
        const titleLineH = 50;
        const titleLines = wrapText(sanitize(deckTitle), 22);
        const totalTitleH = (titleLines.length - 1) * titleLineH + titleSize;
        let titleY = Math.round(pageH / 2 + totalTitleH / 2);
        for (const line of titleLines) {
          page.drawText(line, { x: 72, y: titleY, size: titleSize, font: fontBold, color: WHITE });
          titleY -= titleLineH;
        }
        page.drawText("Generated by Classory AI", {
          x: 72,
          y: Math.round(pageH / 2 - totalTitleH / 2) - 32,
          size: 16, font, color: FOOTER_TEXT,
        });
      } else {
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: NAVY });
        page.drawRectangle({ x: 0, y: 0, width: 10, height: pageH, color: BLUE });

        const titleSize  = 44;
        const titleLineH = 54;
        const titleLines = wrapText(sanitize(deckTitle), 28);
        const totalTitleH = (titleLines.length - 1) * titleLineH + titleSize;
        let titleY = Math.round(pageH / 2 + totalTitleH / 2);
        for (const line of titleLines) {
          page.drawText(line, { x: 72, y: titleY, size: titleSize, font: fontBold, color: WHITE });
          titleY -= titleLineH;
        }
        page.drawText("Generated by Classory AI", {
          x: 72,
          y: Math.round(pageH / 2 - totalTitleH / 2) - 32,
          size: 16, font, color: FOOTER_TEXT,
        });
      }
    }

    // ── Content slides ─────────────────────────────────────────────
    for (const s of slides) {
      const page = pdf.addPage([pageW, pageH]);

      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: WHITE });

      // ── Header band ───────────────────────────────────────────────
      page.drawRectangle({ x: 0, y: pageH - HEADER_H, width: pageW, height: HEADER_H, color: NAVY });
      page.drawRectangle({ x: 0, y: pageH - HEADER_H, width: 6, height: HEADER_H, color: BLUE });

      // Slide type badge (right of header)
      const typeKey   = s.slideType ?? "";
      const typeLabel = SLIDE_TYPE_LABELS[typeKey];
      let headerTextMaxX = pageW - 16;
      if (typeLabel) {
        const badgeTxt = sanitize(typeLabel);
        const badgeSz  = 11;
        const badgeW   = fontBold.widthOfTextAtSize(badgeTxt, badgeSz) + 18;
        const badgeH   = 22;
        const badgeX   = pageW - badgeW - 14;
        const badgeY   = pageH - HEADER_H + (HEADER_H - badgeH) / 2;
        page.drawRectangle({ x: badgeX, y: badgeY, width: badgeW, height: badgeH, color: BADGE_BG, borderColor: BADGE_BORDER, borderWidth: 1 });
        page.drawText(badgeTxt, { x: badgeX + 9, y: badgeY + 6, size: badgeSz, font: fontBold, color: WHITE });
        headerTextMaxX = badgeX - 8;
      }

      // Title in header
      const titleFontSize = 26;
      const titleLineH    = 32;
      const maxTitleChars = Math.max(20, Math.floor((headerTextMaxX - 36) / 14));
      const titleLines    = wrapText(sanitize(s.title ?? ""), Math.min(55, maxTitleChars)).slice(0, 2);
      const headerCenterY = pageH - HEADER_H + HEADER_H / 2;
      const totalTitleH   = (titleLines.length - 1) * titleLineH + titleFontSize;
      let titleY = Math.round(headerCenterY + totalTitleH / 2 - titleFontSize);
      for (const line of titleLines) {
        page.drawText(line, { x: 36, y: titleY, size: titleFontSize, font: fontBold, color: WHITE });
        titleY -= titleLineH;
      }

      const contentTop    = pageH - HEADER_H - 16;
      const contentBottom = FOOTER_H + 16;
      const contentH      = contentTop - contentBottom;

      // ── Layout branches ───────────────────────────────────────────
      const isCompSlide = s.slideType === "comparison" || !!(s.sideALabel || s.sideAContent || s.sideABullets?.length);
      const isColsSlide = s.slideType === "columns" && Boolean(s.columns?.length);

      if (isColsSlide) {
        // ── COLUMNS (grid): N equal columns, image top + label + description ──
        const cols   = s.columns!;
        const N      = cols.length;
        const marginX = 24;
        const totalW  = pageW - marginX * 2;
        const colSep  = 4;
        const colW    = Math.floor((totalW - colSep * (N - 1)) / N);
        const imgH    = Math.round(contentH * 0.52);
        const imgY    = contentTop - imgH;

        for (let i = 0; i < N; i++) {
          const col  = cols[i];
          const colX = marginX + i * (colW + colSep);

          if (i > 0) {
            page.drawRectangle({ x: colX - colSep, y: contentBottom, width: colSep, height: contentH, color: RULE });
          }

          page.drawRectangle({ x: colX, y: imgY, width: colW, height: imgH, color: LIGHT, borderColor: RULE, borderWidth: 1 });

          if (col.image) {
            try {
              const embedded = await loadAndEmbedImage(pdf, col.image);
              drawImageCover(page, embedded, colX, imgY, colW, imgH);
            } catch { /* leave box */ }
          }

          if (col.imageCredit) {
            page.drawText(sanitize(col.imageCredit).slice(0, 40), { x: colX + 3, y: imgY - 12, size: 7, font, color: MID });
          }

          const labelY     = imgY - (col.imageCredit ? 24 : 10);
          const labelLines = wrapText(sanitize(col.label ?? ""), Math.floor(colW / 8)).slice(0, 2);
          let labelCursor  = labelY;
          for (const line of labelLines) {
            page.drawText(line, { x: colX + 6, y: labelCursor, size: 15, font: fontBold, color: NAVY });
            labelCursor -= 20;
          }

          const descY    = labelCursor - 4;
          const descLines = wrapText(sanitize(col.description ?? ""), Math.floor(colW / 7.5));
          let descCursor  = descY;
          for (const line of descLines) {
            if (descCursor < contentBottom + 8) break;
            page.drawText(line, { x: colX + 6, y: descCursor, size: 13, font, color: DARK });
            descCursor -= 18;
          }
        }

      } else if (isCompSlide) {
        // ── COMPARISON: two-column layout ─────────────────────────
        const colMarginL = 36;
        const totalW = pageW - colMarginL - 36;
        const colSep = 4;
        const colW   = Math.floor((totalW - colSep) / 2);
        const colLX  = colMarginL;
        const colRX  = colMarginL + colW + colSep;

        const hasImgA   = Boolean(s.image);
        const hasImgB   = Boolean(s.imageB);
        const twoImages = hasImgA && hasImgB;
        const oneImage  = hasImgA && !hasImgB;

        let colAreaTop = contentTop;

        if (oneImage && s.image) {
          const stripH = Math.round(contentH * 0.38);
          const stripY = contentTop - stripH;

          page.drawRectangle({ x: colMarginL, y: stripY, width: totalW, height: stripH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
          try {
            const embedded = await loadAndEmbedImage(pdf, s.image);
            drawImageCover(page, embedded, colMarginL, stripY, totalW, stripH);
          } catch { /* leave box */ }

          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 55), { x: colMarginL + 4, y: stripY - 14, size: 7.5, font, color: MID });
          }
          colAreaTop = stripY;
        }

        const colAreaH = colAreaTop - contentBottom;
        const labelH   = 24;

        page.drawRectangle({ x: colLX, y: contentBottom, width: colW, height: colAreaH, color: SIDE_A_BG });
        page.drawRectangle({ x: colRX, y: contentBottom, width: colW, height: colAreaH, color: WHITE, borderColor: RULE, borderWidth: 1 });
        page.drawRectangle({ x: colLX + colW, y: contentBottom, width: colSep, height: colAreaH, color: DARK });

        const labelY = colAreaTop - labelH;
        page.drawRectangle({ x: colLX, y: labelY, width: colW, height: labelH, color: NAVY });
        page.drawText(`< ${sanitize(s.sideALabel ?? "Side A")}`, { x: colLX + 8, y: labelY + 7, size: 11, font: fontBold, color: WHITE });
        page.drawRectangle({ x: colRX, y: labelY, width: colW, height: labelH, color: NAVY_DARK });
        page.drawText(`${sanitize(s.sideBLabel ?? "Side B")} >`, { x: colRX + 8, y: labelY + 7, size: 11, font: fontBold, color: WHITE });

        let textAreaTop = labelY;

        if (twoImages && s.image && s.imageB) {
          const remainH  = colAreaH - labelH;
          const imgColH  = Math.round(remainH * 0.38);
          const imgStripY = labelY - imgColH;

          page.drawRectangle({ x: colLX, y: imgStripY, width: colW, height: imgColH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
          try {
            const embedded = await loadAndEmbedImage(pdf, s.image);
            drawImageCover(page, embedded, colLX, imgStripY, colW, imgColH);
          } catch { /* leave box */ }
          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 30), { x: colLX + 4, y: imgStripY - 12, size: 7, font, color: MID });
          }

          page.drawRectangle({ x: colRX, y: imgStripY, width: colW, height: imgColH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
          try {
            const embedded = await loadAndEmbedImage(pdf, s.imageB);
            drawImageCover(page, embedded, colRX, imgStripY, colW, imgColH);
          } catch { /* leave box */ }
          if (s.imageBCredit) {
            page.drawText(sanitize(s.imageBCredit).slice(0, 30), { x: colRX + 4, y: imgStripY - 12, size: 7, font, color: MID });
          }
          textAreaTop = imgStripY;
        }

        const textAreaH    = textAreaTop - contentBottom;
        const bSz          = 14;
        const bLineH       = 20;
        const maxColChars  = 36;

        const allBullets = s.bullets ?? [];
        const mid        = Math.ceil(allBullets.length / 2);

        function contentToItems(content: string | null | undefined): string[] {
          if (!content?.trim()) return [];
          return content.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean);
        }

        const leftBullets  = s.sideABullets?.length ? s.sideABullets
          : s.sideAContent ? contentToItems(s.sideAContent) : allBullets.slice(0, mid);
        const rightBullets = s.sideBBullets?.length ? s.sideBBullets
          : s.sideBContent ? contentToItems(s.sideBContent) : allBullets.slice(mid);

        for (const [colX, bullets] of [[colLX, leftBullets], [colRX, rightBullets]] as [number, string[]][]) {
          let totalH = 0;
          for (const b of bullets) totalH += wrapRichText(sanitize(b), maxColChars).length * bLineH + 8;
          if (totalH > 0) totalH -= 8;

          let cursorY = Math.min(
            textAreaTop - bSz - 4,
            contentBottom + Math.floor((textAreaH + totalH) / 2),
          );

          for (const b of bullets) {
            const lines = wrapRichText(sanitize(b), maxColChars);
            if (cursorY < contentBottom + 10) break;

            page.drawEllipse({ x: colX + 8, y: cursorY + bSz * 0.35, xScale: 3, yScale: 3, color: BLUE });
            let ly = cursorY;
            for (const line of lines) {
              drawRichLine(page, line, colX + 20, ly, bSz, font, fontBold, DARK);
              ly -= bLineH;
            }
            cursorY = ly - 8;
          }
        }

      } else if (s.slideType === "fact" && s.image) {
        // ── FACT: image at top full-width, keyStatement callout + text/bullets below ──
        const marginX   = 36;
        const contentW  = pageW - marginX * 2;
        const imageH    = Math.round(contentH * 0.42);
        const imgY      = contentTop - imageH;

        page.drawRectangle({ x: marginX, y: imgY, width: contentW, height: imageH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
        try {
          const embedded = await loadAndEmbedImage(pdf, s.image);
          drawImageCover(page, embedded, marginX, imgY, contentW, imageH);
        } catch { /* leave box */ }

        if (s.imageCredit) {
          page.drawText(sanitize(s.imageCredit).slice(0, 80), { x: marginX + 4, y: imgY - 14, size: 7.5, font, color: MID });
        }

        let textAreaTop = imgY - (s.imageCredit ? 18 : 4);
        const textAreaH  = textAreaTop - contentBottom;
        const bulletSize = 17;
        const lineH      = 24;

        // keyStatement callout — dark green for fact slides
        if (s.keyStatement) {
          const ksLines = wrapRichText(sanitize(s.keyStatement), 72);
          const ksBoxH  = ksLines.length * 22 + 14;
          const ksBoxY  = textAreaTop - ksBoxH;
          page.drawRectangle({ x: marginX, y: ksBoxY, width: contentW, height: ksBoxH, color: NAVY, borderColor: NAVY_DARK, borderWidth: 1 });
          let ky = ksBoxY + ksBoxH - 8 - 16;
          for (const line of ksLines) {
            drawRichLine(page, line, marginX + 14, ky, 15, font, fontBold, WHITE);
            ky -= 22;
          }
          textAreaTop = ksBoxY - 6;
        }

        if (s.content) {
          const lines  = wrapRichText(sanitize(s.content), 78);
          const totalH = lines.length * lineH;
          let cursorY  = Math.min(textAreaTop - bulletSize, contentBottom + Math.floor((textAreaTop - contentBottom + totalH) / 2));
          for (const line of lines) {
            if (cursorY < contentBottom + 10) break;
            drawRichLine(page, line, marginX, cursorY, bulletSize, font, fontBold, DARK);
            cursorY -= lineH;
          }
        } else {
          let totalBulletsH = 0;
          for (const b of s.bullets || []) totalBulletsH += wrapRichText(sanitize(b), 72).length * lineH + 10;
          if (totalBulletsH > 0) totalBulletsH -= 10;

          let cursorY = Math.min(
            textAreaTop - bulletSize,
            contentBottom + Math.floor((textAreaTop - contentBottom + totalBulletsH) / 2),
          );

          for (const b of s.bullets || []) {
            const lines = wrapRichText(sanitize(b), 72);
            page.drawEllipse({ x: marginX + 10, y: cursorY + bulletSize * 0.35, xScale: 4, yScale: 4, color: BLUE });
            let lineY = cursorY;
            for (const line of lines) {
              drawRichLine(page, line, marginX + 28, lineY, bulletSize, font, fontBold, DARK);
              lineY -= lineH;
            }
            cursorY = lineY - 10;
            if (cursorY < contentBottom + 10) break;
          }
        }

      } else if (s.slideType === "recap") {
        // ── RECAP: centered green checklist ──────────────────────────
        const marginX  = 80;
        const boxW     = pageW - marginX * 2;
        const itemH    = 36;
        const itemGap  = 8;
        const items    = s.bullets || [];
        const totalH   = items.length * itemH + Math.max(0, items.length - 1) * itemGap;
        let cursorY    = Math.min(contentTop - 8, contentBottom + Math.floor((contentH + totalH) / 2));

        if (items.length === 0) {
          // Show placeholder text
          page.drawText("Review what you learned…", {
            x: pageW / 2 - font.widthOfTextAtSize("Review what you learned…", 18) / 2,
            y: contentBottom + contentH / 2,
            size: 18, font, color: MID,
          });
        }

        for (const b of items) {
          const bText    = sanitize(b);
          const maxChars = 64;
          const lines    = wrapRichText(bText, maxChars);
          const thisH    = Math.max(itemH, lines.length * 20 + 16);

          const boxY = cursorY - thisH;
          if (boxY < contentBottom) break;

          // Green box
          page.drawRectangle({ x: marginX, y: boxY, width: boxW, height: thisH, color: SIDE_A_BG, borderColor: RECAP_BORDER, borderWidth: 2 });
          // Left accent stripe
          page.drawRectangle({ x: marginX, y: boxY, width: 5, height: thisH, color: NAVY });
          // Check mark
          page.drawText("\u2713", { x: marginX + 14, y: boxY + thisH / 2 - 8, size: 16, font: fontBold, color: NAVY });
          // Text
          let ty = boxY + thisH - 8 - 16;
          for (const line of lines) {
            drawRichLine(page, line, marginX + 36, ty, 15, font, fontBold, DARK);
            ty -= 20;
          }

          cursorY = boxY - itemGap;
        }

      } else if (s.slideType === "reflection" || s.slideType === "question") {
        // ── REFLECTION / QUESTION: centered icon + big text ───────────
        const cx = pageW / 2;
        const isQuestion = s.slideType === "question";

        // Big icon circle
        const iconR = 32;
        const iconY = contentTop - iconR - 12;
        page.drawEllipse({ x: cx, y: iconY, xScale: iconR, yScale: iconR, color: SIDE_A_BG, borderColor: RECAP_BORDER, borderWidth: 2 });
        const iconChar = isQuestion ? "?" : "\u201C";
        const iconSz   = 28;
        const iconTxtW = fontBold.widthOfTextAtSize(iconChar, iconSz);
        page.drawText(iconChar, { x: cx - iconTxtW / 2, y: iconY - iconSz / 3, size: iconSz, font: fontBold, color: NAVY });

        const textTop = iconY - iconR - 16;
        const textH   = textTop - contentBottom;
        const maxW    = pageW - 160;
        const textX   = (pageW - maxW) / 2;

        if (s.content) {
          const lines  = wrapRichText(sanitize(s.content), 68);
          const total  = lines.length * 26;
          let cursorY  = textTop - Math.max(0, (textH - total) / 2) - 4;
          for (const line of lines) {
            if (cursorY < contentBottom + 10) break;
            // center each line
            const lineW = stripMarkers(line).length * 9.5;
            const lineX = Math.max(textX, (pageW - Math.min(lineW, maxW)) / 2);
            drawRichLine(page, line, lineX, cursorY, 18, font, fontBold, DARK);
            cursorY -= 26;
          }
        } else if ((s.bullets || []).length > 0) {
          let totalH = 0;
          for (const b of s.bullets || []) totalH += wrapRichText(sanitize(b), 64).length * 24 + 8;

          let cursorY = textTop - Math.max(0, (textH - totalH) / 2);
          for (const b of s.bullets || []) {
            const lines = wrapRichText(sanitize(b), 64);
            page.drawEllipse({ x: textX + 10, y: cursorY + 16 * 0.35, xScale: 3.5, yScale: 3.5, color: BLUE });
            let ly = cursorY;
            for (const line of lines) {
              drawRichLine(page, line, textX + 24, ly, 16, font, fontBold, DARK);
              ly -= 24;
            }
            cursorY = ly - 8;
            if (cursorY < contentBottom + 10) break;
          }
        }

      } else if (s.slideType === "quiz") {
        // ── QUIZ: options with letter badges, correct highlighted ──────
        const marginX    = 60;
        const contentW   = pageW - marginX * 2;
        const items      = s.bullets || [];
        const itemH      = 38;
        const itemGap    = 6;
        const totalH     = items.length * itemH + Math.max(0, items.length - 1) * itemGap;

        // Optional question text from content field above options
        let cursorTop = contentTop - 10;
        if (s.content) {
          const qLines = wrapRichText(sanitize(s.content), 78);
          for (const line of qLines) {
            if (cursorTop < contentBottom + 40) break;
            drawRichLine(page, line, marginX, cursorTop - 22, 16, font, fontBold, DARK);
            cursorTop -= 24;
          }
          cursorTop -= 8;
        }

        const availH = cursorTop - contentBottom;
        let cursorY  = cursorTop - Math.max(0, (availH - totalH) / 2);

        for (let i = 0; i < items.length; i++) {
          const b          = items[i];
          const alphaMatch = b.match(/^([A-D])\.\s+([\s\S]*)$/);
          const marker     = alphaMatch ? alphaMatch[1] : String.fromCharCode(65 + i);
          const displayTxt = alphaMatch ? alphaMatch[2] : b;
          const isCorrect  = typeof s.correctIndex === "number" && s.correctIndex === i;

          const lines     = wrapRichText(sanitize(displayTxt), 70);
          const thisH     = Math.max(itemH, lines.length * 22 + 14);
          const boxY      = cursorY - thisH;
          if (boxY < contentBottom) break;

          // Row background
          const rowBg = isCorrect ? SIDE_A_BG : LIGHT;
          const rowBd = isCorrect ? RECAP_BORDER : RULE;
          page.drawRectangle({ x: marginX, y: boxY, width: contentW, height: thisH, color: rowBg, borderColor: rowBd, borderWidth: isCorrect ? 2 : 1 });

          // Badge circle
          const badgeR = 12;
          const badgeX = marginX + 20;
          const badgeY = boxY + thisH / 2;
          const bgColor = isCorrect ? NAVY : GREY_BADGE;
          const fgColor = isCorrect ? WHITE : GREY_TEXT;
          page.drawEllipse({ x: badgeX, y: badgeY, xScale: badgeR, yScale: badgeR, color: bgColor, borderColor: isCorrect ? NAVY_DARK : RULE, borderWidth: 1 });
          const mW = (isCorrect ? fontBold : font).widthOfTextAtSize(marker, 11);
          page.drawText(marker, { x: badgeX - mW / 2, y: badgeY - 5, size: 11, font: isCorrect ? fontBold : font, color: fgColor });

          // Option text
          const textFont = isCorrect ? fontBold : font;
          const textColor = isCorrect ? NAVY_DARK : DARK;
          let ty = boxY + thisH - 8 - 16;
          for (const line of lines) {
            drawRichLine(page, line, marginX + 42, ty, 15, font, fontBold, textColor);
            ty -= 22;
          }

          cursorY = boxY - itemGap;
        }

      } else {
        // ── Standard slide: text left, image/video right ───────────
        const hasImage   = Boolean(s.image);
        const hasYouTube = !hasImage && Boolean(s.youtubeVideoId);
        const hasVisual  = hasImage || hasYouTube;

        const textX      = 36;
        const textAreaW  = hasVisual ? 490 : pageW - 72;
        const bulletSize = 18;
        const lineH      = 26;
        const bulletIndent = 28;
        const maxChars   = hasVisual ? 40 : 72;

        // Calculate total text content height (for vertical centering)
        let totalContentH = 0;
        if (s.keyStatement) totalContentH += wrapRichText(sanitize(s.keyStatement), maxChars).length * 20 + 18 + 10;
        if (s.formulaBox)   totalContentH += wrapRichText(sanitize(s.formulaBox), Math.min(maxChars, 36)).length * 32 + 24 + 10;
        if (s.content) {
          totalContentH += wrapRichText(sanitize(s.content), maxChars).length * lineH;
          for (const b of s.bullets || []) totalContentH += wrapRichText(sanitize(b), maxChars).length * lineH + 8;
        } else {
          for (const b of s.bullets || []) totalContentH += wrapRichText(sanitize(b), maxChars).length * lineH + 10;
          if (totalContentH > 0) totalContentH -= 10;
        }

        let cursorY = Math.min(
          contentTop - bulletSize,
          contentBottom + Math.floor((contentH + totalContentH) / 2),
        );

        // formulaBox — hero element, centered
        if (s.formulaBox) {
          const fbText  = sanitize(s.formulaBox);
          const fbLines = wrapRichText(fbText, Math.min(maxChars, 36));
          const fbBoxH  = fbLines.length * 32 + 24;
          const fbBoxW  = textAreaW;
          const fbBoxY  = cursorY - fbBoxH;
          if (fbBoxY >= contentBottom) {
            page.drawRectangle({ x: textX, y: fbBoxY, width: fbBoxW, height: fbBoxH, color: SIDE_A_BG, borderColor: FORMULA_BDR, borderWidth: 3 });
            let fy = fbBoxY + fbBoxH - 12 - 22;
            for (const line of fbLines) {
              const lineW = stripMarkers(line).length * 13;
              const lineX = textX + Math.max(0, (fbBoxW - lineW) / 2);
              drawRichLine(page, line, lineX, fy, 22, font, fontBold, NAVY_DARK);
              fy -= 32;
            }
            cursorY = fbBoxY - 10;
          }
        }

        // keyStatement accent bar
        if (s.keyStatement) {
          const ksLines = wrapRichText(sanitize(s.keyStatement), maxChars + 4);
          const ksBoxH  = ksLines.length * 20 + 14;
          const ksBoxW  = textAreaW;
          const ksBoxY  = cursorY - ksBoxH;
          if (ksBoxY >= contentBottom) {
            page.drawRectangle({ x: textX, y: ksBoxY, width: ksBoxW, height: ksBoxH, color: SIDE_A_BG, borderColor: RULE, borderWidth: 1 });
            page.drawRectangle({ x: textX, y: ksBoxY, width: 4, height: ksBoxH, color: NAVY });
            let ky = ksBoxY + ksBoxH - 8 - 14;
            for (const line of ksLines) {
              drawRichLine(page, line, textX + 14, ky, 14, font, fontBold, NAVY);
              ky -= 20;
            }
            cursorY = ksBoxY - 10;
          }
        }

        if (s.content) {
          const lines = wrapRichText(sanitize(s.content), maxChars);
          for (const line of lines) {
            if (cursorY < contentBottom + 10) break;
            drawRichLine(page, line, textX, cursorY, bulletSize, font, fontBold, DARK);
            cursorY -= lineH;
          }
          // Supporting bullets below paragraph
          for (const b of s.bullets || []) {
            const lines2 = wrapRichText(sanitize(b), maxChars);
            page.drawEllipse({ x: textX + 8, y: cursorY + (bulletSize - 4) * 0.35, xScale: 3, yScale: 3, color: BLUE });
            let ly = cursorY;
            for (const line of lines2) {
              drawRichLine(page, line, textX + 18, ly, bulletSize - 4, font, fontBold, DARK);
              ly -= lineH - 4;
            }
            cursorY = ly - 8;
            if (cursorY < contentBottom + 10) break;
          }
        } else {
          const isQuizOpt = s.slideType === "quiz";
          for (let i = 0; i < (s.bullets || []).length; i++) {
            const b          = (s.bullets || [])[i];
            const alphaMatch = isQuizOpt ? b.match(/^([A-D])\.\s+([\s\S]*)$/) : null;
            const numberedMatch = !alphaMatch ? b.match(/^(\d+)[.)]\s+([\s\S]*)$/) : null;
            const marker     = isQuizOpt && alphaMatch ? alphaMatch[1]
              : numberedMatch ? `${numberedMatch[1]}.` : "\u2022";
            const displayTxt = alphaMatch ? alphaMatch[2] : numberedMatch ? numberedMatch[2] : b;
            const lines      = wrapRichText(sanitize(displayTxt), maxChars);

            const isCorrect  = isQuizOpt && typeof s.correctIndex === "number" && s.correctIndex === i;
            const bulletFont = isCorrect ? fontBold : font;
            const bulletCol  = isCorrect ? NAVY : DARK;

            page.drawText(sanitize(marker), { x: textX + 10, y: cursorY, size: bulletSize, font: isCorrect ? fontBold : fontBold, color: isCorrect ? BLUE : BLUE });

            let lineY = cursorY;
            for (const line of lines) {
              drawRichLine(page, line, textX + bulletIndent, lineY, bulletSize, font, fontBold, bulletCol);
              lineY -= lineH;
            }
            cursorY = lineY - 10;
            if (cursorY < contentBottom + 10) break;
          }
        }

        // ── Image column ────────────────────────────────────────────
        if (hasImage) {
          const imgX = 556;
          const imgW = 368;
          const imgH = contentH - 4;
          const imgY = contentBottom + 2;

          page.drawRectangle({ x: imgX, y: imgY, width: imgW, height: imgH, color: LIGHT, borderColor: RULE, borderWidth: 1 });

          if (s.image) {
            try {
              const embedded = await loadAndEmbedImage(pdf, s.image);
              const dims  = embedded.scale(1);
              const scale = Math.min((imgW - 8) / dims.width, (imgH - 8) / dims.height);
              const drawW = dims.width * scale;
              const drawH = dims.height * scale;
              const dx    = imgX + (imgW - drawW) / 2;
              const dy    = imgY + (imgH - drawH) / 2;
              page.drawImage(embedded, { x: dx, y: dy, width: drawW, height: drawH });
            } catch { /* leave box */ }
          }

          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 55), { x: imgX + 4, y: imgY - 14, size: 7.5, font, color: MID });
          }
        }

        // ── YouTube column ──────────────────────────────────────────
        if (hasYouTube && s.youtubeVideoId) {
          const videoId  = s.youtubeVideoId;
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const shortUrl = `youtu.be/${videoId}`;
          const boxX = 556;
          const boxW = 368;
          const boxH = contentH - 4;
          const boxY = contentBottom + 2;

          page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, color: LIGHT, borderColor: RULE, borderWidth: 1 });

          const cx = boxX + boxW / 2;
          const cy = boxY + boxH / 2 + 20;
          const r  = 28;
          page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color: rgb(0.86, 0.08, 0.08) });
          page.drawSvgPath("M -9 -13 L 15 0 L -9 13 Z", { x: cx, y: cy, color: WHITE });
          page.drawText("YouTube", { x: cx - 32, y: cy - r - 18, size: 13, font: fontBold, color: rgb(0.86, 0.08, 0.08) });
          page.drawText(shortUrl, { x: boxX + (boxW - shortUrl.length * 6.5) / 2, y: cy - r - 38, size: 11, font, color: MID });

          const linkAnnot = pdf.context.obj({
            Type: "Annot", Subtype: "Link",
            Rect: [boxX, boxY, boxX + boxW, boxY + boxH],
            Border: [0, 0, 0], C: [],
            A: { Type: "Action", S: "URI", URI: PDFString.of(videoUrl) },
          });
          const linkRef = pdf.context.register(linkAnnot);
          const existing = page.node.lookup(PDFName.of("Annots"));
          if (existing instanceof PDFArray) {
            existing.push(linkRef);
          } else {
            page.node.set(PDFName.of("Annots"), pdf.context.obj([linkRef]));
          }
        }
      } // end layout branches

      // ── Footer (green band matching UI) ────────────────────────────
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: FOOTER_H, color: NAVY });
      page.drawText("AI can make mistakes.", { x: 36, y: 9, size: 9, font, color: FOOTER_TEXT });
      const logoTxt = "Classory AI";
      page.drawText(logoTxt, {
        x: pageW - 36 - fontBold.widthOfTextAtSize(logoTxt, 9),
        y: 9, size: 9, font: fontBold, color: FOOTER_TEXT,
      });
    }

    const bytes    = await pdf.save();
    const filename = (deckTitle || "lesson").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") + ".pdf";

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "export pdf failed", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
