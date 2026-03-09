type PexelsPhoto = {
  alt: string;
  photographer: string;
  src: {
    original: string;
    large2x?: string;
    large?: string;
    medium?: string;
  };
};

export async function searchPexels(
  query: string,
  perPage = 10,
  orientation: "landscape" | "portrait" | "square" = "landscape"
) {
  if (!process.env.PEXELS_API_KEY) {
    throw new Error("Missing PEXELS_API_KEY");
  }

  const url = new URL("https://api.pexels.com/v1/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", orientation);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: process.env.PEXELS_API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Pexels failed: ${res.status}`);
  }

  const data = await res.json();
  return (data.photos ?? []) as PexelsPhoto[];
}