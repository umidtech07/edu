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