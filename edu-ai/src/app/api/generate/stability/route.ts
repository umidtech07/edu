import { NextResponse } from "next/server";
import { generateStabilityImage } from "@/lib/stability";
import { buildRealisticPrompt, isHistoricalTopic } from "@/lib/image-prompts";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function toVisualPrompt(rawPrompt: string): Promise<string> {
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "You convert educational slide descriptions into short, purely visual image prompts for a diffusion model. " +
            "Describe only concrete visual elements (shapes, colors, objects, layout). " +
            "For technology or programming topics, depict relevant digital objects like a computer screen showing a web browser, code editor, or colorful diagrams — do NOT substitute them with books, libraries, or unrelated scenes. " +
            "For science topics, depict relevant lab equipment, nature, or physical phenomena. " +
            "Stay faithful to the subject matter; never replace it with a metaphorical or unrelated scene. " +
            "Output one sentence, no quotes.",
        },
        { role: "user", content: rawPrompt },
      ],
    });
    return res.choices[0]?.message?.content?.trim() || rawPrompt;
  } catch {
    return rawPrompt;
  }
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { title, bullets, deckTitle } = await req.json();

    if (!process.env.STABILITY_API_KEY) {
      return NextResponse.json(
        { error: "Missing STABILITY_API_KEY" },
        { status: 500 }
      );
    }

    const resolvedDeckTitle = deckTitle ?? "";
    const realisticPrompt = buildRealisticPrompt(
      title ?? "",
      Array.isArray(bullets) ? bullets : [],
      resolvedDeckTitle
    );

    const historical = isHistoricalTopic(resolvedDeckTitle) || isHistoricalTopic(title ?? "");

    const visualPrompt = await toVisualPrompt(realisticPrompt);

    const image = await generateStabilityImage({
      prompt: visualPrompt,
      aspectRatio: "16:9",
      outputFormat: "png",
      historical,
    });

    return NextResponse.json({
      image,
      imageAlt: title ?? "",
      imageSource: "stability",
      imageCredit: "AI-generated image (Stability AI)",
    });
  } catch (err: any) {
    console.error("Stability image error:", err);
    return NextResponse.json({ image: null });
  }
}
