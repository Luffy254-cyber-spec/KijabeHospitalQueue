import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Monitor, Tablet, Stethoscope, ArrowRight, Clock3, QrCode, Users } from "lucide-react";
import { InstallAppButton } from "@/components/install-app-button";
import { KijabeFooter } from "@/components/kijabe-footer";
import { HospitalSupportPills } from "@/components/support-pills";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kijabe Care Flow — Outpatient Ticketing" },
      { name: "description", content: "Check-in kiosk, waiting-room TV display and staff console for AIC Kijabe Hospital outpatients." },
      { property: "og:title", content: "Kijabe Care Flow — Outpatient Ticketing" },
      { property: "og:description", content: "Check-in kiosk, waiting-room TV display and staff console for AIC Kijabe Hospital outpatients." },
    ],
  }),
  component: Index,
});

const slides = [
  {
    to: "/kiosk" as const,
    icon: Tablet,
    eyebrow: "Patients",
    title: "Self check-in kiosk",
    body: "Pick a service, set triage priority, and get a ticket — English & Kiswahili.",
    accent: "from-[#159ed5] to-[#102a43]",
  },
  {
    to: "/display" as const,
    icon: Monitor,
    eyebrow: "Waiting room",
    title: "Live TV display",
    body: "Numbers being called, room directions, and a carousel synced to announcements.",
    accent: "from-[#102a43] to-[#159ed5]",
  },
  {
    to: "/staff" as const,
    icon: Stethoscope,
    eyebrow: "Clinical desks",
    title: "Staff console",
    body: "Call next, recall, transfer, register hospital numbers, and bill at the desk.",
    accent: "from-[#159ed5] via-[#97c3db] to-[#102a43]",
  },
  {
    to: "/kiosk" as const,
    icon: QrCode,
    eyebrow: "On your phone",
    title: "Scan & track your place",
    body: "Every ticket shows a QR code patients can scan to follow the queue live.",
    accent: "from-[#102a43] via-[#159ed5] to-[#97c3db]",
  },
] as const;

const screens = [
  { to: "/kiosk" as const, icon: Tablet, title: "Check-in kiosk", body: "Patients pick a service, payment type and get a numbered ticket. English & Kiswahili." },
  { to: "/display" as const, icon: Monitor, title: "Waiting-room TV", body: "Shows numbers being called, which room to go to, and how many are waiting." },
  { to: "/staff" as const, icon: Stethoscope, title: "Staff console", body: "Call the next patient, recall, transfer to lab or pharmacy, and issue hospital numbers." },
] as const;

const highlights = [
  { icon: Clock3, label: "Shorter waits", text: "Priority triage + care paths keep the line moving." },
  { icon: QrCode, label: "Phone tracking", text: "Scan the ticket QR to watch your place update live." },
  { icon: Users, label: "Whole journey", text: "One ticket from registration through pharmacy." },
] as const;

