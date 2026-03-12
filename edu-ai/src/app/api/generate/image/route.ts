import { NextResponse } from "next/server";
import { searchPexels } from "@/lib/pexels";
import { searchUnsplash } from "@/lib/unsplash";
import { searchPixabay } from "@/lib/pixabay";
import { chooseBestPhoto, PhotoCandidate } from "@/lib/image-match";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { imageQuery, title, bullets, minScore } = await req.json();

    if (!imageQuery || typeof imageQuery !== "string") {
      return NextResponse.json({ image: null });
    }

    const safeTitle = title ?? "";
    const safeBullets: string[] = Array.isArray(bullets) ? bullets : [];

    // Append "no people" so image APIs de-rank human-centric results
    const safeQuery = `${imageQuery} no people`;

    // ── Query all 3 sources in parallel; silently ignore missing keys / errors ──
    const [pexelsPhotos, unsplashPhotos, pixabayPhotos] = await Promise.all([
      process.env.PEXELS_API_KEY
        ? searchPexels(safeQuery, 12).catch((err) => {
            console.error("[Pexels] fetch failed:", err?.message ?? err);
            return [];
          })
        : Promise.resolve([]),

      process.env.UNSPLASH_ACCESS_KEY
        ? searchUnsplash(safeQuery, 12).catch((err) => {
            console.error("[Unsplash] fetch failed:", err?.message ?? err);
            return [] as import("@/lib/unsplash").UnsplashPhoto[];
          })
        : Promise.resolve([]),

      process.env.PIXABAY_API_KEY
        ? searchPixabay(safeQuery, 12).catch(() => [])
        : Promise.resolve([]),
    ]);

    // ── Build unified candidate pool ──────────────────────────────────────────
    const candidates: PhotoCandidate[] = [
      ...pexelsPhotos.map((p) => ({
        url:
          p.src.large2x ??
          p.src.large ??
          p.src.medium ??
          p.src.original ??
          "",
        alt: p.alt ?? "",
        photographer: p.photographer,
        credit: `Photo by ${p.photographer} on Pexels`,
        source: "pexels" as const,
      })),

      ...unsplashPhotos.map((p) => ({
        url: p.urls.regular,
        alt: p.alt_description ?? p.description ?? "",
        tags: `${imageQuery} ${p.description ?? ""}`.trim(),
        photographer: p.user.name,
        credit: `Photo by ${p.user.name} on Unsplash`,
        // Unsplash ToS: attribution link must include UTM params
        creditUrl: `${p.user.links.html}?utm_source=cipherai&utm_medium=referral`,
        source: "unsplash" as const,
      })),

      ...pixabayPhotos.map((p) => ({
        url: p.webformatURL,
        alt: p.tags,   // Pixabay tags double as the description
        tags: p.tags,
        photographer: p.user,
        credit: `Photo by ${p.user} on Pixabay`,
        source: "pixabay" as const,
      })),
    ].filter((c) => !!c.url);

    if (candidates.length === 0) {
      return NextResponse.json({ image: null });
    }

    // ── Score and pick the best match ────────────────────────────────────────
    const { photo, score } = chooseBestPhoto(candidates, safeTitle, safeBullets, imageQuery);

    // Slide 0 uses minScore: 0 to always get something rather than falling back
    // to Stability. All other slides require minScore ≥ 4 (≥ 2 word-boundary
    // alt matches, or equivalent combination of alt + tag hits).
    const threshold = typeof minScore === "number" ? minScore : 4;

    if (!photo || score < threshold) {
      return NextResponse.json({ image: null });
    }

    // ── For Pixabay: proxy the image server-side (hotlinking forbidden by ToS) ─
    if (photo.source === "pixabay") {
      const imgRes = await fetch(photo.url);
      if (!imgRes.ok) {
        return NextResponse.json({ image: null });
      }
      const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
      const buffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      const dataUri = `data:${contentType};base64,${base64}`;

      return NextResponse.json({
        image: dataUri,
        imageAlt: photo.alt,
        imageSource: "pixabay",
        imageCredit: photo.credit,
      });
    }

    // ── Pexels / Unsplash: return URL directly ────────────────────────────────
    return NextResponse.json({
      image: photo.url,
      imageAlt: photo.alt,
      imageSource: photo.source,
      imageCredit: photo.credit,
      // Only set for Unsplash — links to photographer profile with UTM params
      imageCreditUrl: photo.creditUrl ?? null,
    });
  } catch (err: any) {
    console.error("Image search error:", err);
    return NextResponse.json({ image: null });
  }
}
