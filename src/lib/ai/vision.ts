import { getGeminiClient } from "./gemini";
import { getServerEnv } from "@/lib/env";

/**
 * Extract text from an image using Gemini vision (replaces OpenAI gpt-4o vision).
 *
 * Accepts a base64-encoded image and its MIME type. The payload is sent
 * via Gemini's `inlineData` part structure (not OpenAI's image_url format).
 * Returns the extracted text.
 */
export async function extractTextFromImage(
  base64Image: string,
  mimeType: string,
  prompt = "Extract all the text from this image exactly as written. Preserve line breaks and paragraph structure. Output only the extracted text."
): Promise<string> {
  const env = getServerEnv();

  const response = await getGeminiClient().models.generateContent({
    model: env.GEMINI_VISION_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: base64Image } },
          { text: prompt },
        ],
      },
    ],
  });

  const text = response.text;
  if (text == null) {
    throw new Error("Gemini vision returned an empty response.");
  }
  return text;
}
