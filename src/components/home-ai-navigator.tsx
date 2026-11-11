import { useState, useRef, useEffect } from "react";
import {
  Compass,
  Send,
  Sparkles,
  X,
  MessageSquare,
  Bot,
  User,
  HelpCircle,
  ChevronDown,
} from "lucide-react";

type Message = {
  role: "user" | "model";
  text: string;
};

const SUGGESTED_QUESTIONS = [
  {
    en: "Where do I start as a first-time patient?",
    sw: "Wapi pa kuanzia kama mgonjwa mpya?",
  },
  {
    en: "Which clinic handles bone, knee or back pain?",
    sw: "Kliniki gani inashughulikia maumivu ya mgongo na mifupa?",
  },
  {
    en: "How do I use SHA (NHIF) or insurance here?",
    sw: "Jinsi ya kutumia bima ya SHA (NHIF) au bima binafsi?",
  },
  {
    en: "Can I track my queue number on my phone?",
    sw: "Je, ninaweza kufuata namba yangu ya foleni kwenye simu?",
  },
  {
    en: "What should I do if my child has a high fever?",
    sw: "Nifanye nini mtoto wangu akiwa na homa kali?",
  },
];

export function HomeAiNavigator() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "model",
      text: "👋 Welcome to AIC Kijabe Hospital! Karibu sana.\n\nI am your **Care Flow Digital Navigator**. I can help you find the right clinic, explain how to register and get a ticket, answer questions on SHA/insurance, or guide you step-by-step through our outpatient services.\n\n*How can I help you today? / Ninawezaje kukusaidia leo?*",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeLang, setActiveLang] = useState<"en" | "sw">("en");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (open) {
      scrollToBottom();
    }
  }, [messages, open]);

  const handleSend = async (userText?: string) => {
    const textToSend = (userText || input).trim();
    if (!textToSend || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", text: textToSend }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const history = newMessages.slice(1, -1);
      const res = await fetch("/api/ai/home-navigator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          history,
        }),
      });

      const data = (await res.json()) as { reply?: string; error?: string };
      if (data.reply) {
        setMessages((prev) => [...prev, { role: "model", text: data.reply! }]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: "model",
            text: "Pole sana. I could not connect to the hospital guide right now. Please head to the **Registration Desk** or **Enquiries Window** for direct assistance.",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "model",
          text: "Pole sana, kulikuwa na hitilafu. Tafadhali tembelea dawati la mapokezi (Registration & Enquiries) kwa usaidizi wa haraka.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating Navigator Launcher Button */}
      <div className="fixed bottom-6 left-6 z-40">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="group flex items-center gap-2.5 rounded-full border border-primary/30 bg-card/95 px-4 py-3 text-sm font-semibold text-foreground shadow-xl backdrop-blur transition-all duration-300 hover:scale-105 hover:border-primary hover:bg-card hover:shadow-2xl focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 active:scale-95"
          aria-expanded={open}
        >
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Compass className="h-4 w-4 animate-spin-slow transition-transform group-hover:rotate-45" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="text-left leading-tight">
            <span className="block font-bold text-primary">AI Navigator</span>
            <span className="text-[11px] text-muted-foreground">Ask anything · Uliza hapa</span>
          </div>
        </button>
      </div>

      {/* Embedded Concierge Banner on Page */}
      <section className="relative mx-auto mt-12 max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-r from-primary/10 via-card to-primary/5 p-6 shadow-md backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Hospital Navigator AI · Muongozo wa AI
              </div>
              <h2 className="mt-3 font-display text-2xl font-bold sm:text-3xl text-foreground">
                Need help navigating AIC Kijabe Hospital?
              </h2>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                Ask our interactive AI Navigator about which clinic you need, how to check in at the kiosk, using SHA / insurance, or tracking your queue number on your phone.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.slice(0, 3).map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setOpen(true);
                      handleSend(activeLang === "sw" ? q.sw : q.en);
                    }}
                    className="rounded-full border border-border/80 bg-background/80 px-3.5 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:bg-primary/10 hover:text-primary active:scale-95"
                  >
                    💡 {activeLang === "sw" ? q.sw : q.en}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row lg:flex-col xl:flex-row">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-bold text-primary-foreground shadow-lg transition duration-200 hover:scale-105 hover:bg-primary/90 hover:shadow-xl active:scale-95"
              >
                <MessageSquare className="h-4 w-4" />
                Ask Navigator AI Now
              </button>
              <button
                type="button"
                onClick={() => setActiveLang((l) => (l === "en" ? "sw" : "en"))}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border bg-background px-4 py-3.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
              >
                Lugha: {activeLang === "en" ? "Kiswahili" : "English"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive Chat Window Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-start p-4 sm:p-6 sm:items-end">
          {/* Backdrop on mobile */}
          <div
            className="fixed inset-0 bg-background/60 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
          />

          <div className="relative z-10 flex h-[85vh] max-h-[640px] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-primary/25 bg-card shadow-2xl animate-in fade-in slide-in-from-bottom-6 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border bg-gradient-to-r from-primary/15 via-card to-card px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                  <Compass className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-foreground flex items-center gap-1.5">
                    Care Flow Navigator
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                      Online
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground">AIC Kijabe Hospital Guide · Bilingual</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveLang((l) => (l === "en" ? "sw" : "en"))}
                  className="rounded-lg border border-border/80 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {activeLang === "en" ? "Kiswahili" : "English"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "model" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary mt-1">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-none"
                        : "bg-muted/70 text-foreground border border-border/60 rounded-bl-none shadow-xs"
                    }`}
                  >
                    <div className="whitespace-pre-line">{m.text}</div>
                  </div>
                  {m.role === "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/90 text-primary-foreground mt-1">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-2.5 justify-start">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary mt-1">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-2xl rounded-bl-none border border-border/60 bg-muted/70 px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-primary animate-bounce" />
                      <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0.2s]" />
                      <span className="h-2 w-2 rounded-full bg-primary animate-bounce [animation-delay:0.4s]" />
                      <span className="ml-1 text-xs">Thinking... / Inatafuta majibu...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick questions chips */}
            <div className="border-t border-border/50 bg-background/80 px-4 py-2.5">
              <div className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground mb-1.5">
                <HelpCircle className="h-3 w-3 text-primary" />
                Quick topics:
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSend(activeLang === "sw" ? q.sw : q.en)}
                    disabled={loading}
                    className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
                  >
                    {activeLang === "sw" ? q.sw : q.en}
                  </button>
                ))}
              </div>
            </div>

            {/* Input Bar */}
            <div className="border-t border-border bg-card p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    activeLang === "sw"
                      ? "Uliza swali lolote kuhusu huduma za hospitali..."
                      : "Ask any question about hospital navigation..."
                  }
                  disabled={loading}
                  className="h-11 flex-1 rounded-xl border border-input bg-background px-4 text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow transition hover:bg-primary/90 disabled:opacity-40"
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
