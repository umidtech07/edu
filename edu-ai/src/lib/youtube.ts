/**
 * Search YouTube Data API v3 for an embeddable video.
 * Returns the videoId string, or null on failure / missing key.
 */
export async function searchYouTubeVideo(query: string): Promise<string | null> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("q", query);
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("safeSearch", "strict");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const data = await res.json();
    return (data.items?.[0]?.id?.videoId as string) ?? null;
  } catch {
    return null;
  }
}
