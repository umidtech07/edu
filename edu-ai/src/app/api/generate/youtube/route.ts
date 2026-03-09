import { NextResponse } from "next/server";
import { searchYouTubeVideo } from "@/lib/youtube";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { topic } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ videoId: null });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json({ videoId: null });
    }

    const videoId = await searchYouTubeVideo(topic).catch(() => null);
    return NextResponse.json({ videoId: videoId ?? null });
  } catch (err: any) {
    console.error("YouTube search error:", err);
    return NextResponse.json({ videoId: null });
  }
}
