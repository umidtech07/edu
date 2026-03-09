import { NextResponse } from "next/server";
import { searchPexels } from "@/lib/pexels";
import { chooseSimplePexelsPhoto } from "@/lib/image-match";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { imageQuery, title, bullets, minScore } = await req.json();

    if (!imageQuery || typeof imageQuery !== "string") {
      return NextResponse.json({ image: null });
    }

    if (!process.env.PEXELS_API_KEY) {
      return NextResponse.json(
        { error: "Missing PEXELS_API_KEY" },
        { status: 500 }
      );
    }

    const photos = await searchPexels(imageQuery, 12, "landscape");
    const { photo, score } = chooseSimplePexelsPhoto(
      photos,
      title ?? "",
      Array.isArray(bullets) ? bullets : []
    );

    const threshold = typeof minScore === "number" ? minScore : 2;
    if (!photo || score < threshold) {
      return NextResponse.json({ image: null });
    }

    return NextResponse.json({
      image:
        photo.src.large2x ??
        photo.src.large ??
        photo.src.medium ??
        photo.src.original ??
        null,
      imageAlt: photo.alt ?? "",
      imageSource: "pexels",
      imageCredit: `Photo by ${photo.photographer} on Pexels`,
    });
  } catch (err: any) {
    console.error("Pexels image error:", err);
    return NextResponse.json({ image: null });
  }
}
