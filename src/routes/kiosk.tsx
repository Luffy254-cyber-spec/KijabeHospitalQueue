import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { ArrowLeft, Delete, Printer, UserCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { t, type Lang, type Key } from "@/lib/i18n";
import { isLocalHostOrigin, publicAppOrigin, ticketTrackUrl } from "@/lib/public-url";
import { capitalizeName } from "@/lib/names";

export const Route = createFileRoute("/kiosk")({
  head: () => ({
    meta: [
      { title: "Check-in Kiosk — Kijabe Hospital" },
      { name: "description", content: "Self check-in kiosk for outpatients at AIC Kijabe Hospital." },
      { property: "og:title", content: "Check-in Kiosk — Kijabe Hospital" },
      { property: "og:description", content: "Self check-in kiosk for outpatients at AIC Kijabe Hospital." },
    ],
  }),
  component: Kiosk,
});

type Service = { code: string; name_en: string; name_sw: string; description_en: string; description_sw: string; category: string };
type PathStep = { en: string; sw: string };
type Issued = { id: string; token: string; ahead: number; est_minutes: number; service_en: string; service_sw: string; created_at: string; triage: string; path: PathStep[]; card_no: string | null };
type Patient = {
  patient_id: string; card_no: string | null;
  first_name: string; last_name?: string | null; surname?: string | null;
  last_visit_at?: string | null; last_service?: string | null; returning: boolean;
};
type Kind = "phone" | "card" | "national_id";
type Step = "lang" | "identify" | "register" | "welcome" | "visit" | "appointment" | "triage" | "bleeding" | "service" | "payment" | "pay_detail" | "verify" | "ticket";
type PayMethod = "cash" | "card" | "insurance" | "sha";
type Insurer = { id: string; name: string; code: string | null };

const CARD_BRANDS = ["Visa", "Mastercard", "American Express", "Verve", "UnionPay", "Other bank card"] as const;

const RED_REASONS = [
  { en: "Severe pain", sw: "Maumivu makali" },
  { en: "Unconscious / fainting / fits", sw: "Kupoteza fahamu / kuzimia / degedege" },
  { en: "Difficulty breathing / chest pain", sw: "Shida ya kupumua / maumivu ya kifua" },
];
const ORANGE_REASONS = [
  { en: "Elderly (65+)", sw: "Mzee (65+)" },
  { en: "Pregnant", sw: "Mjamzito" },
  { en: "Disability", sw: "Ulemavu" },
  { en: "Mother with infant", sw: "Mama na mtoto mchanga" },
];

function Kiosk() {
  const [step, setStep] = useState<Step>("lang");
  const [lang, setLang] = useState<Lang>("en");
  const B = (en: string, sw: string) => (lang === "sw" ? sw : en);
  const L = (k: Key) => t(k, lang);
  const [services, setServices] = useState<Service[]>([]);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [surname, setSurname] = useState("");
  const [kind, setKind] = useState<Kind>("phone");
  const [idValue, setIdValue] = useState("");
  const [phone, setPhone] = useState("");
  const [nid, setNid] = useState("");
  const namesOk = firstName.trim().length >= 2;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [visit, setVisit] = useState("walk_in");
  const [apptService, setApptService] = useState("");
  const [apptTime, setApptTime] = useState("");
  const [triage, setTriage] = useState<"red" | "orange" | "green">("green");
  const [reasons, setReasons] = useState<string[]>([]);
  const [bleed, setBleed] = useState({ where: "", cause: "", amount: "" });
  const [service, setService] = useState("");
  const [payMethod, setPayMethod] = useState<PayMethod | "">("");
  const [cardBrand, setCardBrand] = useState("");
  const [insurerId, setInsurerId] = useState("");
  const [insurers, setInsurers] = useState<Insurer[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<Issued | null>(null);
  const [trackBase, setTrackBase] = useState(() => publicAppOrigin());

  useEffect(() => {
    supabase.from("services").select("code,name_en,name_sw,description_en,description_sw,category").eq("kiosk_visible", true).order("sort")
      .then(({ data }) => setServices((data ?? []) as Service[]));
    supabase.rpc("list_insurance_providers").then(({ data }) => setInsurers((data as unknown as Insurer[]) ?? []));
  }, []);

  useEffect(() => {
    if (!isLocalHostOrigin(publicAppOrigin())) return;
    fetch("/api/public/app-origin")
      .then((r) => r.json())
      .then((j: { origin?: string }) => { if (j.origin) setTrackBase(j.origin.replace(/\/$/, "")); })
      .catch(() => undefined);
  }, []);

  const reset = () => {
    setStep("lang"); setFirstName(""); setLastName(""); setSurname(""); setIdValue(""); setPhone(""); setNid(""); setPatient(null); setTicket(null);
    setService(""); setReasons([]); setTriage("green"); setBleed({ where: "", cause: "", amount: "" }); setApptService(""); setApptTime("");
    setPayMethod(""); setCardBrand(""); setInsurerId("");
  };
  useEffect(() => {
    if (step !== "ticket" || !ticket?.id) return;
    const close = () => reset();
    const timer = setTimeout(close, 60_000);
    const onPrinted = () => close();
    window.addEventListener("afterprint", onPrinted);
    const poll = setInterval(async () => {
      const { data } = await supabase.rpc("ticket_was_opened", { p_id: ticket.id });
      if (data === true) close();
    }, 2000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("afterprint", onPrinted);
    };
  }, [step, ticket?.id]);

  async function lookup() {
    setBusy(true);
    const value = kind === "phone" ? `+254${idValue}` : idValue;
    const { data, error } = await supabase.rpc("lookup_patient", {
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim() || (null as unknown as string),
      p_surname: surname.trim() || (null as unknown as string),
      p_kind: kind,
      p_value: value,
    });
    setBusy(false);
    if (error) { toast.error(B("Could not check records. Try again.", "Rekodi hazikupatikana — jaribu tena.")); return; }
    const r = data as unknown as { found: boolean } & Patient;
    if (r.found) { setPatient({ ...r, returning: true }); setStep("welcome"); }
    else {
      if (kind === "phone") setPhone(idValue);
      if (kind === "national_id") setNid(idValue);
      setStep("register");
    }
  }

  async function register() {
    setBusy(true);
    const { data, error } = await supabase.rpc("register_patient", {
      p_first_name: firstName.trim(),
      p_last_name: lastName.trim() || (null as unknown as string),
      p_surname: surname.trim() || (null as unknown as string),
      p_phone: phone ? `+254${phone}` : (null as unknown as string),
      p_national_id: nid || (null as unknown as string),
    });
    if (error) {
      setBusy(false);
      toast.error(error.message.includes("ID already")
        ? B("That ID is already registered — check your name spelling.", "Hiyo ID iko tayari — angalia majina.")
        : B("Could not register. Check your details.", "Usajili umeshindikana — angalia details."));
      return;
    }
    const newPatient = { ...(data as unknown as Patient), returning: false };
    setPatient(newPatient);
    setTicket(null);
    // New patients join the Registration queue first (identity check + hospital number),
    // then continue the normal check-in: priority → visit type → service → payment → ticket.
    const { error: qError } = await supabase.rpc("queue_at_registration", {
      p_patient: newPatient.patient_id,
      p_language: lang,
    });
    setBusy(false);
    if (qError) {
      toast.error(B("Could not join the registration queue. Please ask a staff member.", "Imeshindikana kuingia foleni ya usajili — tafadhali muulize mfanyakazi."));
    }
    setStep("welcome");
  }

  function pickPayment(method: PayMethod) {
    setPayMethod(method);
    setCardBrand("");
    setInsurerId("");
    if (method === "cash") setStep("verify");
    else setStep("pay_detail");
  }

  async function issueTicket() {
    if (!patient || !payMethod || !service) return;
    if (payMethod === "card" && !cardBrand) {
      toast.error(B("Choose your bank card.", "Chagua kadi yako ya benki."));
      return;
    }
    if (payMethod === "insurance" && !insurerId) {
      toast.error(B("Choose your insurance.", "Chagua bima yako."));
      return;
    }
    setBusy(true);
    const note = [...reasons, bleed.amount && `Bleeding: ${bleed.amount}, ${bleed.where}, ${bleed.cause}`].filter(Boolean).join("; ");
    const insurerName = insurers.find((i) => i.id === insurerId)?.name ?? null;
    const { data, error } = await supabase.rpc("issue_visit", {
      p_patient: patient.patient_id,
      p_service_code: service,
      p_visit_type: visit,
      p_payment: payMethod,
      p_triage: triage,
      p_triage_note: note,
      p_language: lang,
      p_appt_at: apptTime ? new Date(apptTime).toISOString() : (null as unknown as string),
      p_appt_service: apptService || (null as unknown as string),
      p_payment_detail: payMethod === "card" ? cardBrand : payMethod === "insurance" ? insurerName : (null as unknown as string),
      p_insurer_id: payMethod === "insurance" || payMethod === "sha" ? (insurerId || null) : (null as unknown as string),
    });
    setBusy(false);
    if (error) {
      toast.error(B(error.message || "Could not issue ticket. Please try again.", "Imeshindikana kupata tiketi — jaribu tena au muulize mfanyakazi."));
      return;
    }
    setTicket(data as unknown as Issued);
    setStep("ticket");
  }

  function toggleReason(r: string) {
    setReasons((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]));
  }
  const redPicked = RED_REASONS.some((r) => reasons.includes(r.en)) || reasons.includes("Bleeding");
  const orangePicked = ORANGE_REASONS.some((r) => reasons.includes(r.en));

  const back: Partial<Record<Step, Step>> = {
    identify: "lang", register: "identify", welcome: "identify",
    triage: "welcome", bleeding: "triage", visit: "triage", appointment: "visit",
    service: "visit", payment: "service",
    pay_detail: "payment",
    verify: payMethod === "cash" || payMethod === "sha" ? "payment" : "pay_detail",
  };
  const selectedInsurer = insurers.find((i) => i.id === insurerId);
  const paySummary =
    payMethod === "cash" ? B("Cash / M-Pesa", "Pesa taslimu / M-Pesa")
      : payMethod === "card" ? `${B("Bank card", "Kadi ya benki")}: ${cardBrand}`
        : payMethod === "insurance" ? `${B("Insurance", "Bima")}: ${selectedInsurer?.name ?? "—"}`
          : payMethod === "sha" ? "SHA"
            : "";
  const clinics = services.filter((s) => s.category === "clinic");
  const others = services.filter((s) => s.category !== "clinic");

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between bg-primary px-8 py-5 text-primary-foreground">
        <div className="flex items-center gap-4">
          <img src="/brand/kijabe-logo.png" alt="" className="h-12 w-auto rounded-md bg-white/95 p-1 object-contain" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] opacity-80">AIC Kijabe Hospital</p>
            <p className="font-display text-2xl font-bold">{L("welcome")}</p>
          </div>
        </div>
        {back[step] && (
          <button onClick={() => setStep(back[step]!)} className="flex items-center gap-2 rounded-full bg-primary-foreground/15 px-5 py-3 text-lg font-semibold">
            <ArrowLeft className="h-5 w-5" /> {L("back")}
          </button>
        )}
      </header>

      <section key={step} className="step-enter mx-auto flex w-full max-w-4xl flex-1 flex-col overflow-y-auto px-6 py-8">
        {step === "lang" && (
          <>
            <Title>{t("chooseLang", "en")} · {t("chooseLang", "sw")}</Title>
            <div className="grid gap-5 sm:grid-cols-2">
              <Big onClick={() => { setLang("en"); setStep("identify"); }} title="English" />
              <Big onClick={() => { setLang("sw"); setStep("identify"); }} title="Kiswahili" />
            </div>
          </>
        )}

        {step === "identify" && (
          <div className="mx-auto w-full max-w-xl">
            <Title>{L("beenBefore")}</Title>
            <p className="-mt-4 mb-6 text-center text-lg text-muted-foreground">{L("identifyHint")}</p>
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-semibold">{L("firstName")}</label>
                <input value={firstName} onChange={(e) => setFirstName(capitalizeName(e.target.value))} maxLength={40} autoFocus
                  className="h-14 w-full rounded-2xl border-2 bg-card px-4 text-xl" placeholder={B("Mary", "Mary")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">{L("lastName")}</label>
                <input value={lastName} onChange={(e) => setLastName(capitalizeName(e.target.value))} maxLength={40}
                  className="h-14 w-full rounded-2xl border-2 bg-card px-4 text-xl" placeholder={B("Wanjiku", "Wanjiku")} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">{L("surname")}</label>
                <input value={surname} onChange={(e) => setSurname(capitalizeName(e.target.value))} maxLength={40}
                  className="h-14 w-full rounded-2xl border-2 bg-card px-4 text-xl" placeholder={B("Kamau", "Kamau")} />
              </div>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2">
              {([["phone", B("Phone", "Simu")], ["card", L("hospitalNo")], ["national_id", B("National ID", "Kitambulisho")]] as const).map(([k, label]) => (
                <button key={k} onClick={() => { setKind(k); setIdValue(""); }} className={`h-14 rounded-xl border-2 text-lg font-semibold ${kind === k ? "border-primary bg-primary text-primary-foreground" : "bg-card"}`}>{label}</button>
              ))}
            </div>
            {kind === "phone" ? (
              <div className="flex h-16 items-center rounded-2xl border-2 bg-card px-5 text-2xl">
                <span className="mr-2 text-muted-foreground">+254</span>
                <input inputMode="numeric" value={idValue} onChange={(e) => setIdValue(e.target.value.replace(/\D/g, "").replace(/^0/, "").slice(0, 9))} className="w-full bg-transparent outline-none" placeholder="712345678" />
              </div>
            ) : (
              <input value={idValue} onChange={(e) => setIdValue(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 24))}
                className="h-16 w-full rounded-2xl border-2 bg-card px-5 text-2xl" placeholder={kind === "card" ? B("e.g. KH100001", "mf. KH100001") : "12345678"} />
            )}
            <div className="mt-6 grid grid-cols-3 gap-3">
              <button onClick={() => setStep("register")} className="h-16 rounded-2xl border text-lg font-semibold">{L("imNew")}</button>
              <button onClick={lookup} disabled={busy || !namesOk || (kind === "phone" ? idValue.length !== 9 : idValue.length < 4)}
                className="col-span-2 h-16 rounded-2xl bg-primary text-xl font-bold text-primary-foreground disabled:opacity-40">{L("findRecord")}</button>
            </div>
          </div>
        )}

        {step === "register" && (
          <div className="mx-auto w-full max-w-md text-center">
            <Title>{L("newReg")}</Title>
            <p className="-mt-4 mb-4 text-lg text-muted-foreground">{L("newRegHint")}</p>
            <div className="mb-3 grid gap-2 text-left">
              <input value={firstName} onChange={(e) => setFirstName(capitalizeName(e.target.value))} maxLength={40} className="h-14 w-full rounded-2xl border-2 bg-card px-5 text-xl" placeholder={L("firstName")} />
              <input value={lastName} onChange={(e) => setLastName(capitalizeName(e.target.value))} maxLength={40} className="h-14 w-full rounded-2xl border-2 bg-card px-5 text-xl" placeholder={L("lastName")} />
              <input value={surname} onChange={(e) => setSurname(capitalizeName(e.target.value))} maxLength={40} className="h-14 w-full rounded-2xl border-2 bg-card px-5 text-xl" placeholder={L("surname")} />
            </div>
            <div className="mb-3 h-16 rounded-2xl border-2 bg-card font-display text-3xl font-bold leading-[4rem] tracking-widest">
              <span className="text-muted-foreground">+254 </span>{phone || <span className="text-muted-foreground">7__ ___ ___</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0"].map((d, i) => d === "" ? <span key={i} /> : (
                <button key={d} onClick={() => phone.length < 9 && !(phone === "" && d === "0") && setPhone(phone + d)}
                  className="h-14 rounded-xl border bg-card font-display text-2xl font-bold active:bg-secondary">{d}</button>
              ))}
              <button onClick={() => setPhone(phone.slice(0, -1))} aria-label="Delete" className="flex h-14 items-center justify-center rounded-xl border bg-card"><Delete className="h-6 w-6" /></button>
            </div>
            <input value={nid} onChange={(e) => setNid(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
              className="mt-3 h-14 w-full rounded-2xl border-2 bg-card px-5 text-xl" placeholder={L("nationalIdOpt")} />
            <button onClick={register} disabled={busy || !namesOk || (phone.length > 0 && phone.length !== 9)}
              className="mt-5 h-16 w-full rounded-2xl bg-primary text-xl font-bold text-primary-foreground disabled:opacity-40">{L("registerMe")}</button>
          </div>
        )}

        {step === "welcome" && patient && (
          <div className="mx-auto max-w-lg text-center">
            <UserCheck className="mx-auto h-16 w-16 text-primary" />
            <Title>{patient.returning
              ? B(`Welcome back, ${patient.first_name}!`, `Karibu tena, ${patient.first_name}!`)
              : B(`You're registered, ${patient.first_name}!`, `Umesajiliwa, ${patient.first_name}!`)}</Title>
            {(patient.last_name || patient.surname) && (
              <p className="text-lg text-muted-foreground">{[patient.first_name, patient.last_name, patient.surname].filter(Boolean).join(" ")}</p>
            )}
            {patient.card_no && (
              <p className="text-xl">{L("hospitalNo")}: <b className="font-display text-2xl">{patient.card_no}</b></p>
            )}
            {patient.returning && patient.last_visit_at && (
              <p className="mt-2 text-lg text-muted-foreground">{L("lastVisit")}: {new Date(patient.last_visit_at).toLocaleDateString(lang === "sw" ? "sw-KE" : "en-KE", { dateStyle: "long" })}{patient.last_service ? ` · ${patient.last_service}` : ""}</p>
            )}
            {!patient.returning && (
              <p className="mt-2 text-muted-foreground">{L("hospNoHint")}</p>
            )}
            <p className="mt-3 text-muted-foreground">{L("nextPriorityPay")}</p>
            <button onClick={() => setStep("triage")} className="mt-8 h-16 w-full rounded-2xl bg-primary text-xl font-bold text-primary-foreground">{L("continue")}</button>
          </div>
        )}

        {step === "visit" && (
          <>
            <Title>{L("visitType")}</Title>
            <div className="grid gap-5 sm:grid-cols-2">
              <Big onClick={() => { setVisit("walk_in"); setStep("service"); }} title={L("walkIn")} sub={L("walkInSub")} />
              <Big onClick={() => { setVisit("booked"); setStep("appointment"); }} title={L("booked")} sub={L("bookedSub")} />
            </div>
          </>
        )}

        {step === "appointment" && (
          <div className="mx-auto w-full max-w-xl">
            <Title>{L("yourAppt")}</Title>
            <label className="mb-2 block text-lg font-semibold">{L("whichDept")}</label>
            <select value={apptService} onChange={(e) => setApptService(e.target.value)} className="mb-5 h-16 w-full rounded-2xl border-2 bg-card px-4 text-xl">
              <option value="">{L("choose")}</option>
              {services.map((s) => <option key={s.code} value={s.code}>{lang === "sw" ? s.name_sw : s.name_en}</option>)}
            </select>
            <label className="mb-2 block text-lg font-semibold">{L("apptTime")}</label>
            <input type="datetime-local" value={apptTime} onChange={(e) => setApptTime(e.target.value)} className="h-16 w-full rounded-2xl border-2 bg-card px-4 text-xl" />
            <button disabled={!apptService || !apptTime} onClick={() => { setService(apptService); setStep("payment"); }}
              className="mt-6 h-16 w-full rounded-2xl bg-primary text-xl font-bold text-primary-foreground disabled:opacity-40">{L("continue")}</button>
          </div>
        )}

        {step === "triage" && (
          <>
            <Title>{L("priority")}</Title>
            <p className="mb-2 text-lg font-bold text-destructive">● {B("RED — choose all that apply", "NYEKUNDU — chagua vyote vinavyohusika")}</p>
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {RED_REASONS.map((r) => {
                const on = reasons.includes(r.en);
                return (
                  <button key={r.en} type="button" onClick={() => toggleReason(r.en)}
                    className={`min-h-20 rounded-2xl border-2 p-4 text-left text-xl font-bold ${on ? "border-red-600 bg-red-600 text-white" : "border-red-500 bg-red-50 text-red-800"}`}>
                    {on ? "✓ " : ""}{B(r.en, r.sw)}
                  </button>
                );
              })}
              <button type="button" onClick={() => reasons.includes("Bleeding") ? toggleReason("Bleeding") : setStep("bleeding")}
                className={`min-h-20 rounded-2xl border-2 p-4 text-left text-xl font-bold ${reasons.includes("Bleeding") ? "border-red-600 bg-red-600 text-white" : "border-red-500 bg-red-50 text-red-800"}`}>
                {reasons.includes("Bleeding") ? "✓ " : ""}{B("Bleeding", "Kuvuja damu")}
                <span className={`mt-1 block text-base font-medium ${reasons.includes("Bleeding") ? "text-white/80" : "text-red-700/80"}`}>{B("A few quick questions", "Maswali machache")}</span>
              </button>
            </div>
            <p className="mb-2 text-lg font-bold text-orange-600">● {B("ORANGE — choose all that apply", "MACHUNGWA — chagua vyote vinavyohusika")}</p>
            <div className="mb-6 grid gap-3 sm:grid-cols-2">
              {ORANGE_REASONS.map((r) => (
                <button key={r.en} type="button" onClick={() => toggleReason(r.en)}
                  className={`min-h-20 rounded-2xl border-2 border-orange-500 p-4 text-left text-xl font-bold ${reasons.includes(r.en) ? "bg-orange-500 text-white" : "bg-orange-100 text-orange-800"}`}>
                  {reasons.includes(r.en) ? "✓ " : ""}{B(r.en, r.sw)}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <button disabled={!redPicked && !orangePicked} onClick={() => { setTriage(redPicked ? "red" : "orange"); setStep("visit"); }}
                className={`h-16 rounded-2xl text-xl font-bold text-white disabled:opacity-40 ${redPicked ? "bg-red-600" : "bg-orange-500"}`}>
                {redPicked ? B("Continue", "Endelea") : B("Continue as priority", "Endelea kwa kipaumbele")}
              </button>
              <button onClick={() => { setTriage("green"); setReasons([]); setStep("visit"); }}
                className="h-16 rounded-2xl border-2 bg-card text-xl font-bold">{L("normal")}</button>
            </div>
          </>
        )}

        {step === "bleeding" && (
          <div className="mx-auto w-full max-w-2xl">
            <Title>{B("About the bleeding", "Kuhusu kuvuja damu")}</Title>
            <Choice label={B("How much?", "Kiasi gani?")} value={bleed.amount} onChange={(v) => setBleed({ ...bleed, amount: v })}
              options={[["heavy", B("Heavy / won't stop", "Nyingi / haikomi")], ["moderate", B("Moderate", "Wastani")], ["light", B("Light / stopped", "Kidogo / imekoma")]]} />
            <Choice label={B("Where?", "Wapi?")} value={bleed.where} onChange={(v) => setBleed({ ...bleed, where: v })}
              options={[["head", B("Head / face", "Kichwa / uso")], ["chest_abdomen", B("Chest / belly", "Kifua / tumbo")], ["pregnancy", B("Pregnancy-related", "Inayohusu ujauzito")], ["limb", B("Arm / leg", "Mkono / mguu")], ["other", B("Other", "Kwingine")]]} />
            <Choice label={B("What caused it?", "Imesababishwa na nini?")} value={bleed.cause} onChange={(v) => setBleed({ ...bleed, cause: v })}
              options={[["accident", B("Accident / fall", "Ajali / kuanguka")], ["cut", B("Cut / wound", "Kukatwa / jeraha")], ["unknown", B("Don't know / on its own", "Sijui / yenyewe")]]} />
            <button disabled={!bleed.amount || !bleed.where || !bleed.cause} onClick={() => {
              setReasons((rs) => (rs.includes("Bleeding") ? rs : [...rs, "Bleeding"]));
              setStep("triage");
            }} className="mt-4 h-16 w-full rounded-2xl bg-destructive text-xl font-bold text-destructive-foreground disabled:opacity-40">{B("Continue", "Endelea")}</button>
          </div>
        )}

        {step === "service" && (
          <>
            <Title>{L("service")}</Title>
            <p className="mb-3 text-center text-muted-foreground">{L("triageStart")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {[...clinics, ...others].map((s) => (
                <Big key={s.code} onClick={() => { setService(s.code); setStep("payment"); }}
                  title={lang === "sw" ? s.name_sw : s.name_en} sub={lang === "sw" ? s.description_sw : s.description_en} />
              ))}
            </div>
          </>
        )}

        {step === "payment" && (
          <>
            <Title>{L("payment")}</Title>
            <p className="-mt-2 mb-4 text-center text-muted-foreground">
              {B(
                "Cash skips insurance checks. Card and insurance need a quick confirmation before your Triage ticket is created.",
                "Taslimu inaruka bima. Kadi na bima zinahitaji uthibitisho kabla ya tiketi ya Triage.",
              )}
            </p>
            <div className="grid gap-4">
              <Big onClick={() => pickPayment("cash")} title={L("cash")} sub={B("Skip insurance — continue to confirm", "Ruka bima — endelea kuthibitisha")} />
              <Big onClick={() => pickPayment("card")} title={L("card")} sub={B("Visa, Mastercard and other bank cards", "Visa, Mastercard na kadi nyingine")} />
              <Big onClick={() => pickPayment("insurance")} title={L("insurance")} sub={B("Choose your medical insurer next", "Chagua bima yako baadaye")} />
              <Big
                onClick={() => {
                  const sha = insurers.find((i) => i.code === "SHA");
                  setPayMethod("sha");
                  setInsurerId(sha?.id ?? "");
                  setCardBrand("");
                  setStep("verify");
                }}
                title={L("sha")}
                sub={B("Social Health Authority cover", "Bima ya SHA")}
              />
            </div>
          </>
        )}

        {step === "pay_detail" && payMethod === "card" && (
          <div className="mx-auto w-full max-w-xl">
            <Title>{L("chooseCard")}</Title>
            <div className="grid gap-3 sm:grid-cols-2">
              {CARD_BRANDS.map((brand) => (
                <button
                  key={brand}
                  type="button"
                  onClick={() => { setCardBrand(brand); setStep("verify"); }}
                  className={`min-h-16 rounded-2xl border-2 px-4 text-left text-xl font-bold transition ${cardBrand === brand ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary"}`}
                >
                  {brand}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "pay_detail" && payMethod === "insurance" && (
          <div className="mx-auto w-full max-w-2xl">
            <Title>{L("chooseInsurer")}</Title>
            <p className="-mt-4 mb-4 text-center text-muted-foreground">
              {B("Insurers accepted at AIC Kijabe (staff can update this list later).", "Bima zinazokubaliwa Kijabe (wafanyakazi wanaweza kusasisha orodha baadaye).")}
            </p>
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {insurers.filter((i) => i.code !== "SHA").map((ins) => (
                <button
                  key={ins.id}
                  type="button"
                  onClick={() => { setInsurerId(ins.id); setStep("verify"); }}
                  className={`flex w-full items-center rounded-2xl border-2 px-5 py-4 text-left text-lg font-semibold transition ${insurerId === ins.id ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary"}`}
                >
                  {ins.name}
                </button>
              ))}
              {!insurers.length && (
                <p className="text-center text-muted-foreground">{B("No insurers loaded — ask the registration desk.", "Hakuna bima — muulize dawati la usajili.")}</p>
              )}
            </div>
          </div>
        )}

        {step === "verify" && (
          <div className="mx-auto w-full max-w-lg text-center">
            <Title>{L("verifyPay")}</Title>
            <div className="rounded-3xl border bg-card p-6 text-left text-lg">
              <p><span className="text-muted-foreground">{B("Patient", "Mgonjwa")}:</span> <b>{patient?.first_name}</b></p>
              <p className="mt-2"><span className="text-muted-foreground">{B("Service", "Huduma")}:</span> <b>{services.find((s) => s.code === service)?.[lang === "sw" ? "name_sw" : "name_en"] ?? service}</b></p>
              <p className="mt-2"><span className="text-muted-foreground">{B("Payment", "Malipo")}:</span> <b>{paySummary}</b></p>
              <p className="mt-4 rounded-xl bg-secondary/70 p-3 text-sm text-muted-foreground">
                {B(
                  "After you confirm, your ticket is created and you wait at Triage first — not the clinic desk.",
                  "Ukithibitisha, tiketi inaundwa na unasubiri Triage kwanza — si dawati la kliniki.",
                )}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={issueTicket}
              className="mt-8 h-16 w-full rounded-2xl bg-primary text-xl font-bold text-primary-foreground disabled:opacity-40"
            >
              {busy ? B("Creating ticket…", "Inatengeneza tiketi…") : B("Confirm & get Triage ticket", "Thibitisha & pata tiketi ya Triage")}
            </button>
          </div>
        )}

        {step === "ticket" && ticket && (
          <div className="mx-auto w-full max-w-md text-center">
            <div className={`print-area rounded-3xl border-4 bg-card p-8 ${ticket.triage === "red" ? "border-destructive" : ticket.triage === "orange" ? "border-accent" : "border-dashed border-primary"}`}>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">AIC Kijabe Hospital</p>
              {ticket.triage !== "green" && (
                <p className={`mt-3 rounded-full py-1 text-sm font-bold uppercase tracking-widest ${ticket.triage === "red" ? "bg-destructive text-destructive-foreground" : "bg-accent text-accent-foreground"}`}>
                  {ticket.triage === "red" ? B("Red · urgent", "Nyekundu · dharura") : B("Orange · priority", "Machungwa · kipaumbele")}
                </p>
              )}
              <p className="mt-4 text-lg">{L("yourNumber")}</p>
              <p className="token-pop font-display text-6xl font-extrabold text-primary">{ticket.token}</p>
              <p className="mt-2 text-xl font-semibold">{B("Go to", "Nenda")}: {lang === "sw" ? ticket.service_sw : ticket.service_en}</p>
              <div className="mt-5 grid grid-cols-2 gap-3 text-left">
                <div className="rounded-xl bg-muted p-3"><p className="text-3xl font-bold">{ticket.ahead}</p><p className="text-sm text-muted-foreground">{L("ahead")}</p></div>
                <div className="rounded-xl bg-muted p-3"><p className="text-3xl font-bold">~{ticket.est_minutes} {L("minutes")}</p><p className="text-sm text-muted-foreground">{L("estWait")}</p></div>
              </div>
              {ticket.path?.length > 1 && (
                <ol className="mt-4 flex flex-wrap items-center justify-center gap-1 text-sm">
                  {ticket.path.map((p, i) => <li key={i} className="rounded-full bg-secondary px-3 py-1">{i + 1}. {lang === "sw" ? p.sw : p.en}</li>)}
                </ol>
              )}
              <div className="mt-6 flex flex-col items-center gap-2">
                <div className="qr-in rounded-2xl bg-white p-3">
                  <QRCodeSVG
                    value={trackBase ? `${trackBase}/ticket/${ticket.id}` : ticketTrackUrl(ticket.id)}
                    size={220}
                    level="M"
                    marginSize={2}
                    bgColor="#ffffff"
                    fgColor="#102a43"
                  />
                </div>
                <p className="text-sm font-semibold text-muted-foreground">{L("scan")}</p>
                <p className="max-w-[16rem] break-all text-xs text-muted-foreground">
                  {trackBase ? `${trackBase}/ticket/${ticket.id}` : ticketTrackUrl(ticket.id)}
                </p>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">{ticket.card_no ? `${B("Hosp. no.", "Nambari")} ${ticket.card_no} · ` : ""}{new Date(ticket.created_at).toLocaleString(lang === "sw" ? "sw-KE" : "en-KE")}</p>
            </div>
            <p className="mt-6 text-lg">{L("watchScreen")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{B("This screen closes when the receipt prints, your phone opens the ticket, or after 1 minute.", "Skrini hii inafunga tiketi ikichapishwa, simu ikifungua tiketi, au baada ya dakika 1.")}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button onClick={() => window.print()} className="flex h-16 items-center justify-center gap-2 rounded-2xl border text-lg font-semibold"><Printer className="h-5 w-5" />{B("Print receipt", "Chapisha risiti")}</button>
              <button onClick={reset} className="h-16 rounded-2xl bg-primary text-xl font-bold text-primary-foreground">{B("Continue", "Endelea")}</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: (readonly [string, string])[] }) {
  return (
    <div className="mb-5">
      <p className="mb-2 text-lg font-semibold">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(v)} className={`min-h-14 rounded-xl border-2 px-5 text-lg font-semibold ${value === v ? "border-destructive bg-destructive text-destructive-foreground" : "bg-card"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-8 text-center text-4xl font-extrabold">{children}</h1>;
}

function Big({ title, sub, onClick, tone }: { title: string; sub?: string; onClick: () => void; tone?: "danger" | "accent" }) {
  const toneCls = tone === "danger" ? "border-destructive bg-destructive/10" : tone === "accent" ? "border-accent bg-accent/20" : "bg-card";
  return (
    <button onClick={onClick} className={`min-h-24 rounded-2xl border-2 p-5 text-left shadow-sm transition active:scale-[0.98] hover:border-primary ${toneCls}`}>
      <span className="block font-display text-2xl font-bold">{title}</span>
      {sub && <span className="mt-1 block text-lg text-muted-foreground">{sub}</span>}
    </button>
  );
}
