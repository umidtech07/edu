export function buildCartoonPrompt(title: string, bullets: string[]) {
  const mainConcept = bullets?.slice(0, 2).join(", ");

  return [
    `Cute educational cartoon illustration of ${title}.`,
    mainConcept ? `Concept: ${mainConcept}.` : "",
    "Simple educational diagram.",
    "Flat vector cartoon style.",
    "Bright friendly colors.",
    "Minimal shapes.",
    "Children textbook illustration.",
    "White background.",
    "No text.",
    "No labels.",
    "No watermark."
  ]
    .filter(Boolean)
    .join(" ");
}