import { GoogleGenAI } from "@google/genai";

export function getGenAI(): GoogleGenAI {
  const apiKey = (process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"] || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}
