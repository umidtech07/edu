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
  
  function tokenize(text: string) {
    return text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4);
  }
  
  export function chooseSimplePexelsPhoto(
    photos: PexelsPhoto[],
    title: string,
    bullets: string[]
  ) {
    const keywords = new Set(tokenize(`${title} ${bullets.join(" ")}`));
  
    let best: PexelsPhoto | null = null;
    let bestScore = -1;
  
    for (const photo of photos) {
      const alt = (photo.alt || "").toLowerCase();
      let score = 0;
  
      for (const word of keywords) {
        if (alt.includes(word)) score++;
      }
  
      if (score > bestScore) {
        best = photo;
        bestScore = score;
      }
    }
  
    return {
      photo: best,
      score: bestScore,
    };
  }