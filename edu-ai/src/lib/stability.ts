type StabilityArgs = {
    prompt: string;
    aspectRatio?: "16:9" | "1:1" | "4:3" | "3:2";
    outputFormat?: "png" | "jpeg" | "webp";
    historical?: boolean;
  };

  export async function generateStabilityImage({
    prompt,
    aspectRatio = "16:9",
    outputFormat = "png",
    historical = false,
  }: StabilityArgs): Promise<string> {
    if (!process.env.STABILITY_API_KEY) {
      throw new Error("Missing STABILITY_API_KEY");
    }

    const baseNegative = "text, letters, numbers, words, labels, captions, watermark, typography";
    const historicalNegative = historical
      ? ", modern, contemporary, classroom, computer, smartphone, tablet, television, car, electricity, internet, 20th century, 21st century"
      : "";

    const form = new FormData();
    form.append("prompt", prompt);
    form.append("negative_prompt", baseNegative + historicalNegative);
    form.append("aspect_ratio", aspectRatio);
    form.append("output_format", outputFormat);
  
    const res = await fetch(
      "https://api.stability.ai/v2beta/stable-image/generate/core",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: "image/*",
        },
        body: form,
      }
    );
  
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Stability failed: ${res.status} ${err}`);
    }
  
    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
  
    return `data:${contentType};base64,${base64}`;
  }