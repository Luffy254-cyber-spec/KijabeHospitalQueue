import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Gemini female voices: warm, gentle, then smooth. */
const VOICES = ["Sulafat", "Vindemiatrix", "Despina"] as const;

function pcmToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function geminiSpeech(text: string, voice: string, key: string): Promise<{ audio: Buffer; mime: string } | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  };
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) return null;
  const raw = Buffer.from(inline.data, "base64");
  const mime = inline.mimeType || "audio/pcm";
  if (mime.includes("wav")) return { audio: raw, mime: "audio/wav" };
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] || 24000);
  return { audio: pcmToWav(raw, rate), mime: "audio/wav" };
}

export const Route = createFileRoute("/api/public/announce")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      POST: async ({ request }) => {
        const key = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
        if (!key) {
          return Response.json({ error: "Set GEMINI_API_KEY to use the female Gemini voice." }, { status: 503, headers: cors });
        }
        const body = (await request.json().catch(() => ({}))) as { text?: string };
        const text = (body.text || "").trim().slice(0, 800);
        if (!text) return Response.json({ error: "Missing text" }, { status: 400, headers: cors });

        for (const voice of VOICES) {
          try {
            const spoken = await geminiSpeech(text, voice, key);
            if (!spoken) continue;
            return new Response(new Uint8Array(spoken.audio), {
              headers: { ...cors, "Content-Type": spoken.mime, "X-Gemini-Voice": voice },
            });
          } catch {
            /* try the next female voice */
          }
        }
        return Response.json({ error: "Gemini voice unavailable" }, { status: 502, headers: cors });
      },
    },
  },
});
