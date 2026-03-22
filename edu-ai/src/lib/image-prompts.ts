export function buildDiagramPrompt(slideText: string): string {
  return [
    `Educational diagram illustration about: ${slideText}.`,
    "Clean infographic style, clearly labeled diagram.",
    "Flat design, bright colors, white background.",
    "Simple geometric shapes and arrows showing relationships.",
    "High quality, sharp, detailed.",
    "No watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildRealisticPrompt(title: string, bullets: string[]) {
  const mainConcept = bullets?.slice(0, 2).join(", ");

  return [
    `Photorealistic educational image of ${title}.`,
    mainConcept ? `Showing: ${mainConcept}.` : "",
    "High quality photograph.",
    "Sharp focus, natural lighting.",
    "Clean composition.",
    "No text.",
    "No labels.",
    "No watermark.",
    "No people.",
  ]
    .filter(Boolean)
    .join(" ");
}
