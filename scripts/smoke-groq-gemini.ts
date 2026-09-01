import { loadEnvFile } from "./lib/load-env";
loadEnvFile();

async function main() {
  const { groqChat } = await import("../src/lib/ai/groq");
  const { embedTexts } = await import("../src/lib/ai/embeddings");
  const { getServerEnv } = await import("../src/lib/env");

  const env = getServerEnv();

  // --- Groq LLM smoke test ---
  console.log("[Groq] model:", env.GROQ_MODEL, "baseURL:", env.GROQ_BASE_URL);
  const reply = await groqChat([
    { role: "user", content: "Reply with exactly the word: ready" },
  ]);
  console.log("[Groq] reply:", JSON.stringify(reply.trim()));

  // --- Gemini embeddings smoke test ---
  console.log("[Gemini] embedding model:", env.GEMINI_EMBEDDING_MODEL);
  const vectors = await embedTexts([
    "The War of Independence took place in 1857.",
    "Pakistan Studies is a CAIE O Level subject.",
  ]);
  console.log("[Gemini] batch size:", vectors.length);
  console.log("[Gemini] vector dims:", vectors[0].length, "(expected", env.EMBEDDING_DIMENSIONS + ")");
  console.log(
    "[Gemini] dim check:",
    vectors.every((v) => v.length === env.EMBEDDING_DIMENSIONS) ? "PASS" : "FAIL"
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("SMOKE TEST FAILED:", e?.message ?? e);
    process.exit(1);
  });
