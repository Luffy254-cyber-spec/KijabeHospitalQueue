import { createFileRoute } from "@tanstack/react-router";
import { getGenAI } from "@/lib/gemini-client.server";
import { corsHeaders } from "@/lib/http-security";

const SYSTEM_INSTRUCTION = `You are the AIC Kijabe Hospital Care Flow Digital Navigator.
Your role is to help patients, family members, visitors, and hospital staff navigate AIC Kijabe Hospital's outpatient services, clinics, queue tracking, and check-in procedures.

Hospital Motto & Location:
"Health & Healing in Jesus' Name" — AIC Kijabe Hospital, Kijabe, Kiambu/Nakuru boundary, Kenya.

Available Outpatient Clinics & Departments:
1. Emergency / Casualty (24/7): Severe trauma, acute bleeding, breathing difficulty, chest pain, unconsciousness.
2. Registration & Records: File opening, hospital card/number issuance (e.g. KH100001), national ID check.
3. Nurse Triage: Vital signs (BP, temperature, weight, pulse) and urgency triaging (Red = Emergency, Orange = Priority: pregnant mothers, infants, elderly 65+, disability, severe distress, Green = Standard).
4. Doctor Consultation (General OPD Rooms 1-12): General medical conditions.
5. Specialty Clinics:
   - Paediatrics Clinic: Children & infants.
   - Maternity / ANC & Gynaecology: Expectant mothers, prenatal & postnatal care.
   - Surgical Clinic: Consultations, pre-op, post-op reviews.
   - Orthopaedic Clinic: Fractures, bones, spine, joint pain.
   - Eye Clinic: Vision, cataracts, eye infections.
   - Dental Clinic: Teeth cleaning, extractions, fillings, toothache.
   - ENT Clinic: Ear infections, hearing, nose and throat ailments.
   - Medical & Diabetes Clinic: Hypertension, diabetes management, chronic care.
   - Neurosurgery (CURE partnership): Spina bifida, hydrocephalus, neurological conditions.
   - Physiotherapy: Physical rehabilitation, mobility therapy.
   - Inpatient Admission Desk: Hospital ward admission.
6. Diagnostic Services:
   - Laboratory: Blood tests, urine, stool, culture samples.
   - Radiology & Imaging: Digital X-Ray, Ultrasound, CT scans.
7. Outpatient Pharmacy: Prescription dispensing, dosage counseling.
8. Payment & Insurance Desks:
   - Cashier: Cash and M-Pesa (Paybill 512900).
   - SHA Desk: Social Health Authority / NHIF approvals and claims.
   - Corporate Insurance Desk: Jubilee, Britam, CIC, AAR, Madison, First Assurance, etc.
9. Queue & Ticketing:
   - Self check-in kiosk: Touch-screen check-in in English or Kiswahili.
   - Phone QR tracking: Scan the ticket's QR code on any smartphone to watch queue progress live from the cafeteria, gazebo, or chapel.
   - Live TV displays: Show called tokens, department rooms, and announce numbers in English and Swahili.

Rules:
- Give clear, concise, step-by-step guidance.
- If asked where to go for symptoms, recommend the most appropriate department/clinic and mention whether they should start at Emergency or Triage.
- Always include an urgent caution if symptoms sound life-threatening (e.g., chest pain, heavy bleeding, difficulty breathing -> go straight to Casualty / Emergency).
- Language: Reply in the same language as the user (English or Kiswahili). If the user writes in English, reply in English. If in Kiswahili, reply in warm, natural Swahili.
- Keep responses friendly, encouraging, well-structured, and easy to read.`;

export const Route = createFileRoute("/api/ai/home-navigator")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) =>
        new Response(null, { status: 204, headers: corsHeaders(request) }),
      POST: async ({ request }) => {
        const cors = corsHeaders(request);
        try {
          const body = (await request.json().catch(() => ({}))) as {
            message?: string;
            history?: Array<{ role: "user" | "model"; text: string }>;
          };
          const userMessage = (body.message || "").trim();
          if (!userMessage) {
            return Response.json(
              { error: "Message is required" },
              { status: 400, headers: cors }
            );
          }

          let replyText: string;
          try {
            const ai = getGenAI();
            const formattedContents: Array<{
              role: string;
              parts: Array<{ text: string }>;
            }> = [];

            if (Array.isArray(body.history)) {
              for (const h of body.history.slice(-6)) {
                if (h.text && (h.role === "user" || h.role === "model")) {
                  formattedContents.push({
                    role: h.role,
                    parts: [{ text: h.text }],
                  });
                }
              }
            }

            formattedContents.push({
              role: "user",
              parts: [{ text: userMessage }],
            });

            const response = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: formattedContents,
              config: {
                systemInstruction: SYSTEM_INSTRUCTION,
              },
            });

            replyText =
              response.text?.trim() ||
              "Karibu AIC Kijabe Hospital. How may I assist you with navigating our outpatient services today?";
          } catch (geminiError) {
            console.warn("Gemini call fell back to smart navigator:", geminiError);
            replyText = getHomeNavigatorFallback(userMessage);
          }

          return Response.json(
            { reply: replyText, error: null },
            { headers: cors }
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : "AI Navigator error";
          console.error("Home Navigator error:", e);
          return Response.json(
            { reply: getHomeNavigatorFallback(""), error: null },
            { headers: cors }
          );
        }
      },
    },
  },
});

