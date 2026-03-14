import { NextResponse } from "next/server";
import { generateStabilityImage } from "@/lib/stability";
import { buildRealisticPrompt } from "@/lib/image-prompts";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { title, bullets } = await req.json();

    if (!process.env.STABILITY_API_KEY) {
      return NextResponse.json(
        { error: "Missing STABILITY_API_KEY" },
        { status: 500 }
      );
    }

    const realisticPrompt = buildRealisticPrompt(
      title ?? "",
      Array.isArray(bullets) ? bullets : []
    );

    const image = await generateStabilityImage({
      prompt: realisticPrompt,
      aspectRatio: "16:9",
      outputFormat: "png",
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
