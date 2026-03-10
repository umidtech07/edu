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
 *   alt text match  → 2 pts per keyword
 *   tags match      → 1 pt  per keyword
 */
function scoreCandidate(
  candidate: PhotoCandidate,
  keywords: Set<string>
): number {
  let score = 0;
  const alt = candidate.alt.toLowerCase();
  const tags = (candidate.tags ?? "").toLowerCase();

  for (const kw of keywords) {
    if (alt.includes(kw)) score += 2;
    if (tags.includes(kw)) score += 1;
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
    const score = scoreCandidate(candidate, keywords);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return { photo: best, score: bestScore };
}
