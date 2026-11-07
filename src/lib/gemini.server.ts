const DEFAULT_MODEL = "gemini-3.8-flash";

export class AiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AiError";
    this.status = status;
  }
}

type GeminiResponse = {
  error?: { message?: string };
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
};

export async function generateText(input: {
  instructions: string;
  input: string;
  model?: string;
}): Promise<string> {
  const key = process.env["GEMINI_API_KEY"]?.trim() || process.env["GOOGLE_API_KEY"]?.trim();
  if (!key) throw new AiError(503, "AI is not configured. Set GEMINI_API_KEY.");

  const model = input.model ?? DEFAULT_MODEL;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.instructions }] },
        contents: [{ role: "user", parts: [{ text: input.input }] }],
        generationConfig: { temperature: 0.4 },
      }),
    },
  );

  const json = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok) {
    throw new AiError(res.status, json?.error?.message || `AI request failed (${res.status})`);
  }

  const text = (json?.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new AiError(502, "The assistant returned an empty response.");
  return text;
}

export function aiErrorMessage(err: AiError): string {
  if (err.status === 429) return "The assistant is busy. Please try again in a minute.";
  if (err.status === 401 || err.status === 403) return "The assistant is not configured correctly. Check GEMINI_API_KEY.";
  if (err.status === 503) return "The assistant is not configured yet. Set GEMINI_API_KEY on the server.";
  return "The assistant couldn't respond right now.";
}
