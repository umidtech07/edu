export function buildDiagramPrompt(slideText: string): string {
  return [
    `Educational diagram illustration about: ${slideText}.`,
    "Clean infographic style.",
    "Flat design, bright colors, white background.",
    "Simple geometric shapes and arrows showing relationships.",
    "High quality, sharp, detailed.",
    "No text.",
    "No labels.",
    "No letters.",
    "No numbers.",
    "No watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Keywords that signal a historical/period topic
const HISTORICAL_KEYWORDS = [
  "ancient", "medieval", "century", "bc", "ad", "empire", "dynasty",
  "war", "battle", "revolution", "historical", "history", "civilization",
  "greek", "roman", "egyptian", "mesopotamian", "viking", "aztec", "inca",
  "ottoman", "mongol", "renaissance", "industrial", "colonial", "world war",
  "feudal", "prehistoric", "bronze age", "iron age", "middle ages",
];

export function isHistoricalTopic(text: string): boolean {
  const lower = text.toLowerCase();
  return HISTORICAL_KEYWORDS.some((kw) => lower.includes(kw));
}

export function buildRealisticPrompt(title: string, bullets: string[], deckTitle = "") {
  const mainConcept = bullets?.slice(0, 2).join(", ");

  // Anchor the image to the full deck subject, not just the slide title
  const subjectContext = deckTitle && deckTitle !== title
    ? `${deckTitle} — ${title}`
    : title;

  // Suppress modern imagery when the topic is historical
  const historical = isHistoricalTopic(deckTitle) || isHistoricalTopic(title);
  const eraNote = historical
    ? "Period-accurate setting, historical era, no modern objects, no contemporary clothing, no technology."
    : "";

  return [
    `Close-up photorealistic educational photograph of ${subjectContext}.`,
    mainConcept ? `Scene clearly shows: ${mainConcept}.` : "",
    eraNote,
    "Single focused subject, uncluttered background.",
    "Sharp focus, natural lighting, high detail.",
    "Professionally composed, wide establishing shot.",
    "No text.",
    "No labels.",
    "No watermark.",
    "No people.",
  ]
    .filter(Boolean)
    .join(" ");
}
