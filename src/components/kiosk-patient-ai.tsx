import { useState } from "react";
import {
  Sparkles,
  Bot,
  Volume2,
  Send,
  Loader2,
  CheckCircle2,
  X,
  Minimize2,
  AlertTriangle,
} from "lucide-react";
import type { Lang } from "@/lib/i18n";

type Props = {
  lang: Lang;
  patientName?: string;
  step?: string;
  onSelectAction?: (action: "new" | "focus_phone" | "focus_card" | "emergency") => void;
};

const KIOSK_PROMPTS = {
  en: [
    { label: "I don't have a hospital number / card", query: "I don't know my hospital number or lost my card. What should I do?" },
    { label: "What are the steps after this?", query: "What are the steps after I enter my name and check in?" },
    { label: "I have severe pain or emergency", query: "I have severe pain or an emergency condition right now." },
    { label: "I am pregnant / elderly / with baby", query: "I am pregnant or elderly or have a baby. How do I get priority care?" },
    { label: "How does payment & M-Pesa work?", query: "Can I use M-Pesa, Cash, or SHA/NHIF for my visit today?" },
  ],
  sw: [
    { label: "Sina namba au kadi ya hospitali", query: "Sina namba yangu ya hospitali wala kadi. Nifanye nini?" },
    { label: "Ni hatua zipi zitafuata sasa?", query: "Ni hatua gani zitafuata baada ya kuweka jina langu hapa?" },
    { label: "Nina maumivu makali au dharura", query: "Nina maumivu makali au shida ya dharura sasa hivi." },
    { label: "Mimi ni mjamzito / mtoto / mzee", query: "Mimi ni mjamzito au mzee au nina mtoto. Nitapewa kipaumbele vipi?" },
    { label: "Malipo ya M-Pesa na bima ya SHA", query: "Je, ninaweza kulipa kwa M-Pesa, Pesa taslimu au kutumia SHA/NHIF leo?" },
  ],
};

const pillCls =
  "group flex h-14 w-14 items-center justify-start overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-r from-[#0c729c] to-[#60a5fa] text-white shadow-lg transition-all duration-300 ease-in-out hover:w-48 hover:from-[#095475] hover:to-[#3b82f6] focus-visible:w-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-95";
const iconCls = "flex h-14 w-14 flex-shrink-0 items-center justify-center";
const labelCls =
  "pr-4 text-sm font-semibold opacity-0 transition-opacity delay-100 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100";

