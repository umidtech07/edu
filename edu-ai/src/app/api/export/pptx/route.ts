import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const maxRequestBodySize = "50mb";

type Slide = {
  title: string;
  bullets: string[];
  content?: string | null;
  image?: string | null;   // URL
  imageAlt?: string;
  imageCredit?: string | null;
  youtubeVideoId?: string | null;
};

async function fetchImageAsDataUri(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch image: ${r.status}`);
  const contentType = r.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

export async function POST(req: Request) {
  try {
    const { deckTitle = "Lesson", slides } = (await req.json()) as {
      deckTitle?: string;
      slides: Slide[];
    };

    if (!slides?.length) {
      return NextResponse.json({ error: "slides required" }, { status: 400 });
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 (16:9)

    // Title slide
    const s0 = pptx.addSlide();
    s0.background = { color: "FFFFFF" };
    s0.addText(deckTitle, {
      x: 0.8, y: 2.6, w: 11.8, h: 1,
      fontFace: "Segoe UI Emoji",
      fontSize: 44,
      bold: true,
      color: "111827",
    });

    // Content slides (white background, text left, image right)
    for (const s of slides) {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };

      // Title
      slide.addText(s.title || "", {
        x: 0.7, y: 0.5, w: 12, h: 0.7,
        fontFace: "Segoe UI Emoji",
        fontSize: 32,
        bold: true,
        color: "111827",
      });

      // Text content (left): paragraph for upper grades, bullets for primary
      if (s.content) {
        slide.addText(s.content, {
          x: 0.9,
          y: 1.5,
          w: 6.2,
          h: 5.5,
          fontFace: "Segoe UI Emoji",
          fontSize: 18,
          wrap: true,
          valign: "middle",
        });
      } else {
        slide.addText(
          (s.bullets || []).map((b) => ({
            text: b,
            options: { bullet: true }
          })),
          {
            x: 0.9,
            y: 1.5,
            w: 6.2,
            h: 5.5,
            fontFace: "Segoe UI Emoji",
            fontSize: 20
          }
        );
      }

      // Image (right)
      if (s.image) {
        try {
          const dataUri = await fetchImageAsDataUri(s.image);
          slide.addImage({
            data: dataUri,
            x: 7.4, y: 1.5, w: 5.5, h: 4.3,
          });
        } catch {
          // skip image if it fails
        }
        if (s.imageCredit) {
          slide.addText(s.imageCredit, {
            x: 7.4, y: 5.85, w: 5.5, h: 0.3,
            fontFace: "Segoe UI Emoji",
            fontSize: 8,
            color: "9CA3AF",
            align: "right",
          });
        }
      } else if (s.youtubeVideoId) {
        const videoUrl = `https://www.youtube.com/watch?v=${s.youtubeVideoId}`;
        const shortUrl = `youtu.be/${s.youtubeVideoId}`;
        slide.addText([
          { text: "▶  Watch on YouTube\n", options: { bold: true, color: "CC1400", fontSize: 20 } },
          { text: shortUrl, options: { hyperlink: { url: videoUrl }, color: "1D4ED8", fontSize: 16 } },
        ], {
          x: 7.4, y: 1.5, w: 5.5, h: 4.3,
          fontFace: "Segoe UI Emoji",
          align: "center",
          valign: "middle",
        });
      }
    }

    const buffer = await pptx.write({ outputType: "nodebuffer" });

    const filename =
      (deckTitle || "lesson").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_") + ".pptx";

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "export pptx failed", details: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
