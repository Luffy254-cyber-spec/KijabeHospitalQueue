import { useState } from "react";
import {
  Sparkles,
  HeartHandshake,
  Volume2,
  ChevronDown,
  ChevronUp,
  Send,
  Loader2,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import type { Lang } from "@/lib/i18n";

type Props = {
  lang: Lang;
  patientName?: string;
  onSelectAction?: (action: "new" | "focus_phone" | "focus_card") => void;
};

const KIOSK_PROMPTS = {
  en: [
    { label: "I don't have a hospital number", query: "I don't know my hospital number or lost my card. What should I do?" },
    { label: "What happens after this step?", query: "What are the steps after I enter my name and check in?" },
    { label: "I am pregnant / with infant / elderly", query: "I am pregnant or elderly or have a baby. How do I get priority care?" },
    { label: "How does payment & SHA work?", query: "Can I use M-Pesa, Cash, or SHA/NHIF for my visit today?" },
  ],
  sw: [
    { label: "Sina namba au kadi ya hospitali", query: "Sina namba yangu ya hospitali wala kadi. Nifanye nini?" },
    { label: "Ni hatua zipi zitafuata?", query: "Ni hatua gani zitafuata baada ya kuweka jina langu hapa?" },
    { label: "Mimi ni mjamzito / mtoto / mzee", query: "Mimi ni mjamzito au mzee au nina mtoto. Nitapewa kipaumbele vipi?" },
    { label: "Malipo na bima ya SHA inafanyaje?", query: "Je, ninaweza kulipa kwa M-Pesa, Pesa taslimu au kutumia SHA/NHIF leo?" },
  ],
};

export function KioskPatientAi({ lang, patientName, onSelectAction }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const isSwahili = lang === "sw";
  const prompts = isSwahili ? KIOSK_PROMPTS.sw : KIOSK_PROMPTS.en;

  const askAssistant = async (questionText: string) => {
    const q = questionText.trim();
    if (!q || loading) return;

    setLoading(true);
    setOpen(true);
    try {
      const res = await fetch("/api/ai/kiosk-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          lang,
          step: "identify",
          patientName,
        }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };
      if (data.reply) {
        setReply(data.reply);
      } else {
        setReply(
          isSwahili
            ? "Tafadhali bonyeza kitufe cha 'Mimi ni mpya' kusajiliwa haraka, au tembelea Dawati la Mapokezi karibu nawe."
            : "Please tap 'I'm new here' to register quickly, or visit the nearby Registration Desk for assistance."
        );
      }
    } catch {
      setReply(
        isSwahili
          ? "Kuna tatizo la mtandao kwa sasa. Tafadhali bonyeza 'Mimi ni mpya' au uliza mhudumu wa mapokezi."
          : "Temporary connection issue. Please tap 'I'm new here' or speak to the reception staff nearby."
      );
    } finally {
      setLoading(false);
    }
  };

  const speakText = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (speaking) {
      setSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = isSwahili ? "sw-KE" : "en-KE";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="mt-6 w-full rounded-3xl border-2 border-primary/30 bg-gradient-to-br from-primary/5 via-card to-background p-4 shadow-sm transition-all sm:p-5">
      {/* Header bar of the assistant */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <HeartHandshake className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-bold text-foreground">
                {isSwahili ? "Msaidizi wa Kiosk (AI Guide)" : "Kiosk Patient Guide (AI)"}
              </h3>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-bold text-primary">
                {isSwahili ? "Kiswahili" : "English"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {isSwahili
                ? "Mwongozo wa hatua kwa hatua kwa wagonjwa na wageni"
                : "Step-by-step guidance for patients and visitors"}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-bold text-foreground transition hover:border-primary hover:text-primary active:scale-95"
        >
          {open ? (
            <>
              {isSwahili ? "Funga" : "Close"}
              <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              {isSwahili ? "Msaada" : "Need Help?"}
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      {/* Quick Prompts Carousel / Pills */}
      <div className="mt-3.5 flex flex-wrap gap-2">
        {prompts.map((p, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => askAssistant(p.query)}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-xl border border-primary/20 bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition hover:border-primary hover:bg-primary/10 hover:text-primary active:scale-95 disabled:opacity-50"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            {p.label}
          </button>
        ))}
      </div>

      {/* Expanded Assistant Drawer */}
      {open && (
        <div className="mt-4 border-t border-border/70 pt-4 animate-in fade-in duration-200">
          {loading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span>
                {isSwahili
                  ? "Msaidizi anatafuta maelezo ya kukusaidia..."
                  : "Patient Guide is preparing your answer..."}
              </span>
            </div>
          ) : reply ? (
            <div className="relative rounded-2xl border border-primary/25 bg-card p-4 text-sm leading-relaxed text-foreground shadow-xs sm:p-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2 mb-3">
                <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                  <CheckCircle2 className="h-4 w-4" />
                  {isSwahili ? "Maelekezo ya Hatua kwa Hatua" : "Step-by-step Guidance"}
                </span>
                <button
                  type="button"
                  onClick={() => speakText(reply)}
                  className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                    speaking
                      ? "bg-primary text-primary-foreground animate-pulse"
                      : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                  title={isSwahili ? "Soma kwa sauti" : "Read aloud"}
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  {speaking ? (isSwahili ? "Inasoma..." : "Speaking...") : isSwahili ? "Sikiliza" : "Listen"}
                </button>
              </div>

              <div className="whitespace-pre-line text-sm sm:text-base font-normal">
                {reply}
              </div>

              {/* Action shortcuts */}
              <div className="mt-4 flex flex-wrap gap-2 pt-2 border-t border-border/40">
                <button
                  type="button"
                  onClick={() => onSelectAction?.("new")}
                  className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition"
                >
                  👉 {isSwahili ? "Jisajili kama mgonjwa mpya" : "Register as new patient"}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectAction?.("focus_phone")}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
                >
                  📱 {isSwahili ? "Tumia namba ya simu" : "Use phone number"}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectAction?.("focus_card")}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition"
                >
                  💳 {isSwahili ? "Tumia kadi ya hospitali" : "Use hospital card"}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground py-2">
              {isSwahili
                ? "Gusa mojawapo ya maswali hapo juu au andika swali lako kupata maelekezo ya moja kwa moja."
                : "Tap one of the topics above or type a question to get instant step-by-step guidance."}
            </p>
          )}

          {/* Custom query input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              askAssistant(query);
            }}
            className="mt-3 flex items-center gap-2"
          >
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isSwahili
                  ? "Andika swali lako hapa (mf. Ni wapi pa kwenda kwa maumivu ya meno?)..."
                  : "Ask a specific question (e.g. Where do I go for dental checkup?)..."
              }
              className="h-11 flex-1 rounded-xl border border-input bg-card px-4 text-xs sm:text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow transition hover:bg-primary/90 disabled:opacity-40"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
