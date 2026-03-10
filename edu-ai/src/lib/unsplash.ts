export type UnsplashPhoto = {
  id: string;
  alt_description: string | null;
  description: string | null;
  urls: {
    regular: string;
    small: string;
  };
  user: {
    name: string;
    links: {
      html: string;
    };
  };
};

export async function searchUnsplash(
  query: string,
  perPage = 12
): Promise<UnsplashPhoto[]> {
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    throw new Error("Missing UNSPLASH_ACCESS_KEY");
  }

  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "landscape");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Unsplash failed: ${res.status} — ${body}`);
  }

  const data = await res.json();
  return (data.results ?? []) as UnsplashPhoto[];
}
