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

/** Normalize punctuation to plain equivalents. Noto Sans covers Cyrillic/Latin so we no longer strip non-Latin chars. */
function sanitize(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')    // curly double quotes
    .replace(/\u2013/g, "-")                        // en dash
    .replace(/\u2014/g, "--")                       // em dash
    .replace(/\u2026/g, "...")                      // ellipsis
    .replace(/\u2022/g, "\u2022")                   // keep bullet as-is (Noto supports it)
    .replace(/\u00A0/g, " ");                       // non-breaking space → regular space
}

function wrapText(text: string, maxChars: number) {
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

const EMBED_MAX_W = 1200;
const EMBED_MAX_H = 800;

async function loadAndEmbedImage(pdf: PDFDocument, imageUrl: string) {
  if (imageUrl.startsWith("data:image/svg+xml")) {
    // SVGs need PNG (preserves vectors/transparency)
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
    // Photos: resize + JPEG (5-10x smaller than PNG, much faster to embed)
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
const NAVY        = rgb(0.086, 0.396, 0.204);  // green-800 #166534
const NAVY_DARK   = rgb(0.08,  0.325, 0.176);  // green-900 #14532d
const BLUE        = rgb(0.086, 0.639, 0.290);  // green-500 #16a34a
const WHITE       = rgb(1, 1, 1);
const DARK        = rgb(0.08, 0.08, 0.13);
const MID         = rgb(0.42, 0.42, 0.48);
const LIGHT       = rgb(0.96, 0.97, 0.99);
const RULE        = rgb(0.88, 0.90, 0.94);
const SIDE_A_BG   = rgb(0.941, 0.992, 0.957); // #f0fdf4

export async function POST(req: Request) {
  try {
    const { deckTitle = "Lesson", slides } = (await req.json()) as {
      deckTitle?: string;
      slides: Slide[];
    };

    if (!slides?.length) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }

    const pageW = 960;
    const pageH = 540;
    const HEADER_H = 80;

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fontsDir = path.join(process.cwd(), "public", "fonts");
    const fontBytes = fs.readFileSync(path.join(fontsDir, "NotoSans-Regular.ttf"));
    const fontBoldBytes = fs.readFileSync(path.join(fontsDir, "NotoSans-Bold.ttf"));
    const font = await pdf.embedFont(fontBytes);
    const fontBold = await pdf.embedFont(fontBoldBytes);

    // ── Title page ────────────────────────────────────────────────
    {
      const page = pdf.addPage([pageW, pageH]);

      const coverImageUrl = slides[0]?.image ?? null;
      const hasCovarImage = Boolean(coverImageUrl);

      if (hasCovarImage) {
        // Split layout: left text panel (55%) + right image panel (45%)
        const textPanelW = Math.round(pageW * 0.55);
        const imgPanelX = textPanelW;
        const imgPanelW = pageW - textPanelW;

        // Full navy background (whole page first)
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: NAVY });

        // Right image panel
        page.drawRectangle({ x: imgPanelX, y: 0, width: imgPanelW, height: pageH, color: NAVY_DARK });
        try {
          const embedded = await loadAndEmbedImage(pdf, coverImageUrl!);
          const dims = embedded.scale(1);
          const pad = 16;
          const scale = Math.min((imgPanelW - pad * 2) / dims.width, (pageH - pad * 2) / dims.height);
          const drawW = dims.width * scale;
          const drawH = dims.height * scale;
          page.drawImage(embedded, {
            x: imgPanelX + (imgPanelW - drawW) / 2,
            y: (pageH - drawH) / 2,
            width: drawW,
            height: drawH,
            opacity: 0.85,
          });
        } catch { /* leave dark panel */ }

        // Accent stripe — left edge
        page.drawRectangle({ x: 0, y: 0, width: 10, height: pageH, color: BLUE });

        // Deck title — vertically centered in text panel
        const titleSize = 40;
        const titleLineH = 50;
        const titleLines = wrapText(sanitize(deckTitle), 22);
        const totalTitleH = (titleLines.length - 1) * titleLineH + titleSize;
        let titleY = Math.round(pageH / 2 + totalTitleH / 2);
        for (const line of titleLines) {
          page.drawText(line, {
            x: 72,
            y: titleY,
            size: titleSize,
            font: fontBold,
            color: WHITE,
          });
          titleY -= titleLineH;
        }
        page.drawText("Generated by Classory AI", {
          x: 72,
          y: Math.round(pageH / 2 - totalTitleH / 2) - 32,
          size: 16,
          font,
          color: rgb(0.6, 0.85, 0.65),
        });
      } else {
        // No image — full-width text layout
        page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: NAVY });
        page.drawRectangle({ x: 0, y: 0, width: 10, height: pageH, color: BLUE });

        const titleSize = 44;
        const titleLineH = 54;
        const titleLines = wrapText(sanitize(deckTitle), 28);
        const totalTitleH = (titleLines.length - 1) * titleLineH + titleSize;
        let titleY = Math.round(pageH / 2 + totalTitleH / 2);
        for (const line of titleLines) {
          page.drawText(line, {
            x: 72,
            y: titleY,
            size: titleSize,
            font: fontBold,
            color: WHITE,
          });
          titleY -= titleLineH;
        }
        page.drawText("Generated by Classory AI", {
          x: 72,
          y: Math.round(pageH / 2 - totalTitleH / 2) - 32,
          size: 16,
          font,
          color: rgb(0.6, 0.85, 0.65),
        });
      }
    }

    // ── Content slides ─────────────────────────────────────────────
    for (const s of slides) {
      const page = pdf.addPage([pageW, pageH]);

      // White background
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: WHITE });

      // Header band
      page.drawRectangle({ x: 0, y: pageH - HEADER_H, width: pageW, height: HEADER_H, color: NAVY });

      // Left accent stripe on header
      page.drawRectangle({ x: 0, y: pageH - HEADER_H, width: 6, height: HEADER_H, color: BLUE });

      // Title in header — manually wrap so lines stay inside the header band
      const titleFontSize = 26;
      const titleLineH = 32;
      const titleLines = wrapText(sanitize(s.title ?? ""), 55).slice(0, 2);
      const headerCenterY = pageH - HEADER_H + HEADER_H / 2; // vertical mid of header
      const totalTitleH = (titleLines.length - 1) * titleLineH + titleFontSize;
      let titleY = Math.round(headerCenterY + totalTitleH / 2 - titleFontSize);
      for (const line of titleLines) {
        page.drawText(line, { x: 36, y: titleY, size: titleFontSize, font: fontBold, color: WHITE });
        titleY -= titleLineH;
      }

      const contentTop = pageH - HEADER_H - 16;  // y just below header
      const contentBottom = 44;                   // above footer
      const contentH = contentTop - contentBottom;

      if (s.slideType === "comparison") {
        // ── COMPARISON: two-column layout ─────────────────────────
        const colMarginL = 36;
        const totalW = pageW - colMarginL - 36; // 888
        const colSep = 4;
        const colW = Math.floor((totalW - colSep) / 2); // 442
        const colLX = colMarginL;               // left col x
        const colRX = colMarginL + colW + colSep; // right col x

        const hasImgA = Boolean(s.image);
        const hasImgB = Boolean(s.imageB);
        const twoImages = hasImgA && hasImgB;
        const oneImage = hasImgA && !hasImgB;

        let colAreaTop = contentTop; // may shift down after top image strip

        // ── Single image spanning full width at top ──
        if (oneImage && s.image) {
          const stripH = Math.round(contentH * 0.38); // ~152
          const stripY = contentTop - stripH;

          page.drawRectangle({
            x: colMarginL, y: stripY, width: totalW, height: stripH,
            color: LIGHT, borderColor: RULE, borderWidth: 1,
          });

          try {
            const embedded = await loadAndEmbedImage(pdf, s.image);
            drawImageCover(page, embedded, colMarginL, stripY, totalW, stripH);
          } catch { /* leave empty box */ }

          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 55), {
              x: colMarginL + 4, y: stripY - 14, size: 7.5, font, color: MID,
            });
          }

          colAreaTop = stripY;
        }

        const colAreaH = colAreaTop - contentBottom;
        const labelH = 24;

        // Column backgrounds
        page.drawRectangle({ x: colLX, y: contentBottom, width: colW, height: colAreaH, color: SIDE_A_BG });
        page.drawRectangle({ x: colRX, y: contentBottom, width: colW, height: colAreaH, color: WHITE, borderColor: RULE, borderWidth: 1 });
        // Separator bar
        page.drawRectangle({ x: colLX + colW, y: contentBottom, width: colSep, height: colAreaH, color: DARK });

        // Label headers
        const labelY = colAreaTop - labelH;
        page.drawRectangle({ x: colLX, y: labelY, width: colW, height: labelH, color: NAVY });
        page.drawText(`< ${sanitize(s.sideALabel ?? "Side A")}`, {
          x: colLX + 8, y: labelY + 7, size: 11, font: fontBold, color: WHITE,
        });
        page.drawRectangle({ x: colRX, y: labelY, width: colW, height: labelH, color: NAVY_DARK });
        page.drawText(`${sanitize(s.sideBLabel ?? "Side B")} >`, {
          x: colRX + 8, y: labelY + 7, size: 11, font: fontBold, color: WHITE,
        });

        let textAreaTop = labelY; // where text begins below label

        // ── Two images: one in each column ──
        if (twoImages && s.image && s.imageB) {
          const remainH = colAreaH - labelH;
          const imgColH = Math.round(remainH * 0.38); // ~143
          const imgStripY = labelY - imgColH;

          // Side A image
          page.drawRectangle({ x: colLX, y: imgStripY, width: colW, height: imgColH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
          try {
            const embedded = await loadAndEmbedImage(pdf, s.image);
            drawImageCover(page, embedded, colLX, imgStripY, colW, imgColH);
          } catch { /* leave empty */ }
          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 30), {
              x: colLX + 4, y: imgStripY - 12, size: 7, font, color: MID,
            });
          }

          // Side B image
          page.drawRectangle({ x: colRX, y: imgStripY, width: colW, height: imgColH, color: LIGHT, borderColor: RULE, borderWidth: 1 });
          try {
            const embedded = await loadAndEmbedImage(pdf, s.imageB);
            drawImageCover(page, embedded, colRX, imgStripY, colW, imgColH);
          } catch { /* leave empty */ }
          if (s.imageBCredit) {
            page.drawText(sanitize(s.imageBCredit).slice(0, 30), {
              x: colRX + 4, y: imgStripY - 12, size: 7, font, color: MID,
            });
          }

          textAreaTop = imgStripY;
        }

        // ── Text in each column ──
        const textAreaH = textAreaTop - contentBottom;
        const bSz = 14;
        const bLineH = 20;
        const maxColChars = 36;

        // Primary grades: sideABullets / sideBBullets
        // Secondary grades: sideAContent / sideBContent (paragraph text — split into sentences as items)
        const allBullets = s.bullets ?? [];
        const mid = Math.ceil(allBullets.length / 2);

        function contentToItems(content: string | null | undefined): string[] {
          if (!content?.trim()) return [];
          return content.split(/(?<=[.!?])\s+/).map((t) => t.trim()).filter(Boolean);
        }

        const leftBullets = s.sideABullets?.length
          ? s.sideABullets
          : s.sideAContent
          ? contentToItems(s.sideAContent)
          : allBullets.slice(0, mid);
        const rightBullets = s.sideBBullets?.length
          ? s.sideBBullets
          : s.sideBContent
          ? contentToItems(s.sideBContent)
          : allBullets.slice(mid);

        for (const [colX, bullets] of [[colLX, leftBullets], [colRX, rightBullets]] as [number, string[]][]) {
          let totalH = 0;
          for (const b of bullets) totalH += wrapText(sanitize(b), maxColChars).length * bLineH + 8;
          if (totalH > 0) totalH -= 8;

          let cursorY = Math.min(
            textAreaTop - bSz - 4,
            contentBottom + Math.floor((textAreaH + totalH) / 2),
          );

          for (const b of bullets) {
            const lines = wrapText(sanitize(b), maxColChars);
            if (cursorY < contentBottom + 10) break;

            page.drawEllipse({ x: colX + 8, y: cursorY + bSz * 0.35, xScale: 3, yScale: 3, color: BLUE });
            let ly = cursorY;
            for (const line of lines) {
              page.drawText(line, { x: colX + 20, y: ly, size: bSz, font, color: DARK });
              ly -= bLineH;
            }
            cursorY = ly - 8;
          }
        }

      } else if (s.slideType === "fact" && s.image) {
        // ── FACT: image at top full-width, text/bullets below ──────
        const marginX = 36;
        const contentW = pageW - marginX * 2;
        const imageH = Math.round(contentH * 0.45);
        const imgY = contentTop - imageH;

        page.drawRectangle({
          x: marginX, y: imgY, width: contentW, height: imageH,
          color: LIGHT, borderColor: RULE, borderWidth: 1,
        });
        try {
          const embedded = await loadAndEmbedImage(pdf, s.image);
          drawImageCover(page, embedded, marginX, imgY, contentW, imageH);
        } catch { /* leave empty box */ }

        if (s.imageCredit) {
          page.drawText(sanitize(s.imageCredit).slice(0, 80), {
            x: marginX + 4, y: imgY - 14, size: 7.5, font, color: MID,
          });
        }

        const textAreaTop = imgY - (s.imageCredit ? 18 : 4);
        const textAreaH = textAreaTop - contentBottom;
        const bulletSize = 18;
        const lineH = 26;
        const bulletIndent = 28;

        if (s.content) {
          const lines = wrapText(sanitize(s.content), 78);
          const totalH = lines.length * lineH;
          let cursorY = Math.min(
            textAreaTop - bulletSize,
            contentBottom + Math.floor((textAreaH + totalH) / 2)
          );
          for (const line of lines) {
            if (cursorY < contentBottom + 10) break;
            page.drawText(line, { x: marginX, y: cursorY, size: bulletSize, font, color: DARK });
            cursorY -= lineH;
          }
        } else {
          let totalBulletsH = 0;
          for (const b of s.bullets || []) {
            totalBulletsH += wrapText(sanitize(b), 72).length * lineH + 10;
          }
          if (totalBulletsH > 0) totalBulletsH -= 10;

          let cursorY = Math.min(
            textAreaTop - bulletSize,
            contentBottom + Math.floor((textAreaH + totalBulletsH) / 2)
          );

          for (const b of s.bullets || []) {
            const lines = wrapText(sanitize(b), 72);
            page.drawEllipse({
              x: marginX + 10, y: cursorY + bulletSize * 0.35,
              xScale: 4, yScale: 4, color: BLUE,
            });
            let lineY = cursorY;
            for (const line of lines) {
              page.drawText(line, { x: marginX + bulletIndent, y: lineY, size: bulletSize, font, color: DARK });
              lineY -= lineH;
            }
            cursorY = lineY - 10;
            if (cursorY < contentBottom + 10) break;
          }
        }

      } else {
        // ── Standard slide: text left, image/video right ───────────
        const hasImage = Boolean(s.image);
        const hasYouTube = !hasImage && Boolean(s.youtubeVideoId);
        const hasVisual = hasImage || hasYouTube;

        const textX = 36;
        const bulletSize = 18;
        const lineH = 26;
        const bulletIndent = 28;

        if (s.content) {
          // Upper grades: render as wrapped paragraph
          const maxChars = hasVisual ? 44 : 78;
          const lines = wrapText(sanitize(s.content), maxChars);
          const totalH = lines.length * lineH;
          let cursorY = Math.min(
            contentTop - bulletSize,
            contentBottom + Math.floor((contentH + totalH) / 2)
          );
          for (const line of lines) {
            if (cursorY < contentBottom + 10) break;
            page.drawText(line, { x: textX, y: cursorY, size: bulletSize, font, color: DARK });
            cursorY -= lineH;
          }
        } else {
          // Primary grades: render as bullet list
          let totalBulletsH = 0;
          for (const b of s.bullets || []) {
            const maxChars = hasVisual ? 40 : 72;
            const lines = wrapText(sanitize(b), maxChars);
            totalBulletsH += lines.length * lineH + 10;
          }
          if (totalBulletsH > 0) totalBulletsH -= 10;

          let cursorY = Math.min(
            contentTop - bulletSize,
            contentBottom + Math.floor((contentH + totalBulletsH) / 2)
          );

          for (const b of s.bullets || []) {
            const maxChars = hasVisual ? 40 : 72;
            const lines = wrapText(sanitize(b), maxChars);

            page.drawEllipse({
              x: textX + 10,
              y: cursorY + bulletSize * 0.35,
              xScale: 4,
              yScale: 4,
              color: BLUE,
            });

            let lineY = cursorY;
            for (const line of lines) {
              page.drawText(line, {
                x: textX + bulletIndent,
                y: lineY,
                size: bulletSize,
                font,
                color: DARK,
              });
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

          page.drawRectangle({
            x: imgX, y: imgY, width: imgW, height: imgH,
            color: LIGHT, borderColor: RULE, borderWidth: 1,
          });

          if (s.image) {
            try {
              const embedded = await loadAndEmbedImage(pdf, s.image);
              const dims = embedded.scale(1);
              const scale = Math.min((imgW - 8) / dims.width, (imgH - 8) / dims.height);
              const drawW = dims.width * scale;
              const drawH = dims.height * scale;
              const dx = imgX + (imgW - drawW) / 2;
              const dy = imgY + (imgH - drawH) / 2;
              page.drawImage(embedded, { x: dx, y: dy, width: drawW, height: drawH });
            } catch {
              // image fetch/convert failed — box already drawn, leave empty
            }
          }

          if (s.imageCredit) {
            page.drawText(sanitize(s.imageCredit).slice(0, 55), {
              x: imgX + 4, y: imgY - 14, size: 7.5, font, color: MID,
            });
          }
        }

        // ── YouTube column ──────────────────────────────────────────
        if (hasYouTube && s.youtubeVideoId) {
          const videoId = s.youtubeVideoId;
          const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const shortUrl = `youtu.be/${videoId}`;

          const boxX = 556;
          const boxW = 368;
          const boxH = contentH - 4;
          const boxY = contentBottom + 2;

          page.drawRectangle({
            x: boxX, y: boxY, width: boxW, height: boxH,
            color: LIGHT, borderColor: RULE, borderWidth: 1,
          });

          const cx = boxX + boxW / 2;
          const cy = boxY + boxH / 2 + 20;
          const r = 28;
          page.drawEllipse({ x: cx, y: cy, xScale: r, yScale: r, color: rgb(0.86, 0.08, 0.08) });
          page.drawSvgPath("M -9 -13 L 15 0 L -9 13 Z", { x: cx, y: cy, color: WHITE });

          page.drawText("YouTube", {
            x: cx - 32, y: cy - r - 18, size: 13, font: fontBold,
            color: rgb(0.86, 0.08, 0.08),
          });

          page.drawText(shortUrl, {
            x: boxX + (boxW - shortUrl.length * 6.5) / 2,
            y: cy - r - 38, size: 11, font, color: MID,
          });

          const linkAnnot = pdf.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [boxX, boxY, boxX + boxW, boxY + boxH],
            Border: [0, 0, 0],
            C: [],
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
      } // end standard slide

      // ── Footer ────────────────────────────────────────────────────
      page.drawLine({
        start: { x: 36, y: 38 },
        end:   { x: pageW - 36, y: 38 },
        thickness: 0.5,
        color: RULE,
      });
      page.drawText("Classory AI", {
        x: 36,
        y: 22,
        size: 10,
        font,
        color: MID,
      });
    }

    const bytes = await pdf.save();
    const filename =
      (deckTitle || "lesson").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") + ".pdf";

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
