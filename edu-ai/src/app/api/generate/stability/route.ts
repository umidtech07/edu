import { NextResponse } from "next/server";
import { generateStabilityImage } from "@/lib/stability";
import { buildRealisticPrompt } from "@/lib/image-prompts";
import { put } from "@vercel/blob";

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
      } catch {
        // fall back to base64 data URI
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