function getHomeNavigatorFallback(query: string): string {
  const q = query.toLowerCase();
  const isSwahili = /\b(wapi|jinsi|habari|homa|meno|kichwa|kadi|simu|pesa|bima|daktari|dharura|mtoto|mjamzito|asante|chumba|idara|tiketi)\b/i.test(q);

  if (/emergenc|casualty|dharura|ajali|damu|bleeding|chest pain|unconscious|breathe|kupumua/i.test(q)) {
    return isSwahili
      ? "🚨 DHARURA YA HARAKA: Kama mgonjwa ana matatizo ya kupumua, anavuja damu nyingi, ana maumivu makali ya kifua, au amepoteza fahamu, tafadhali nenda moja kwa moja kwenye Idara ya Dharura (Casualty/Emergency) mara moja! Idara iko wazi masaa 24/7 na madaktari watakusaidia papo hapo bila kuchelewa."
      : "🚨 IMMEDIATE EMERGENCY: If the patient is bleeding heavily, having chest pain, severe difficulty breathing, or loss of consciousness, please proceed DIRECTLY to the Casualty / Emergency Department immediately! It operates 24/7 and triage staff will attend to you right away.";
  }

  if (/ticket|tiketi|kiosk|pata|queue|foleni|check in|register|sajili/i.test(q)) {
    return isSwahili
      ? "Ili kupata tiketi ya foleni:\n1. Nenda kwenye mashine ya Kiosk au bonyeza kitufe cha 'Kiosk' hapa kwenye mfumo.\n2. Chagua lugha (Kiswahili au English).\n3. Weka majina yako matatu na namba ya simu au namba ya kadi ya hospitali.\n4. Mfumo utakupa namba yako ya tiketi (mfano: A-01 au B-12).\n5. Unaweza kuskani msimbo wa QR kwa simu yako ili kufuatilia foleni ukiwa mgahawani au kanisani!"
      : "To get a queue ticket:\n1. Head to the Self-Check-in Kiosk or click 'Kiosk' on this portal.\n2. Select your preferred language (English or Kiswahili).\n3. Enter your 3 names and phone number or hospital card number.\n4. You will receive your daily ticket (e.g. A-01, B-04).\n5. Scan the QR code on your ticket using your mobile phone to monitor your turn in real time from the cafeteria or waiting bays!";
  }

  if (/tooth|dental|meno|kung'oa|jino/i.test(q)) {
    return isSwahili
      ? "Kwa matatizo ya meno (Dental Clinic):\n1. Pata tiketi ya huduma kwenye Kiosk na upitie Triage kwa vipimo vya msingi (shinikizo la damu na mapigo ya moyo).\n2. Elekea Kliniki ya Meno (Dental Clinic) iliyopo ghorofa ya kwanza.\n3. Huduma ni pamoja na kung'oa, kusafisha, kuziba meno, na uchunguzi wa maumivu."
      : "For dental care (Dental Clinic):\n1. Check in at the Kiosk to get your ticket and proceed through Nurse Triage for vitals.\n2. Head to the Dental Clinic on the 1st Floor.\n3. Services include tooth extractions, cleaning, cavity fillings, and oral pain treatment.";
  }

  if (/eye|macho|vision|miwani|cataract/i.test(q)) {
    return isSwahili
      ? "Kwa matatizo ya macho (Eye Clinic):\n1. Baada ya kupokea tiketi yako na kupimwa Triage, elekea Idara ya Macho (Eye Unit).\n2. Madaktari hutoa huduma za kupima uoni, miwani, matibabu ya mtoto wa jicho (cataracts), na maambukizi ya macho."
      : "For eye care (Eye Clinic):\n1. After getting your ticket and completing Nurse Triage, proceed to the Eye Unit.\n2. Services include vision screening, prescription glasses, cataract evaluation, and treatment of eye infections.";
  }

  if (/bone|fracture|orthop|mguu|mkono|kuvunjika|viungo|joint/i.test(q)) {
    return isSwahili
      ? "Kwa matatizo ya mifupa na viungo (Orthopaedic Clinic):\n1. Baada ya Triage, elekea Kliniki ya Mifupa (Orthopaedic OPD).\n2. Ikiwa unahitaji picha ya X-Ray, utapelekwa Idara ya Radiology (X-Ray / CT Scan) kabla ya daktari kuweka POP au kutoa mpango wa matibabu."
      : "For bone and joint issues (Orthopaedic Clinic):\n1. After Nurse Triage, head to the Orthopaedic OPD.\n2. If imaging is needed, you will be directed to the Radiology Department for Digital X-Ray or CT scan before doctor review.";
  }

  if (/child|baby|infant|pediatric|paediatric|mtoto|watoto/i.test(q)) {
    return isSwahili
      ? "Kliniki ya Watoto (Paediatrics Clinic):\nWatoto wote na watoto wachanga hupewa kipaumbele (Priority Queue). Baada ya Triage, elekea Paediatrics OPD. Daktari wa watoto atamhudumia mtoto haraka."
      : "Paediatrics Clinic:\nInfants and young children receive priority queueing. After Nurse Triage vitals, proceed to the Paediatrics Clinic where specialized pediatric clinicians provide dedicated care.";
  }

  if (/pregnant|maternity|anc|clinic ya wajawazito|mimba|gynaecol|kujifungua/i.test(q)) {
    return isSwahili
      ? "Kliniki ya Wajawazito na Wanawake (Maternity & ANC / Gynaecology):\nKina mama wajawazito hupewa kipaumbele cha foleni (Priority Queue). Elekea kliniki ya ANC kwenye jengo la akina mama baada ya kupata tiketi."
      : "Maternity & Antenatal Care (ANC / Gynaecology):\nExpectant mothers receive priority queue routing. After checking in, proceed to the ANC Clinic in the Mother & Child wing for prenatal check-ups, ultrasound, or gynaecological consultation.";
  }

  if (/pay|mpesa|lipa|pesa|cost|fee|cash|bima|sha|nhif|insurance/i.test(q)) {
    return isSwahili
      ? "Malipo na Bima AIC Kijabe Hospital:\n• M-Pesa Paybill: Namba ya Biashara ni 512900 (Weka namba yako ya kadi au jina kama namba ya akaunti).\n• Bima ya SHA / NHIF: Nenda kwenye Dawati la SHA ukiwa na Kitambulisho cha Taifa na namba yako ya SHA.\n• Bima za Makampuni: Madawati ya Jubilee, Britam, CIC, AAR, na Madison yapo karibu na kaunta kuu ya malipo."
      : "Payments & Insurance at AIC Kijabe Hospital:\n• M-Pesa Paybill: Business Number 512900 (Use your hospital card number or patient name as Account Number).\n• SHA / NHIF: Visit the SHA Desk with your National ID card for verification and claim processing.\n• Corporate Insurance: Desks for Jubilee, Britam, CIC, AAR, First Assurance, Madison, etc. are located next to Cashier.";
  }

  if (/display|tv|screen|skrini|tazama/i.test(q)) {
    return isSwahili
      ? "Skrini za TV za Foleni (Live Display):\nSkrini zimewekwa katika vyumba vya kusubiri, mgahawani, na korido. Zinaonyesha namba ya tiketi inayohudumiwa na namba ya chumba cha daktari, pamoja na sauti ya tangazo kwa Kiswahili na Kiingereza."
      : "Live Queue TV Displays:\nScreens are located throughout outpatient waiting bays, corridors, and dining areas. They display currently called tokens, the serving room number, and broadcast audio chimes with bilingual announcements.";
  }

  return isSwahili
    ? "Karibu AIC Kijabe Hospital! 'Afya na Uponyaji kwa Jina la Yesu'.\n\nIli kukusaidia:\n• Kupata tiketi: Bonyeza 'Kiosk' kwenye menyu ya juu.\n• Kufuatilia foleni yako: Bonyeza 'Track Ticket' na uweke namba ya simu au skani msimbo wa QR.\n• Malipo ya M-Pesa: Paybill 512900.\n• Dharura yoyote: Idara ya Casualty iko wazi masaa 24/7.\nUnaweza kuniuliza kuhusu kliniki maalum (Meno, Macho, Mifupa, Watoto, n.k.) au taratibu za hospitali!"
    : "Welcome to AIC Kijabe Hospital — 'Health & Healing in Jesus' Name'.\n\nQuick Assistance:\n• Get a Queue Ticket: Click 'Kiosk' in the navigation bar.\n• Track Your Status: Click 'Track Ticket' to enter your phone number or scan your ticket's QR code.\n• Payment: M-Pesa Paybill 512900 or visit the Cashier / SHA desk.\n• Emergencies: Casualty / Emergency Department is open 24/7.\nFeel free to ask me about any specific clinic (Dental, Eye, Orthopaedics, Paediatrics, Maternity, etc.) or hospital procedures!";
}
