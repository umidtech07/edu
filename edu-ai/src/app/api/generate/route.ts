import { NextResponse } from "next/server";
import { openai } from "@/lib/openai";
import { searchPexels } from "@/lib/pexels";
import { chooseSimplePexelsPhoto } from "@/lib/image-match";
import { generateStabilityImage } from "@/lib/stability";
import { buildCartoonPrompt } from "@/lib/image-prompts";

export const runtime = "nodejs";

function safeJsonParse(text: string) {
  try {
    const cleaned = text
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const {
      topic,
      grade = "",
      slideCount = 8,
      primaryMode = false,
    } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json({ error: "topic is required" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    if (!process.env.PEXELS_API_KEY) {
      return NextResponse.json(
        { error: "Missing PEXELS_API_KEY" },
        { status: 500 }
      );
    }

    if (!process.env.STABILITY_API_KEY) {
      return NextResponse.json(
        { error: "Missing STABILITY_API_KEY" },
        { status: 500 }
      );
    }

    const numericGrade =
      typeof grade === "number" ? grade : Number(String(grade).trim());
    const isPrimary =
      primaryMode || (!Number.isNaN(numericGrade) && numericGrade <= 4);

    const effectiveSlideCount = isPrimary ? 5 : slideCount;

    const prompt = `
Create a lesson presentation deck.

Topic: ${topic}
${grade ? `Grade: ${grade}` : ""}
Slides: ${effectiveSlideCount}

Return ONLY valid JSON in this format:

{
 "deckTitle": "string",
 "slides": [
  {
   "title": "string",
   "bullets": ["string"],
   "imageQuery": "string or null"
  }
 ]
}

Rules:
- Exactly ${effectiveSlideCount} slides
- Use varied slide types
- Do NOT make every slide the same
- Mix these slide types:
  1. explanation slide
  2. example slide
  3. interesting fact
  4. reflection question
  5. true/false quiz
  6. recap slide

Image rules:
- NOT every slide needs an image
- reflection or quiz slides should have imageQuery: null
- only visual slides should include imageQuery

${
  isPrimary
    ? `
Primary grade rules:
- Keep slides very simple and child friendly
- Use only 4–5 slides total
- Only about 2–3 slides should be visual
- Include at least one reflection/question slide with NO image
- Include at least one quiz or true/false slide with NO image
`
    : `
Upper grade rules:
- Only about 2–3 slides should need images
- Other slides should be explanation, reflection, quiz, or recap
- For quiz/reflection slides set imageQuery: null
- For programming or HTML topics, avoid unnecessary image slides
`
}

Style:
- child friendly
- short bullets
- max 12 words
- keep wording simple
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.6,
      messages: [
        { role: "system", content: "Return strict JSON only." },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = safeJsonParse(raw);

    if (!parsed || !parsed.slides) {
      throw new Error("Invalid JSON from OpenAI");
    }

    const deck = {
      deckTitle: parsed.deckTitle ?? topic,
      slides: Array.isArray(parsed.slides)
        ? parsed.slides.slice(0, effectiveSlideCount)
        : [],
    };

    const slidesWithImages: Array<{
      title: string;
      bullets: string[];
      image: string | null;
      imageAlt: string;
      imageSource: "pexels" | "stability" | null;
    }> = [];

    // Primary grade limits
    let primaryAiImagesUsed = 0;
    let primaryRealImagesUsed = 0;

    // NEW: global AI limit for entire deck
    let totalAiImagesUsed = 0;
    const maxAiImagesPerDeck = 1;

    for (const s of deck.slides) {
      const title = s?.title ?? "";
      const bullets = Array.isArray(s?.bullets) ? s.bullets : [];
      const imageQuery =
        typeof s?.imageQuery === "string" && s.imageQuery.trim() !== ""
          ? s.imageQuery
          : null;

      if (!imageQuery) {
        slidesWithImages.push({
          title,
          bullets,
          image: null,
          imageAlt: "",
          imageSource: null,
        });
        continue;
      }

      // -------- Primary mode --------
      if (isPrimary) {
        // Try one real image first
        if (primaryRealImagesUsed < 1) {
          try {
            const photos = await searchPexels(imageQuery, 12, "landscape");
            const { photo, score } = chooseSimplePexelsPhoto(
              photos,
              title,
              bullets
            );

            if (photo && score >= 2) {
              primaryRealImagesUsed++;

              slidesWithImages.push({
                title,
                bullets,
                image:
                  photo.src.large2x ??
                  photo.src.large ??
                  photo.src.medium ??
                  photo.src.original ??
                  null,
                imageAlt: photo.alt ?? "",
                imageSource: "pexels",
              });
              continue;
            }
          } catch (e) {
            console.error("Primary Pexels error:", e);
          }
        }

        // Use AI only if deck-wide AI limit is not reached
        if (primaryAiImagesUsed < 2 && totalAiImagesUsed < maxAiImagesPerDeck) {
          try {
            const cartoonPrompt = buildCartoonPrompt(title, bullets);

            const image = await generateStabilityImage({
              prompt: cartoonPrompt,
              aspectRatio: "16:9",
              outputFormat: "png",
            });

            primaryAiImagesUsed++;
            totalAiImagesUsed++;

            slidesWithImages.push({
              title,
              bullets,
              image,
              imageAlt: title,
              imageSource: "stability",
            });
            continue;
          } catch (e) {
            console.error("Primary Stability error:", e);
          }
        }

        // Otherwise no image
        slidesWithImages.push({
          title,
          bullets,
          image: null,
          imageAlt: "",
          imageSource: null,
        });
        continue;
      }

      // -------- Grade 5+ hybrid --------
      try {
        const photos = await searchPexels(imageQuery, 12, "landscape");
        const { photo, score } = chooseSimplePexelsPhoto(
          photos,
          title,
          bullets
        );

        if (photo && score >= 2) {
          slidesWithImages.push({
            title,
            bullets,
            image:
              photo.src.large2x ??
              photo.src.large ??
              photo.src.medium ??
              photo.src.original ??
              null,
            imageAlt: photo.alt ?? "",
            imageSource: "pexels",
          });
          continue;
        }
      } catch (e) {
        console.error("Pexels error:", e);
      }

      // AI fallback only if deck-wide AI limit not reached
      if (totalAiImagesUsed < maxAiImagesPerDeck) {
        try {
          const cartoonPrompt = buildCartoonPrompt(title, bullets);

          const image = await generateStabilityImage({
            prompt: cartoonPrompt,
            aspectRatio: "16:9",
            outputFormat: "png",
          });

          totalAiImagesUsed++;

          slidesWithImages.push({
            title,
            bullets,
            image,
            imageAlt: title,
            imageSource: "stability",
          });
          continue;
        } catch (e) {
          console.error("Stability fallback error:", e);
        }
      }

      // Final fallback: no image
      slidesWithImages.push({
        title,
        bullets,
        image: null,
        imageAlt: "",
        imageSource: null,
      });
    }

    return NextResponse.json({
      deckTitle: deck.deckTitle,
      slides: slidesWithImages,
    });
  } catch (err: any) {
    console.error("Generate error:", err);

    return NextResponse.json(
      {
        error: "generate failed",
        details: err?.message ?? "unknown error",
      },
      { status: 500 }
    );
  }
}