export type PhotoCandidate = {
  /** Direct image URL (Pexels/Unsplash) or webformatURL to proxy (Pixabay) */
  url: string;
  /** Alt text or description */
  alt: string;
  /** Comma-separated tag string (Pixabay) or space-separated description (Unsplash) */
  tags?: string;
  photographer: string;
  credit: string;
  /** Clickable URL for the credit (required by Unsplash ToS; optional for others) */
  creditUrl?: string;
  source: "pexels" | "unsplash" | "pixabay";
};

// Terms that indicate body/adult/fashion content — inappropriate for an
// educational kids app. Candidates whose alt text or tags contain any of
// these words are silently dropped before scoring.
const BLOCKED_TERMS = [
  "bikini", "underwear", "lingerie", "swimwear", "swimsuit", "bra", "panty",
  "panties", "nude", "naked", "topless", "bodywear", "shapewear", "thong",
  "corset", "bralette", "leotard", "bodysuit", "plus size model",
  "body positive", "skin", "intimate", "sexy", "sensual",
  // People/human-centric content — not appropriate for a nature/science kids app
  "woman", "women", "lady", "ladies", "girl", "female", "man", "men",
  "person", "people", "model", "portrait", "pose", "posing", "fashion",
  "blogger", "influencer", "makeup", "beauty", "selfie",
  // Beach/outdoor scenes with people
  "beach people", "people beach", "beach crowd", "crowd beach",
  "sunbather", "sunbathing", "sunbathe", "tanning", "beachgoer",
  "swimmer", "swimming", "surfer", "surfing", "volleyball",
  "tourist", "tourists", "vacation", "holiday", "traveler",
  "couple", "family", "friends", "kid", "kids", "child", "children",
  "boy", "boys", "teen", "teenager",
];

export function isBlockedCandidate(candidate: PhotoCandidate): boolean {
  const haystack = `${candidate.alt} ${candidate.tags ?? ""}`.toLowerCase();
  return BLOCKED_TERMS.some((term) => haystack.includes(term));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4);
}

/**
 * Score a candidate photo against the slide's title + bullets.
 *
 * Weights:
 *   alt text match (word boundary)  → 2 pts per keyword
 *   tags match (word boundary)      → 1 pt  per keyword
 *
 * Word-boundary matching avoids false positives from partial substring hits
 * (e.g. "cat" matching "education" or "scatter").
 */
function scoreCandidate(
  candidate: PhotoCandidate,
  keywords: Set<string>
): number {
  let score = 0;
  const alt = candidate.alt.toLowerCase();
  const tags = (candidate.tags ?? "").toLowerCase();

  for (const kw of keywords) {
    // Escape regex special chars then require word boundaries
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${escaped}\\b`);
    if (re.test(alt)) score += 2;
    if (re.test(tags)) score += 1;
  }

  return score;
}

export function chooseBestPhoto(
  candidates: PhotoCandidate[],
  title: string,
  bullets: string[],
  imageQuery?: string
): { photo: PhotoCandidate | null; score: number } {
  const keywords = new Set(
    tokenize(`${title} ${bullets.join(" ")} ${imageQuery ?? ""}`)
  );

  let best: PhotoCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (isBlockedCandidate(candidate)) continue;
    const score = scoreCandidate(candidate, keywords);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { photo: best, score: bestScore };
}
