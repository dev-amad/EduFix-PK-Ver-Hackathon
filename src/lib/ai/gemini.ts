import { GoogleGenAI } from "@google/genai";
import { getServerEnv } from "@/lib/env";

let client: GoogleGenAI | null = null;

/** Lazily construct the singleton Google Generative AI client. */
export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const env = getServerEnv();
    client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  }
  return client;
}
