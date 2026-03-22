import { NextResponse } from "next/server";
import { searchPexels } from "@/lib/pexels";
import { searchUnsplash } from "@/lib/unsplash";
import { searchPixabay } from "@/lib/pixabay";
import { chooseBestPhoto, isBlockedCandidate, PhotoCandidate } from "@/lib/image-match";
import { openai } from "@/lib/openai";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function semanticRank(
  candidates: PhotoCandidate[],
  conceptText: string
): Promise<Array<{ candidate: PhotoCandidate; score: number }>> {
  const filtered = candidates.filter((c) => !isBlockedCandidate(c));
  if (filtered.length === 0) return [];

  const texts = [conceptText, ...filtered.map((c) => `${c.alt} ${c.tags ?? ""}`.trim())];
  const { data } = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });
  const queryVec = data[0].embedding;
  return filtered.map((c, i) => ({
    candidate: c,
    score: cosineSimilarity(queryVec, data[i + 1].embedding),
  }));
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { imageQuery, title, bullets, minScore, imageStrategy } = await req.json();

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
        alt: [p.alt_description, p.description].filter(Boolean).join(" "),
        tags: p.description ?? "",
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
    const threshold = typeof minScore === "number" ? minScore : 2;

    let photo: PhotoCandidate | null = null;

    // Semantic scoring via embeddings — use a richer concept string for
    // metaphor slides so embeddings match the described visual scene.
    if (process.env.OPENAI_API_KEY && candidates.length > 0) {
      try {
        const conceptText = imageStrategy === "metaphor" && imageQuery
          ? imageQuery  // imageQuery IS the visual scene description
          : `${safeTitle} ${safeBullets.join(" ")} ${imageQuery ?? ""}`;

        const ranked = await semanticRank(candidates, conceptText);
        ranked.sort((a, b) => b.score - a.score);
        const best = ranked[0];

        // threshold === 0 means "always take best available" (slide 0 rule);
        // otherwise require a meaningful semantic similarity (≥ 0.20).
        const semanticMin = threshold === 0 ? -1 : 0.20;
        if (best && best.score >= semanticMin) {
          photo = best.candidate;
        }
      } catch {
        // Embeddings failed — fall back to keyword scoring
        const result = chooseBestPhoto(candidates, safeTitle, safeBullets, imageQuery);
        if (result.photo && result.score >= threshold) photo = result.photo;
      }
    } else {
      const result = chooseBestPhoto(candidates, safeTitle, safeBullets, imageQuery);
      if (result.photo && result.score >= threshold) photo = result.photo;
    }

    if (!photo) {
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
