import { NextResponse } from "next/server";
import { generateStabilityImage } from "@/lib/stability";
import { buildRealisticPrompt, isHistoricalTopic } from "@/lib/image-prompts";
import { put } from "@vercel/blob";
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

    // Upload to Vercel Blob so the client stores a short URL instead of a
    // multi-MB base64 data URI — avoids body-size limits on PDF export.
    // Falls back to raw base64 if BLOB_READ_WRITE_TOKEN is not configured
    // (e.g. local dev without a blob store).
    let finalImage = image;
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const contentType = image.split(";")[0].replace("data:", "") || "image/png";
        const ext = contentType.split("/")[1] ?? "png";
        const base64 = image.split(",")[1] ?? "";
        const buf = Buffer.from(base64, "base64");
        const blob = await put(`stability-images/${Date.now()}.${ext}`, buf, {
          access: "public",
          contentType,
        });
        finalImage = blob.url;
      } catch (blobErr) {
        console.error("[Stability] Blob upload failed, falling back to base64:", blobErr);
      }
    }

    return NextResponse.json({
      image: finalImage,
      imageAlt: title ?? "",
      imageSource: "stability",
      imageCredit: "AI-generated image (Stability AI)",
    });
  } catch (err: any) {
    console.error("Stability image error:", err);
    return NextResponse.json({ image: null });
  }
}
