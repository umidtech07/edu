export type PixabayPhoto = {
  id: number;
  tags: string;
  webformatURL: string;
  user: string;
};

export async function searchPixabay(
  query: string,
  perPage = 12
): Promise<PixabayPhoto[]> {
  if (!process.env.PIXABAY_API_KEY) {
    throw new Error("Missing PIXABAY_API_KEY");
  }

  const url = new URL("https://pixabay.com/api/");
  url.searchParams.set("key", process.env.PIXABAY_API_KEY);
  url.searchParams.set("q", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "horizontal");
  url.searchParams.set("image_type", "photo");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Pixabay failed: ${res.status}`);

  const data = await res.json();
  return (data.hits ?? []) as PixabayPhoto[];
}