function Index() {
  const [api, setApi] = useState<CarouselApi>();
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!api) return;
    setSlide(api.selectedScrollSnap());
    const onSelect = () => setSlide(api.selectedScrollSnap());
    api.on("select", onSelect);
    const timer = setInterval(() => api.scrollNext(), 5200);
    return () => {
      api.off("select", onSelect);
      clearInterval(timer);
    };
  }, [api]);

  return (
    <main className="home-atmosphere relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 home-grid opacity-40" aria-hidden />
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/20 blur-3xl home-blob" aria-hidden />
      <div className="pointer-events-none absolute -right-16 bottom-20 h-80 w-80 rounded-full bg-accent/40 blur-3xl home-blob-delay" aria-hidden />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="group flex items-center gap-3">
          <img
            src="/brand/kijabe-logo.png"
            alt="AIC Kijabe Hospital"
            className="h-11 w-auto object-contain transition duration-300 group-hover:scale-105"
          />
          <span className="hidden whitespace-nowrap font-display text-lg font-bold text-foreground sm:inline">
            Kijabe <span className="text-primary">Care Flow</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          {screens.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="rounded-full px-3 py-2 text-sm font-semibold text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
            >
              {s.title.replace("Check-in ", "").replace("Waiting-room ", "").replace(" console", "")}
            </Link>
          ))}
          <InstallAppButton />
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-8">
        <p className="anim-fade-up text-sm font-semibold uppercase tracking-[0.28em] text-primary">
          AIC Kijabe Hospital
        </p>
        <h1 className="hero-title anim-fade-up-delay-1 mt-4 max-w-3xl font-display text-4xl font-extrabold leading-[1.1] text-foreground sm:text-6xl">
          <span className="anim-word">Outpatient</span>{" "}
          <span className="anim-word anim-word-2 hero-gradient-text">queue</span>
          <span className="anim-word anim-word-3">, from the front door to the pharmacy.</span>
        </h1>
        <p className="anim-fade-up-delay-2 mt-5 max-w-2xl text-lg text-muted-foreground">
          One ticket follows each patient through registration, triage, the doctor, billing, lab and pharmacy —
          with live tracking on their phone.
        </p>
        <div className="anim-fade-up-delay-3 mt-8 flex flex-wrap items-center gap-4">
          <InstallAppButton variant="banner" />
          <p className="max-w-xs text-sm text-muted-foreground">
            Install once on any phone, tablet or PC. It opens full-screen like an app and updates itself whenever you are online.
          </p>
        </div>

        <section className="anim-fade-up-delay-3 relative mt-12">
          <Carousel setApi={setApi} opts={{ loop: true, align: "start" }} className="w-full">
            <CarouselContent>
              {slides.map((s) => (
                <CarouselItem key={s.title} className="md:basis-4/5 lg:basis-3/4">
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-[1.75rem] border border-white/20 bg-gradient-to-br p-8 text-white shadow-xl sm:p-12",
                      s.accent,
                    )}
                  >
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.22),transparent_55%)]" />
                    <div className="relative">
                      <s.icon className="h-10 w-10 opacity-90" />
                      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.25em] text-white/75">{s.eyebrow}</p>
                      <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{s.title}</h2>
                      <p className="mt-3 max-w-xl text-base text-white/85 sm:text-lg">{s.body}</p>
                      <Link
                        to={s.to}
                        className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-bold text-[#102a43] transition hover:scale-[1.03] hover:shadow-lg"
                      >
                        Open {s.eyebrow.toLowerCase()} <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="-left-3 border-primary/30 bg-card/90 hover:bg-primary hover:text-primary-foreground sm:-left-5" />
            <CarouselNext className="-right-3 border-primary/30 bg-card/90 hover:bg-primary hover:text-primary-foreground sm:-right-5" />
          </Carousel>
          <div className="mt-5 flex justify-center gap-2">
            {slides.map((s, i) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => api?.scrollTo(i)}
                className={cn(
                  "h-2.5 rounded-full transition-all duration-300",
                  i === slide ? "w-8 bg-primary" : "w-2.5 bg-border hover:bg-primary/50",
                )}
              />
            ))}
          </div>
        </section>

        <section className="mt-16 grid gap-4 sm:grid-cols-3">
          {highlights.map((h, i) => (
            <div
              key={h.label}
              className={cn(
                "group rounded-2xl border bg-card/80 p-5 backdrop-blur transition duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-lg",
                `anim-fade-up-delay-${i + 1}`,
              )}
            >
              <h.icon className="h-7 w-7 text-primary transition duration-300 group-hover:scale-110 group-hover:rotate-3" />
              <h3 className="mt-3 font-display text-xl font-bold">{h.label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{h.text}</p>
            </div>
          ))}
        </section>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {screens.map((s, i) => (
            <Link
              key={s.to}
              to={s.to}
              className={cn(
                "group relative overflow-hidden rounded-2xl border bg-card p-6 transition duration-300 hover:-translate-y-1.5 hover:border-primary hover:shadow-xl",
                `anim-fade-up-delay-${i + 2}`,
              )}
            >
              <div className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-primary transition duration-500 group-hover:scale-x-100" />
              <s.icon className="h-9 w-9 text-primary transition duration-300 group-hover:scale-110" />
              <h2 className="mt-5 text-2xl font-bold transition group-hover:text-primary">{s.title}</h2>
              <p className="mt-2 text-muted-foreground">{s.body}</p>
              <span className="mt-6 inline-flex items-center gap-1 font-semibold text-primary">
                Open <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1.5" />
              </span>
            </Link>
          ))}
        </div>
      </div>

      <HospitalSupportPills />
      <KijabeFooter />
    </main>
  );
}
