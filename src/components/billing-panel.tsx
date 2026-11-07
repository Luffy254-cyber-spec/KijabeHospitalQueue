import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Fee = {
  ticket_id: string;
  token: string;
  service_code: string;
  amount_kes: number;
  base_kes: number;
  surcharge_kes: number;
  label: string;
  payment_method: string;
  phone: string | null;
  triage: string;
  already_paid: boolean;
};

type PayStatus = {
  found?: boolean;
  paid?: boolean;
  status?: string;
  method?: string;
  amount_kes?: number;
  mpesa_receipt?: string | null;
  result_desc?: string | null;
  checkout_request_id?: string | null;
};

function AtmPad({
  value,
  onChange,
  maxLen = 12,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLen?: number;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "←", "0", "C"];
  const press = (k: string) => {
    if (k === "C") onChange("");
    else if (k === "←") onChange(value.slice(0, -1));
    else if (value.length < maxLen) onChange(value + k);
  };
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className="h-14 rounded-xl border bg-background text-2xl font-bold hover:bg-muted active:scale-95"
        >
          {k}
        </button>
      ))}
    </div>
  );
}

export function BillingPanel({
  ticketId,
  paymentMethod,
  onPaid,
}: {
  ticketId: string;
  paymentMethod: string;
  onPaid: () => void;
}) {
  const [fee, setFee] = useState<Fee | null>(null);
  const [amount, setAmount] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [mode, setMode] = useState<"choose" | "mpesa" | "cash" | "cover">("choose");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [coverRef, setCoverRef] = useState("");
  const [waiver, setWaiver] = useState("");
  const [cashTendered, setCashTendered] = useState("");

  const loadFee = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_fee_for_ticket", { p_ticket: ticketId });
    if (error) {
      toast.error(error.message);
      return;
    }
    const f = data as unknown as Fee;
    setFee(f);
    setAmount(String(f.amount_kes));
    const ph = (f.phone || "").replace(/^\+?254/, "").replace(/\D/g, "");
    setPhoneDigits(ph.slice(0, 9));
    if (f.already_paid) {
      const { data: st } = await supabase.rpc("get_payment_status", { p_ticket: ticketId });
      setStatus(st as unknown as PayStatus);
    }
  }, [ticketId]);

  useEffect(() => {
    loadFee();
  }, [loadFee]);

  useEffect(() => {
    if (paymentMethod === "insurance" || paymentMethod === "sha") setMode("cover");
  }, [paymentMethod]);

  useEffect(() => {
    if (!waiting) return;
    const poll = async () => {
      const { data } = await supabase.rpc("get_payment_status", { p_ticket: ticketId });
      const st = data as unknown as PayStatus;
      setStatus(st);
      if (st?.paid) {
        setWaiting(false);
        toast.success(st.mpesa_receipt ? `Paid · Receipt ${st.mpesa_receipt}` : "Payment confirmed");
        onPaid();
      } else if (st?.status === "failed") {
        setWaiting(false);
        toast.error(st.result_desc || "M-Pesa payment failed / cancelled");
      }
    };
    poll();
    const id = setInterval(poll, 2500);
    const ch = supabase
      .channel(`pay-${ticketId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `ticket_id=eq.${ticketId}` }, () =>
        poll(),
      )
      .subscribe();
    return () => {
      clearInterval(id);
      supabase.removeChannel(ch);
    };
  }, [waiting, ticketId, onPaid]);

  const pushStk = async () => {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in required");
      const phone = `254${phoneDigits}`;
      const res = await fetch("/api/mpesa/stkpush", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ticketId,
          phone,
          amount: Number(amount),
          accountRef: fee?.token?.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "KIJABE",
        }),
      });
      const json = (await res.json()) as { error?: string; ResponseCode?: string; CustomerMessage?: string };
      if (!res.ok) throw new Error(json.error || "STK push failed");
      toast.success(json.CustomerMessage || "STK prompt sent — ask patient to enter PIN");
      setWaiting(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "STK failed");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (method: "cash" | "insurance" | "sha" | "waiver") => {
    setBusy(true);
    const { error } = await supabase.rpc("confirm_cash_or_cover", {
      p_ticket: ticketId,
      p_method: method,
      p_amount: Number(amount) || 0,
      p_cover_ref: coverRef || "",
      p_waiver_reason: waiver || "",
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(method === "cash" ? "Cash received" : method === "waiver" ? "Waiver recorded" : "Cover accepted");
      onPaid();
      loadFee();
    }
  };

  if (!fee) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-xl border p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading fee…
      </div>
    );
  }

  if (fee.already_paid || status?.paid) {
    return (
      <div className="mt-6 rounded-xl border border-success/40 bg-success/10 p-4">
        <p className="font-bold text-success">Payment complete</p>
        <p className="text-sm text-muted-foreground">
          {status?.method?.toUpperCase() || "PAID"} · KES {status?.amount_kes ?? fee.amount_kes}
          {status?.mpesa_receipt ? ` · M-Pesa ${status.mpesa_receipt}` : ""}
        </p>
        <p className="mt-1 text-sm">You can now complete this step / close the visit.</p>
      </div>
    );
  }

  const change =
    cashTendered && Number(cashTendered) >= Number(amount) ? Number(cashTendered) - Number(amount) : null;

  return (
    <div className="mt-6 rounded-xl border bg-muted/40 p-4">
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Billing</p>
      <p className="mt-1 text-lg font-bold">
        {fee.label} · <span className="text-primary">KES {amount || fee.amount_kes}</span>
      </p>
      {fee.surcharge_kes > 0 && (
        <p className="text-xs text-muted-foreground">
          Base {fee.base_kes} + triage surcharge {fee.surcharge_kes}
        </p>
      )}
      <label className="mt-3 block text-sm font-semibold">Amount (KES) — editable</label>
      <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 max-w-[10rem] text-lg font-bold" />

      {mode === "choose" && paymentMethod === "cash" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Button size="lg" className="h-16" onClick={() => setMode("mpesa")}>
            <Smartphone className="h-5 w-5" /> M-Pesa STK prompt
          </Button>
          <Button size="lg" variant="outline" className="h-16" onClick={() => setMode("cash")}>
            <Banknote className="h-5 w-5" /> Cash (ATM pad)
          </Button>
        </div>
      )}

      {mode === "mpesa" && (
        <div className="mt-4 space-y-3">
          <p className="font-semibold">Patient M-Pesa number</p>
          <p className="font-display text-3xl font-bold tabular-nums">
            254 {phoneDigits.padEnd(9, "·").split("").join(" ")}
          </p>
          <AtmPad value={phoneDigits} onChange={setPhoneDigits} maxLen={9} />
          <p className="text-xs text-muted-foreground">Sandbox test phone: 254 708 374 149</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || phoneDigits.length !== 9 || !Number(amount)} onClick={pushStk}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
              Send STK prompt
            </Button>
            <Button variant="ghost" onClick={() => setMode("choose")}>
              Back
            </Button>
          </div>
          {waiting && (
            <p className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Loader2 className="h-4 w-4 animate-spin" /> Waiting for patient to enter M-Pesa PIN…
            </p>
          )}
        </div>
      )}

      {mode === "cash" && (
        <div className="mt-4 space-y-3">
          <p className="font-semibold">Cash tendered (KES)</p>
          <p className="font-display text-4xl font-bold tabular-nums">{cashTendered || "0"}</p>
          <AtmPad value={cashTendered} onChange={setCashTendered} maxLen={8} />
          {change != null && <p className="text-lg font-bold text-success">Change: KES {change}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !Number(amount) || Number(cashTendered) < Number(amount)}
              onClick={() => confirm("cash")}
            >
              <Banknote className="h-4 w-4" /> Confirm cash received
            </Button>
            <Button variant="ghost" onClick={() => setMode("choose")}>
              Back
            </Button>
          </div>
        </div>
      )}

      {mode === "cover" && (
        <div className="mt-4 space-y-3">
          <p className="font-semibold">
            {paymentMethod === "sha" ? "SHA member / claim number" : "Insurance / corporate member number"}
          </p>
          <Input value={coverRef} onChange={(e) => setCoverRef(e.target.value)} placeholder="Member / SHA number" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || coverRef.trim().length < 3} onClick={() => confirm(paymentMethod === "sha" ? "sha" : "insurance")}>
              <ShieldCheck className="h-4 w-4" /> Verified — cover accepted
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                toast.error("Cover rejected — use Transfer below to send the patient to Cashier");
              }}
            >
              Rejected — send to cashier
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t pt-3">
        <p className="mb-1 text-xs text-muted-foreground">Hardship waiver (requires reason)</p>
        <div className="flex gap-2">
          <Input value={waiver} onChange={(e) => setWaiver(e.target.value)} placeholder="Waiver reason" />
          <Button variant="destructive" disabled={busy || waiver.trim().length < 5} onClick={() => confirm("waiver")}>
            Waive
          </Button>
        </div>
      </div>
    </div>
  );
}
