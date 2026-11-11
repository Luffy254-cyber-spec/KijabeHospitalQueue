import { createFileRoute } from "@tanstack/react-router";
import { getGenAI } from "@/lib/gemini-client.server";
import { corsHeaders } from "@/lib/http-security";

const KIOSK_GUIDE_PROMPT = `You are the AIC Kijabe Hospital Kiosk Patient Guide Assistant (Msaidizi wa Kiosk ya Wagonjwa).
You are built into the outpatient self check-in touchscreen at AIC Kijabe Hospital ("Health & Healing in Jesus' Name").
Your mission is to guide patients, expectant mothers, elderly individuals, and guardians step-by-step through checking in, entering details, and understanding the clinic journey.

CRITICAL LANGUAGE RULE:
- If the language requested is "sw" (Kiswahili): You MUST respond ONLY in warm, respectful, fluent Kiswahili. Use comforting words like "Karibu sana", "Usijali", "Pole kwa maumivu", "Mungu akuponye".
- If the language requested is "en" (English): You MUST respond ONLY in clear, empathetic, polite English.
- NEVER mix languages in the main body unless mentioning official card names like "Hospital Number (KH...)" or "SHA".

Patient Check-in Guidance on the Second Page (Identify / Register):
1. How to identify:
   - First Name & Last Name (Majina yako).
   - Choose one identifier: Phone number (+254), Hospital Card Number (KH100001 from your clinic booklet/receipt), or National ID.
   - If they have visited before: Tap "Check records / Tafuta rekodi".
   - If they are visiting Kijabe for the first time: Tap "I'm new here / Mimi ni mpya" to register their name and phone in 30 seconds.
2. What happens after this step:
   - Step A: Nurse Triage (checking vitals, priority for pregnant mothers, elderly 65+, infants, or severe pain).
   - Step B: Selecting the clinic (General OPD, Paediatrics, Eye, Dental, Surgical, Orthopaedics, etc.).
   - Step C: Choosing Payment (Cash, M-Pesa Paybill 512900, SHA / NHIF, or Insurance).
   - Step D: Your numbered ticket prints! You can scan the QR code with your phone to sit in the shade or cafeteria and watch your queue live.
3. Special situations:
   - Severe pain / Emergency: Direct them to inform the triage nurse immediately or go to Casualty.
   - Lost hospital number: They can enter their phone number or national ID to retrieve it, or tap "I'm new here".
   - No phone number: Staff at Registration Desk 1 or 2 can help them retrieve their physical file.

Tone & Style:
- Warm, reassuring, loving, concise.
- Bulleted or numbered steps (1., 2., 3.).
- Short paragraphs that are easy to read for someone who is sick or standing at a kiosk.`;

export const Route = createFileRoute("/api/ai/kiosk-guide")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const cors = corsHeaders(request);
        try {
          const body = (await request.json().catch(() => ({}))) as {
            message?: string;
            lang?: "en" | "sw";
            step?: string;
            patientName?: string;
          };
          const userQuery = (body.message || "").trim();
          const lang = body.lang === "sw" ? "sw" : "en";
          if (!userQuery) {
            return Response.json(
              { error: "Query is required" },
              { status: 400, headers: cors }
            );
          }

          let replyText: string;
          try {
            const ai = getGenAI();
            const prompt = `Language: ${lang === "sw" ? "KISWAHILI (Reply strictly in Kiswahili)" : "ENGLISH (Reply strictly in English)"}.
Current Kiosk Step: ${body.step || "identify"} (Second page of kiosk: patient identification & check-in).
${body.patientName ? `Patient Name entered: ${body.patientName}` : ""}
Patient question: "${userQuery}"

Provide warm, step-by-step guidance specifically for this patient standing at the kiosk.`;

            const response = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: prompt,
              config: {
                systemInstruction: KIOSK_GUIDE_PROMPT,
              },
            });

            replyText =
              response.text?.trim() ||
              (lang === "sw"
                ? "Karibu AIC Kijabe Hospital. Weka majina yako kisha namba ya simu au kadi ili kuendelea."
                : "Welcome to AIC Kijabe Hospital. Enter your names and phone or hospital card number to proceed.");
          } catch (geminiErr) {
            console.warn("Gemini kiosk call fell back to smart patient guide:", geminiErr);
            replyText = getKioskGuideFallback(userQuery, lang, body.patientName);
          }

          return Response.json(
            { reply: replyText, error: null },
            { headers: cors }
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Kiosk Guide error";
          console.error("Kiosk Guide error:", e);
          return Response.json(
            { reply: getKioskGuideFallback("", "en"), error: null },
            { headers: cors }
          );
        }
      },
    },
  },
});