export function KioskPatientAi({ lang, patientName, step = "identify", onSelectAction }: Props) {
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
    setReply(null);

    try {
      const res = await fetch("/api/ai/kiosk-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          lang,
          step,
          patientName,
        }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };
      if (data.reply) {
        setReply(data.reply);
      } else {
        setReply(
          isSwahili
            ? "Tafadhali bonyeza kitufe cha 'Mimi ni Mgeni' kusajiliwa haraka, au tembelea Dawati la Mapokezi karibu nawe."
            : "Please tap 'I'm New' to register quickly, or visit the nearby Registration Desk for assistance."
        );
      }
    } catch {
      setReply(
        isSwahili
          ? "Kuna tatizo la mtandao kwa sasa. Tafadhali bonyeza 'Mimi ni Mgeni' au uliza mhudumu wa mapokezi."
          : "Temporary connection issue. Please tap 'I'm New' or speak to the reception staff nearby."
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
    <>
      {/* Collapsable Blue Launcher Button positioned directly ABOVE the Hope Music Icon (bottom-20 right-3 sm:bottom-24 sm:right-4) */}
      <div className="fixed bottom-20 right-3 z-40 sm:bottom-24 sm:right-4">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title={isSwahili ? "Msaidizi wa AI Kiosk" : "Kiosk Patient AI Guide"}
          aria-label={isSwahili ? "Msaidizi wa AI Kiosk" : "Kiosk Patient AI Guide"}
          className={pillCls}
        >
          <span className={iconCls}>
            <Bot className="h-5 w-5" />
          </span>
          <span className={labelCls}>
            {isSwahili ? "Msaidizi wa AI" : "AI Patient Guide"}
          </span>
        </button>
      </div>

      {/* Collapsible Kiosk Patient Guide Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end p-3 sm:p-6 sm:right-4 sm:bottom-20 pointer-events-none">
          <div className="pointer-events-auto flex flex-col h-[85vh] max-h-[640px] w-full sm:w-[440px] rounded-3xl border border-primary/20 bg-card shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/80 bg-gradient-to-r from-[#0c729c] to-[#60a5fa] px-4 py-3.5 text-white">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold leading-tight">
                    {isSwahili ? "Msaidizi wa Wagonjwa (AI)" : "Patient AI Guide"}
                  </h3>
                  <p className="text-[11px] text-white/80 leading-tight">
                    {isSwahili ? "Kijabe Outpatient · Hatua kwa Hatua" : "Kijabe Outpatient · Step-by-Step"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white">
                  {isSwahili ? "Kiswahili" : "English"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (speaking && typeof window !== "undefined") window.speechSynthesis.cancel();
                    setSpeaking(false);
                    setOpen(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition"
                  aria-label="Close"
                  title="Close"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background/50">
              {patientName && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary font-medium">
                  {isSwahili ? `Mgonjwa: ${patientName}` : `Patient: ${patientName}`}
                </div>
              )}

              {/* Quick Prompts Chips */}
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {isSwahili ? "Maswali ya Haraka ya Wagonjwa:" : "Common Patient Questions:"}
                </p>
                <div className="grid gap-1.5">
                  {prompts.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => askAssistant(p.query)}
                      disabled={loading}
                      className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition hover:border-primary hover:bg-primary/5 active:scale-98 disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
                        {p.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Assistant Answer Box */}
              {loading && (
                <div className="flex items-center justify-center gap-2 rounded-2xl bg-muted/60 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span>
                    {isSwahili
                      ? "Msaidizi anatafuta maelezo ya kukusaidia..."
                      : "Patient Guide is preparing your guidance..."}
                  </span>
                </div>
              )}

              {reply && !loading && (
                <div className="relative rounded-2xl border border-primary/25 bg-card p-4 text-xs sm:text-sm leading-relaxed text-foreground shadow-xs animate-in fade-in duration-200">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2 mb-2.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {isSwahili ? "Mwongozo Wako" : "Your Guidance"}
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

                  <div className="whitespace-pre-line leading-relaxed font-normal">
                    {reply}
                  </div>

                  {/* Contextual Action Shortcuts */}
                  {onSelectAction && (
                    <div className="mt-3.5 flex flex-wrap gap-1.5 border-t border-border/40 pt-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAction("new");
                          setOpen(false);
                        }}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary hover:text-primary-foreground transition"
                      >
                        {isSwahili ? "→ Mimi ni Mgeni" : "→ Register as New"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAction("focus_phone");
                          setOpen(false);
                        }}
                        className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-foreground hover:border-primary transition"
                      >
                        {isSwahili ? "→ Tumia Simu" : "→ Use Phone"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectAction("emergency");
                          setOpen(false);
                        }}
                        className="flex items-center gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
                      >
                        <AlertTriangle className="h-3 w-3" />
                        {isSwahili ? "Dharura / Casualty" : "Emergency / Casualty"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input Bar */}
            <div className="border-t border-border bg-card p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (query.trim()) {
                    askAssistant(query);
                    setQuery("");
                  }
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    isSwahili
                      ? "Andika swali lako la hospitali hapa..."
                      : "Type your question about kiosk or visit..."
                  }
                  disabled={loading}
                  className="h-10 flex-1 rounded-xl border border-input bg-background px-3.5 text-xs sm:text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || loading}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow transition hover:bg-primary/90 disabled:opacity-40"
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
