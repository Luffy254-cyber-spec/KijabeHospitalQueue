import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  HelpCircle,
  Minimize2,
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

const pillCls =
  "group flex h-14 w-14 items-center justify-start overflow-hidden whitespace-nowrap rounded-full bg-gradient-to-r from-[#0c729c] to-[#60a5fa] text-white shadow-lg transition-all duration-300 ease-in-out hover:w-40 hover:from-[#095475] hover:to-[#3b82f6] focus-visible:w-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 active:scale-95";
const iconCls = "flex h-14 w-14 flex-shrink-0 items-center justify-center";
const labelCls =
  "pr-4 text-sm font-semibold opacity-0 transition-opacity delay-100 duration-200 group-hover:opacity-100 group-focus-visible:opacity-100";

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
          text: "Temporary network interruption. Please ask any of our triage nurses or customer service staff nearby for guidance.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Collapsable Blue Launcher Button positioned directly ABOVE the Feedback button (bottom-24 left-6) */}
      <div className="fixed bottom-24 left-6 z-40 max-sm:bottom-20 max-sm:left-4">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          title="AIC Kijabe AI Navigator"
          aria-label="AIC Kijabe AI Navigator"
          className={pillCls}
        >
          <span className={iconCls}>
            <Sparkles className="h-5 w-5" />
          </span>
          <span className={labelCls}>AI Navigator</span>
        </button>
      </div>

      {/* Floating Collapsible AI Chat Window */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-start p-3 sm:p-6 sm:left-6 sm:bottom-20 pointer-events-none">
          <div className="pointer-events-auto flex flex-col h-[85vh] max-h-[640px] w-full sm:w-[420px] rounded-3xl border border-primary/20 bg-card shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/80 bg-gradient-to-r from-[#0c729c] to-[#60a5fa] px-4 py-3.5 text-white">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 backdrop-blur">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold leading-tight">AIC Kijabe AI Navigator</h3>
                  <p className="text-[11px] text-white/80 leading-tight">
                    Care Flow Guide · English & Swahili
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveLang((l) => (l === "en" ? "sw" : "en"))}
                  className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-white/30 transition"
                  title="Switch Language"
                >
                  {activeLang === "en" ? "Swahili" : "English"}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition"
                  aria-label="Close"
                  title="Close"
                >
                  <Minimize2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-background/50">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "model" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1">
                      <Bot className="h-4 w-4" />
                    </div>
                  )}
                  <div
                    className={`max-w-[84%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-xs ${
                      m.role === "user"
                        ? "rounded-br-none bg-primary text-primary-foreground font-medium"
                        : "rounded-bl-none border border-border bg-card text-foreground"
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
                      <span className="ml-1 text-xs">
                        {activeLang === "sw" ? "Inatafuta majibu..." : "Searching guidance..."}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick questions chips */}
            <div className="border-t border-border/50 bg-background/80 px-3.5 py-2">
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
                    className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition disabled:opacity-50"
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
                      ? "Uliza swali kuhusu huduma za hospitali..."
                      : "Ask any question about hospital navigation..."
                  }
                  disabled={loading}
                  className="h-10 flex-1 rounded-xl border border-input bg-background px-3.5 text-xs sm:text-sm outline-none transition focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || loading}
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
