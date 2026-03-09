import { NextResponse } from "next/server";

// This route is deprecated. The frontend now calls the sub-routes directly:
//   POST /api/generate/text      — OpenAI slide text
//   POST /api/generate/image     — Pexels photo search
//   POST /api/generate/stability — Stability AI image
//   POST /api/generate/youtube   — YouTube video search

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Use the sub-routes: /api/generate/text, /api/generate/image, /api/generate/stability, /api/generate/youtube",
    },
    { status: 410 }
  );
}
