import { NextResponse } from "next/server";
import { generateStabilityImage } from "@/lib/stability";
import { buildDiagramPrompt } from "@/lib/image-prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!process.env.STABILITY_API_KEY) return NextResponse.json({ image: null });

    let slideText: string;

    // Deck-level format: { deckTitle, slides[] }
    if (body.deckTitle && Array.isArray(body.slides)) {
      const { deckTitle, slides } = body as {
        deckTitle: string;
        slides: { title: string; bullets?: string[]; content?: string | null }[];
      };
      const topicLines = slides.map((s) => `- ${s.title}`).join(", ");
      slideText = `${deckTitle}: ${topicLines}`;
    } else {
      // Legacy per-slide format: { title, bullets, content }
      const { title, bullets, content } = body;
      if (!title) return NextResponse.json({ image: null });
      slideText = [title, ...(Array.isArray(bullets) ? bullets : []), content ?? ""]
        .filter(Boolean)
        .join(". ");
    }

    const prompt = buildDiagramPrompt(slideText);

    const image = await generateStabilityImage({
      prompt,
      aspectRatio: "16:9",
      outputFormat: "png",
    });

    return NextResponse.json({
      image,
      imageAlt: `Diagram: ${body.deckTitle ?? body.title ?? ""}`,
      imageSource: "diagram",
      imageCredit: "AI-generated diagram (Stability AI)",
    });
  } catch (err: any) {
    console.error("Diagram generation error:", err);
    return NextResponse.json({ image: null });
  }
}
