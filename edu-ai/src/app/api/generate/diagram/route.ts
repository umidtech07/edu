import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:[^"']*/gi, "")
    // Escape bare & that are not already valid XML entities — prevents rsvg XML parse errors
    .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .trim();
}

function extractSvg(text: string): string | null {
  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  return match ? match[0] : null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ image: null });

    let slideText: string;

    // Deck-level format: { deckTitle, slides[] }
    if (body.deckTitle && Array.isArray(body.slides)) {
      const { deckTitle, slides } = body as {
        deckTitle: string;
        slides: { title: string; bullets?: string[]; content?: string | null }[];
      };
      const topicLines = slides
        .map((s) => `- ${s.title}`)
        .join("\n");
      slideText = `${deckTitle}\n\nSlide topics covered:\n${topicLines}`;
    } else {
      // Legacy per-slide format: { title, bullets, content }
      const { title, bullets, content } = body;
      if (!title) return NextResponse.json({ image: null });
      slideText = [title, ...(Array.isArray(bullets) ? bullets : []), content ?? ""]
        .filter(Boolean)
        .join(". ");
    }

    const prompt = `Create a clean, simple educational SVG diagram about: "${slideText}"

Layout rules:
- Canvas: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 480" width="900" height="480">
- Background: <rect width="900" height="480" fill="#f0fdf4"/>
- Title bar: <rect> across the full top (y=0 h=44 fill="#166534"), title text centered, font-size="17" fill="white" font-weight="bold".
- Draw a large, clear central illustration filling most of the canvas (below the title bar).
- Label EVERY distinct element that has a name (e.g. every planet, every part, every stage) — do NOT omit any for space reasons; arrange shapes so all labels fit without overlap.
- Labels: font-size="13" fill="#1e293b", short (1–3 words each).
- Label placement rules (strictly follow):
  * For horizontally arranged shapes (e.g. planets in a row): place EVERY label BELOW its shape, centered on the shape's x-coordinate, at least 10px below the bottom edge of the shape. Never place labels above or to the side of shapes in a row layout.
  * For vertically arranged shapes: place labels to the RIGHT of the shape.
  * For scattered/radial layouts: place labels outside the shape boundary (not overlapping), using text-anchor="middle" or "start" as needed.
  * Satellite/moon labels: place ABOVE the satellite shape, not overlapping the parent body.
  * NEVER place a text element so that it overlaps a shape it is not labeling.
- ACCURACY: include every item required by the topic (e.g. all 8 planets in order for a solar system). Never skip named elements.
- DIAGRAM ONLY: do NOT include any quiz boxes, reflection questions, true/false prompts, recap sections, activity boxes, or any instructional text elements — only the diagram illustration and its element labels.

Drawing quality:
- Use <defs> with <linearGradient> or <radialGradient> for depth.
- Outlines: stroke="#334155" stroke-width="1.5" on major shapes.
- Keep it visually simple and uncluttered — fewer elements, bigger shapes.

Color palette:
  #16a34a green · #22c55e light-green · #166534 dark-green · #f0fdf4 very-light-green
  #fbbf24 amber · #dc2626 red · #60a5fa blue · #3b82f6 mid-blue · #94a3b8 grey
  #f97316 orange

Technical constraints:
- Allowed elements only: <svg> <defs> <linearGradient> <radialGradient> <stop> <g> <rect> <circle> <ellipse> <polygon> <polyline> <path> <line> <text> <tspan>
- No <image>, no <foreignObject>, no CSS classes, no external references, no <script>
- All attributes inline; valid XML (quote all attributes, close all tags)
- Return ONLY the raw SVG markup with no explanation, no markdown fences`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.25,
      max_tokens: 4096,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SVG illustrator specializing in K-8 educational diagrams. Produce accurate, visually rich, self-contained SVG markup. Never include explanations, markdown, or code fences — raw SVG only.",
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const svg = extractSvg(raw);
    if (!svg) return NextResponse.json({ image: null });

    const clean = sanitizeSvg(svg);
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(clean).toString("base64")}`;

    return NextResponse.json({
      image: dataUri,
      imageAlt: `Diagram: ${body.deckTitle ?? body.title ?? ""}`,
      imageSource: "diagram",
      imageCredit: "AI-generated diagram",
    });
  } catch (err: any) {
    console.error("Diagram generation error:", err);
    return NextResponse.json({ image: null });
  }
}