function getKioskGuideFallback(query: string, lang: "en" | "sw", name?: string): string {
  const q = query.toLowerCase();
  const greeting = name ? (lang === "sw" ? `Hujambo ${name}, ` : `Hello ${name}, `) : "";

  if (/card|kadi|sina kadi|lost|don't have|poteza/i.test(q)) {
    return lang === "sw"
      ? `${greeting}Usijali hata kidogo ikiwa huna kadi yako ya hospitali!
Hapa kuna njia rahisi:
1. Bonyeza kitufe cha 'Simu' hapo juu na uweke namba yako ya simu ya Safaricom/Airtel (mfano: 712345678).
2. Au bonyeza kitufe cha 'Kitambulisho' na uweke namba yako ya Kitambulisho cha Taifa (National ID).
3. Ikiwa hukuwahi kutibiwa Kijabe hapo awali, bonyeza kitufe cha 'Mimi ni Mgeni' ili ufungue faili mpya kwa sekunde 30 tu!`
      : `${greeting}No worries at all if you don't have your hospital card!
Here is how to proceed easily:
1. Tap the 'Phone' button above and type in your 9-digit mobile number (e.g. 712345678).
2. Or tap the 'National ID' button and enter your Kenyan ID number.
3. If this is your very first visit to AIC Kijabe Hospital, tap the 'I'm New' button to register and open your patient file in just 30 seconds!`;
  }

  if (/emergenc|dharura|severe|pain|damu|bleeding|casualty|breathe|shida ya kupumua/i.test(q)) {
    return lang === "sw"
      ? `🚨 TAHADHARI YA HARAKA: Ikiwa wewe au mgonjwa wako ana maumivu makali, anavuja damu, au ana shida kubwa ya kupumua, USISUBIRI foleni ya Kiosk!
Tafadhali nenda moja kwa moja kwenye Idara ya Dharura (Casualty/Emergency) iliyo mita 20 mbele yako. Wafanyakazi wetu watakuhudumia mara moja bila kuchelewa.`
      : `🚨 IMMEDIATE CAUTION: If you or your patient is experiencing severe chest pain, bleeding, or breathing difficulty, DO NOT wait in the regular kiosk queue!
Please walk directly into our 24/7 Casualty / Emergency Department right away. Our clinical emergency team will triage and attend to you immediately.`;
  }

  if (/new|mgeni|first time|mara ya kwanza|sajili|register/i.test(q)) {
    return lang === "sw"
      ? `${greeting}Karibu sana AIC Kijabe Hospital!
Ili kusajiliwa kama mgonjwa mpya:
1. Bonyeza kitufe cheupe cha 'Mimi ni Mgeni' (I'm New) hapo chini.
2. Weka majina yako matatu (Jina la Kwanza, Jina la Kati, na Jina la Ukoo).
3. Weka namba yako ya simu na namba ya kitambulisho (ukipenda).
4. Bonyeza 'Nisajili' na utapata namba yako ya kudumu ya hospitali (mfano: KH100001) na tiketi ya kwanza ya daktari!`
      : `${greeting}A very warm welcome to AIC Kijabe Hospital!
To register as a new patient:
1. Tap the white 'I'm New' button below.
2. Fill in your three names (First Name, Middle Name, Surname).
3. Enter your phone number and optional National ID.
4. Tap 'Register Me' to instantly create your hospital file (e.g. KH100001) and receive your first queue ticket!`;
  }

  if (/mpesa|lipa|pay|pesa|cost|gharama|fee|how much/i.test(q)) {
    return lang === "sw"
      ? `${greeting}Kuhusu malipo hospitalini:
• Kupata tiketi hapa kwenye Kiosk ni BURE kabisa!
• Malipo ya usajili, daktari, maabara au dawa hufanyika kwenye kaunta ya Cashier au kupitia M-Pesa.
• Namba ya Lipa na M-Pesa Paybill ni 512900 (Weka namba yako ya kadi au jina kama Akaunti).
• Ikiwa unatumia SHA au Bima ya Kampuni, dhibitisha kwenye dawati la bima kabla ya kwenda kwa daktari.`
      : `${greeting}Regarding hospital payments:
• Getting your ticket at this Kiosk is completely FREE!
• Consultation, laboratory, and pharmacy fees can be paid at the Cashier counter or conveniently via M-Pesa.
• M-Pesa Paybill is 512900 (Enter your hospital card number or patient name as the Account).
• If using SHA / NHIF or corporate insurance, present your card/ID at the Insurance Desk.`;
  }

  if (/step|next|nifanye nini|what next|baada|procedure/i.test(q)) {
    return lang === "sw"
      ? `${greeting}Hatua za kufuata sasa hivi:
1. Andika majina yako matatu katika masanduku yaliyo juu.
2. Chagua 'Simu' na uandike namba yako ya simu.
3. Bonyeza kitufe kikubwa cha kijani cha 'Tafuta Rekodi Yangu'.
4. Tiketi yako itatoka ikiwa na namba maalum (mf. A-05).
5. Elekea chumba cha Triage (Vipimo vya Shinikizo na Uzito) ambapo muuguzi atakuita kwa jina na namba ya tiketi yako!`
      : `${greeting}Here are your exact steps right now:
1. Enter your three names in the boxes above.
2. Select 'Phone' and enter your 9-digit mobile number.
3. Tap the large green 'Find My Record' button.
4. Your daily queue ticket will be issued with your number (e.g. A-05).
5. Head to the Nurse Triage bay for your vital signs (Blood Pressure & Weight) where the nurse will call your ticket number!`;
  }

  return lang === "sw"
    ? `${greeting}Niko hapa kukusaidia!
Ili uweze kuingia kwenye foleni:
1. Hakikisha umeandika majina yako matatu kwa usahihi.
2. Weka namba yako ya simu ya mkononi au namba ya kadi ya hospitali.
3. Bonyeza 'Tafuta Rekodi Yangu'. Ikiwa ni mara yako ya kwanza kabisa, bonyeza 'Mimi ni Mgeni'.`
    : `${greeting}I am here to guide you every step of the way!
To join today's queue:
1. Ensure your three names are entered accurately above.
2. Enter your mobile phone number or your Kijabe hospital card number.
3. Tap 'Find My Record'. If this is your first time here, simply tap 'I'm New'.`;
}
