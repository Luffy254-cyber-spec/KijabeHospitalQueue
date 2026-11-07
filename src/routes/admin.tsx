import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Shield, Users, DoorOpen, Bell, Download, LogOut, UserPlus, Check, X, Megaphone, Trash2, Moon, Plus, Eye, Clock,
} from "lucide-react";
import { PRIORITY_LABEL, PAYMENT_LABEL } from "@/lib/queue";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoonPhaseLive } from "@/lib/moon-phase";
import { capitalizeName } from "@/lib/names";
import { useIdleLogout } from "@/hooks/use-idle-logout";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Superadmin — Kijabe Queue" }] }),
  component: AdminPage,
});

type StaffRow = {
  id: string; email: string; full_name: string; status: string; roles: string[] | null;
  on_duty: boolean; current_room: string | null;
  first_name?: string | null; last_name?: string | null; surname?: string | null; phone?: string | null;
  work_id_last4?: string | null; work_id_set?: boolean;
};
type RoomOcc = {
  counter_id: string; name: string; service: string;
  occupied: boolean; occupant: string | null; occupant_email?: string | null;
};
type OpsBoard = {
  day: string;
  on_duty: { user_id: string; email: string; name: string; room: string | null; since: string }[];
  absent_staff: { user_id: string; email: string; name: string }[];
  empty_rooms: { counter_id: string; name: string; service: string }[];
  rooms?: RoomOcc[];
  pending_approvals: { user_id: string; email: string; name: string; created_at: string }[];
  open_summons: number;
};
type DailyStats = {
  day: string; total_patients: number;
  by_status: Record<string, number>;
  by_triage: Record<string, number>;
  by_payment: Record<string, number>;
  by_service: { service: string; count: number }[];
  visits: {
    token: string; status: string; triage_level: string; triage_note: string | null;
    payment: string; service: string; hospital_no: string | null; patient_name: string | null;
    created_at: string; care_path: string[];
  }[];
};

type TimesheetWindow = {
  started_at: string;
  ended_at: string | null;
  last_seen_at: string;
  minutes: number;
  room: string | null;
  open: boolean;
};

type TimesheetRow = {
  user_id: string;
  email: string;
  name: string;
  day: string;
  hours: number;
  sessions: number;
  first_login: string;
  last_activity: string;
  still_online: boolean;
  windows: TimesheetWindow[];
};

type TimesheetData = {
  from: string;
  to: string;
  generated_at: string;
  rows: TimesheetRow[];
};

function nairobiTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-KE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Africa/Nairobi",
  });
}

function nairobiDate(isoOrDay: string | null | undefined) {
  if (!isoOrDay) return "—";
  // Plain YYYY-MM-DD day keys
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDay)) return isoOrDay;
  return new Date(isoOrDay).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Africa/Nairobi",
  });
}

function AdminPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { navigate({ to: "/staff" }); return; }
      setEmail(data.session.user.email ?? "");
      const { data: access, error } = await supabase.rpc("get_my_access");
      if (error || !(access as { is_superadmin?: boolean })?.is_superadmin) {
        toast.error("Superadmin access required");
        navigate({ to: "/staff" });
        return;
      }
      setAllowed(true);
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) return <main className="min-h-screen bg-background" />;
  if (!allowed) return null;
  return <AdminConsole email={email} />;
}

type ServiceOpt = { id: string; code: string; name_en: string };

function AdminConsole({ email }: { email: string }) {
  const navigate = useNavigate();
  useIdleLogout(true);

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [board, setBoard] = useState<OpsBoard | null>(null);
  const [stats, setStats] = useState<DailyStats | null>(null);
  const [services, setServices] = useState<ServiceOpt[]>([]);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [newEmail, setNewEmail] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newSurname, setNewSurname] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [summonUser, setSummonUser] = useState("");
  const [summonMsg, setSummonMsg] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomServiceId, setRoomServiceId] = useState("");
  const [roomDeptMode, setRoomDeptMode] = useState<"existing" | "new">("existing");
  const [newDeptName, setNewDeptName] = useState("");
  const [staffFilter, setStaffFilter] = useState<"approved" | "all" | "pending">("approved");
  const [observeRoomId, setObserveRoomId] = useState("");
  const [observeData, setObserveData] = useState<{
    room: string; service: string; service_code: string; occupied: boolean;
    occupant: string | null; occupant_email?: string | null;
    tickets: {
      id: string; token: string; status: string; priority: number; payment: string; visit_type: string;
      queued_at: string; triage_level?: string; triage_note?: string | null; hospital_no?: string | null;
      care_path?: string[]; path_step?: number; appointment_at?: string | null;
      payment_detail?: string | null; insurer_name?: string | null; recall_count?: number;
      patient_first?: string; patient_last?: string; patient_surname?: string; patient_phone?: string | null;
    }[];
  } | null>(null);
  const [observeLoading, setObserveLoading] = useState(false);
  const [sheetFrom, setSheetFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [sheetTo, setSheetTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [timesheet, setTimesheet] = useState<TimesheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [expandedSheet, setExpandedSheet] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, b, st, svc] = await Promise.all([
      supabase.rpc("admin_list_staff"),
      supabase.rpc("admin_ops_board"),
      supabase.rpc("admin_daily_stats", { p_day: day }),
      supabase.from("services").select("id,code,name_en").order("sort"),
    ]);
    if (s.error) toast.error(s.error.message); else setStaff((s.data as unknown as StaffRow[]) ?? []);
    if (b.error) toast.error(b.error.message); else setBoard(b.data as unknown as OpsBoard);
    if (st.error) toast.error(st.error.message); else setStats(st.data as unknown as DailyStats);
    if (!svc.error) setServices((svc.data as ServiceOpt[]) ?? []);
  }, [day]);

  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const loadTimesheet = useCallback(async () => {
    setSheetLoading(true);
    const { data, error } = await supabase.rpc("admin_staff_timesheet", {
      p_from: sheetFrom,
      p_to: sheetTo,
    });
    setSheetLoading(false);
    if (error) {
      toast.error(error.message);
      setTimesheet(null);
      return;
    }
    setTimesheet(data as unknown as TimesheetData);
  }, [sheetFrom, sheetTo]);

  useEffect(() => {
    void loadTimesheet();
  }, [loadTimesheet]);

  const pending = useMemo(
    () => staff.filter((s) => (s.status || "").toLowerCase() === "pending"),
    [staff],
  );
  const approvedStaff = useMemo(
    () =>
      staff
        .filter((s) => (s.status || "").toLowerCase() === "approved")
        .slice()
        .sort((a, b) => a.full_name.localeCompare(b.full_name)),
    [staff],
  );
  const visibleStaff = useMemo(() => {
    if (staffFilter === "all") return staff;
    if (staffFilter === "pending") return pending;
    return approvedStaff;
  }, [staff, staffFilter, pending, approvedStaff]);
  const rooms = board?.rooms ?? [];

  const createStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newFirst.trim().length < 2) { toast.error("First name required"); return; }
    const { error } = await supabase.rpc("admin_create_staff", {
      p_email: newEmail.trim(),
      p_password: newPass,
      p_first_name: newFirst.trim(),
      p_last_name: newLast.trim() || null,
      p_surname: newSurname.trim() || null,
      p_phone: newPhone.length === 9 ? `+254${newPhone}` : null,
      p_approve: true,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Staff ${newEmail} created & approved`);
      setNewEmail(""); setNewPass(""); setNewFirst(""); setNewLast(""); setNewSurname(""); setNewPhone("");
      load();
    }
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.rpc("admin_set_staff_status", { p_user: id, p_status: status });
    if (error) toast.error(error.message);
    else { toast.success(`Staff ${status}`); load(); }
  };

  const assignWorkId = async (id: string, workId: string) => {
    const { error } = await supabase.auth.setWorkId(id, workId);
    if (error) toast.error(error.message);
    else { toast.success("Work ID assigned — the staff member can now use it with biometrics"); load(); }
  };

  const removeStaff = async (id: string, em: string) => {
    if (!confirm(`Permanently delete ${em}?`)) return;
    const { error } = await supabase.rpc("admin_delete_staff", { p_user: id });
    if (error) toast.error(error.message);
    else { toast.success("Staff deleted"); load(); }
  };

  const summon = async () => {
    if (!summonUser) return;
    const { error } = await supabase.rpc("admin_summon_staff", {
      p_user: summonUser,
      p_message: summonMsg.trim() || null,
    });
    if (error) toast.error(error.message);
    else { toast.success("Staff summoned"); setSummonMsg(""); load(); }
  };

  const createRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roomName.trim().length < 2) { toast.error("Room name required"); return; }
    if (roomDeptMode === "existing" && !roomServiceId) {
      toast.error("Choose a department");
      return;
    }
    if (roomDeptMode === "new" && newDeptName.trim().length < 2) {
      toast.error("Type the new department name");
      return;
    }
    const { data, error } = await supabase.rpc("admin_create_room", {
      p_name: roomName.trim(),
      p_service_id: roomDeptMode === "existing" ? roomServiceId : null,
      p_active: true,
      p_new_service_name: roomDeptMode === "new" ? newDeptName.trim() : null,
    });
    if (error) toast.error(error.message);
    else {
      const created = data as { name?: string; service?: string; new_service?: { name_en?: string } | null } | null;
      const dept = created?.new_service?.name_en || created?.service || "";
      toast.success(`Room added: ${created?.name || roomName.trim()}${dept ? ` · ${dept}` : ""}`);
      setRoomName("");
      setNewDeptName("");
      setRoomDeptMode("existing");
      load();
    }
  };

  const loadObserve = async (counterId: string) => {
    if (!counterId) { setObserveData(null); return; }
    setObserveLoading(true);
    const { data, error } = await supabase.rpc("admin_observe_queue", { p_counter: counterId });
    setObserveLoading(false);
    if (error) { toast.error(error.message); setObserveData(null); return; }
    setObserveData(data as typeof observeData);
  };

  const setRoomActive = async (counterId: string, active: boolean) => {
    const { error } = await supabase.rpc("admin_set_room_active", {
      p_counter_id: counterId,
      p_active: active,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(active ? "Room activated" : "Room deactivated");
      load();
    }
  };

  const exportCsv = () => {
    if (!stats?.visits?.length) { toast.error("No visits to export for this day"); return; }
    const headers = ["token","hospital_no","patient_name","service","status","triage","priority_reasons","payment","care_path","created_at"];
    const lines = [headers.join(",")];
    for (const v of stats.visits) {
      const row = [
        v.token, v.hospital_no || "", v.patient_name || "", v.service, v.status, v.triage_level,
        (v.triage_note || "").replace(/"/g, '""'), v.payment,
        (v.care_path || []).join(">"), v.created_at,
      ].map((c) => `"${c}"`);
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kijabe-patients-${stats.day}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Daily patient export downloaded");
  };

  const downloadBlob = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportTimesheetDaily = () => {
    const rows = timesheet?.rows ?? [];
    if (!rows.length) { toast.error("No staff hours in this range"); return; }
    const headers = ["name","email","day","hours","sessions","first_login","last_activity","still_online"];
    const lines = [headers.join(",")];
    for (const r of rows) {
      lines.push([
        r.name, r.email, r.day, String(r.hours), String(r.sessions),
        r.first_login, r.last_activity, r.still_online ? "yes" : "no",
      ].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
    }
    downloadBlob(`kijabe-staff-hours-${timesheet?.from}_to_${timesheet?.to}.csv`, lines.join("\n"));
    toast.success("Daily hours CSV downloaded");
  };

  const exportTimesheetWindows = () => {
    const rows = timesheet?.rows ?? [];
    if (!rows.length) { toast.error("No staff hours in this range"); return; }
    const headers = [
      "name","email","day","day_hours","session_from","session_to","session_minutes","room","still_online",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const wins = r.windows?.length ? r.windows : [{
        started_at: r.first_login,
        ended_at: r.last_activity,
        last_seen_at: r.last_activity,
        minutes: Math.round(Number(r.hours) * 60),
        room: null,
        open: r.still_online,
      }];
      for (const w of wins) {
        lines.push([
          r.name, r.email, r.day, String(r.hours),
          w.started_at,
          w.ended_at || (w.open ? "still online" : w.last_seen_at),
          String(w.minutes),
          w.room || "",
          w.open || r.still_online ? "yes" : "no",
        ].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","));
      }
    }
    downloadBlob(`kijabe-staff-login-windows-${timesheet?.from}_to_${timesheet?.to}.csv`, lines.join("\n"));
    toast.success("Login windows CSV downloaded");
  };

  const sheetTotals = useMemo(() => {
    const rows = timesheet?.rows ?? [];
    const byUser = new Map<string, { name: string; email: string; hours: number; days: number }>();
    for (const r of rows) {
      const cur = byUser.get(r.user_id) ?? { name: r.name, email: r.email, hours: 0, days: 0 };
      cur.hours += Number(r.hours) || 0;
      cur.days += 1;
      byUser.set(r.user_id, cur);
    }
    return [...byUser.values()].sort((a, b) => b.hours - a.hours);
  }, [timesheet]);

  return (
    <main className="min-h-screen bg-background">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b bg-card px-6 py-4">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">AIC Kijabe Hospital</p>
            <h1 className="font-display text-2xl font-bold">Superadmin Command</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <MoonPhaseLive />
          <Link to="/staff" className="text-sm font-semibold text-primary underline">Observe staff rooms</Link>
          <span className="text-sm text-muted-foreground">{email}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              await navigate({ to: "/staff", replace: true });
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Patients today" value={String(stats?.total_patients ?? "—")} />
          <StatCard label="On duty" value={String(board?.on_duty?.length ?? 0)} />
          <StatCard label="Absent staff" value={String(board?.absent_staff?.length ?? 0)} />
          <StatCard label="Vacant rooms" value={String(board?.empty_rooms?.length ?? 0)} accent={!!board?.empty_rooms?.length} />
        </section>

        {!!pending.length && (
          <section className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
            <h2 className="flex items-center gap-2 font-bold"><Users className="h-5 w-5" /> Pending approvals ({pending.length})</h2>
            <ul className="mt-3 divide-y">
              {pending.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-semibold">{s.full_name}</p>
                    <p className="text-sm text-muted-foreground">{s.email}{s.phone ? ` · ${s.phone}` : ""}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => setStatus(s.id, "approved")}><Check className="h-4 w-4" /> Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => setStatus(s.id, "rejected")}><X className="h-4 w-4" /> Reject</Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="observe">Observe</TabsTrigger>
            <TabsTrigger value="summon">Summon</TabsTrigger>
            <TabsTrigger value="timesheet">Staff hours</TabsTrigger>
            <TabsTrigger value="data">Patients & export</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-3">
            <Panel title="On duty now" icon={<DoorOpen className="h-4 w-4" />}>
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {(board?.on_duty ?? []).map((r) => (
                  <li key={r.user_id} className="flex justify-between gap-2">
                    <span>{r.name}</span>
                    <span className="text-muted-foreground">{r.room || "—"}</span>
                  </li>
                ))}
                {!board?.on_duty?.length && <li className="text-muted-foreground">Nobody checked in yet</li>}
              </ul>
            </Panel>
            <Panel title="Not yet at work" icon={<Users className="h-4 w-4" />}>
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {(board?.absent_staff ?? []).map((r) => (
                  <li key={r.user_id} className="flex items-center justify-between gap-2">
                    <span>{r.name}</span>
                    <Button size="sm" variant="outline" onClick={() => { setSummonUser(r.user_id); toast.message("Open Summon tab to call them"); }}>
                      <Bell className="h-3 w-3" />
                    </Button>
                  </li>
                ))}
                {!board?.absent_staff?.length && <li className="text-muted-foreground">All approved staff are on duty</li>}
              </ul>
            </Panel>
            <Panel title="Vacant rooms" icon={<DoorOpen className="h-4 w-4" />}>
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {(board?.empty_rooms ?? []).map((r) => (
                  <li key={r.counter_id}>
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-muted-foreground"> · {r.service}</span>
                  </li>
                ))}
                {!board?.empty_rooms?.length && <li className="text-muted-foreground">Every active room has someone</li>}
              </ul>
            </Panel>
          </TabsContent>

          <TabsContent value="staff" className="mt-4 space-y-4">
            <form onSubmit={createStaff} className="rounded-2xl border bg-card p-4">
              <h2 className="flex items-center gap-2 font-bold"><UserPlus className="h-5 w-5" /> Add staff manually</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Input placeholder="First name *" value={newFirst} onChange={(e) => setNewFirst(capitalizeName(e.target.value))} required minLength={2} />
                <Input placeholder="Last / middle name" value={newLast} onChange={(e) => setNewLast(capitalizeName(e.target.value))} />
                <Input placeholder="Surname" value={newSurname} onChange={(e) => setNewSurname(capitalizeName(e.target.value))} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">
                <div className="flex items-center gap-2 sm:col-span-1">
                  <span className="text-sm text-muted-foreground">+254</span>
                  <Input
                    inputMode="numeric"
                    placeholder="Phone"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, "").replace(/^0/, "").slice(0, 9))}
                  />
                </div>
                <Input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
                <Input type="password" placeholder="Temp password" value={newPass} onChange={(e) => setNewPass(e.target.value)} required minLength={8} />
                <Button type="submit">Create & approve</Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Staff pick any room when they check in — no room is locked to one person.</p>
            </form>
            <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Showing {visibleStaff.length}
                  {staffFilter === "approved" ? ` approved of ${staff.length} total` : ""}
                </p>
                <div className="flex gap-1">
                  {([
                    ["approved", "Approved"],
                    ["pending", "Pending"],
                    ["all", "All"],
                  ] as const).map(([key, label]) => (
                    <Button
                      key={key}
                      size="sm"
                      variant={staffFilter === key ? "default" : "outline"}
                      onClick={() => setStaffFilter(key)}
                    >
                      {label}
                      {key === "approved" ? ` (${approvedStaff.length})` : key === "pending" ? ` (${pending.length})` : ` (${staff.length})`}
                    </Button>
                  ))}
                </div>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="py-2">Staff</th><th>Phone</th><th>Work ID</th><th>Status</th><th>Duty</th><th></th></tr>
                </thead>
                <tbody className="divide-y">
                  {visibleStaff.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2">
                        <p className="font-semibold">{s.full_name}</p>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                      </td>
                      <td className="text-xs">{s.phone || "—"}</td>
                      <td><WorkIdCell staff={s} onSave={assignWorkId} /></td>
                      <td><StatusPill status={s.status} /></td>
                      <td>{s.on_duty ? <span className="text-success font-semibold">In · {s.current_room || "desk"}</span> : "Away"}</td>
                      <td className="space-x-1 whitespace-nowrap">
                        {(s.status || "").toLowerCase() !== "approved" && <Button size="sm" variant="outline" onClick={() => setStatus(s.id, "approved")}>Approve</Button>}
                        {(s.status || "").toLowerCase() === "approved" && <Button size="sm" variant="outline" onClick={() => setStatus(s.id, "suspended")}>Suspend</Button>}
                        {(s.status || "").toLowerCase() === "suspended" && <Button size="sm" variant="outline" onClick={() => setStatus(s.id, "approved")}>Reinstate</Button>}
                        <Button size="sm" variant="destructive" onClick={() => removeStaff(s.id, s.email)}><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                  {!visibleStaff.length && (
                    <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No staff in this filter</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="rooms" className="mt-4 space-y-4">
            <form onSubmit={createRoom} className="rounded-2xl border bg-card p-4 space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><Plus className="h-5 w-5" /> Add room</h2>
              <p className="text-sm text-muted-foreground">
                When the hospital expands, add a new room or counter here. Pick an existing department, or type a
                brand-new department that does not exist yet.
              </p>
              <Input
                placeholder="Room name (e.g. Consultation Room 12)"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                required
                minLength={2}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={roomDeptMode === "existing" ? "default" : "outline"}
                  onClick={() => setRoomDeptMode("existing")}
                >
                  Existing department
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={roomDeptMode === "new" ? "default" : "outline"}
                  onClick={() => setRoomDeptMode("new")}
                >
                  Type new department
                </Button>
              </div>
              {roomDeptMode === "existing" ? (
                <Select value={roomServiceId} onValueChange={setRoomServiceId}>
                  <SelectTrigger className="max-w-md"><SelectValue placeholder="Department / service" /></SelectTrigger>
                  <SelectContent>
                    {services.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name_en} ({s.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  className="max-w-md"
                  placeholder="New department name (e.g. Dermatology Clinic)"
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  required
                  minLength={2}
                />
              )}
              <Button
                type="submit"
                disabled={
                  !roomName.trim()
                  || (roomDeptMode === "existing" ? !roomServiceId : newDeptName.trim().length < 2)
                }
              >
                <Plus className="h-4 w-4" /> Add room
              </Button>
            </form>

            <div className="rounded-2xl border bg-card p-4 space-y-4">
              <div>
                <h2 className="font-bold">Room occupancy</h2>
                <p className="text-sm text-muted-foreground">
                  Staff choose any active room at check-in. Deactivate a room to hide it without deleting history.
                </p>
              </div>
              <ul className="divide-y text-sm">
                {rooms.map((r) => (
                  <li key={r.counter_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{r.service}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {r.occupied ? (
                        <span className="rounded-full bg-destructive/10 px-3 py-1 text-xs font-bold uppercase text-destructive">
                          Occupied · {r.occupant || r.occupant_email || "staff"}
                        </span>
                      ) : (
                        <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-bold uppercase text-success">Vacant</span>
                      )}
                      <Button size="sm" variant="outline" onClick={() => setRoomActive(r.counter_id, false)}>
                        Deactivate
                      </Button>
                    </div>
                  </li>
                ))}
                {!rooms.length && (
                  <li className="py-6 text-center text-muted-foreground">No active rooms yet — add one above</li>
                )}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="observe" className="mt-4 space-y-4">
            <div className="rounded-2xl border bg-card p-4 space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><Eye className="h-5 w-5" /> Observe any staff room</h2>
              <p className="text-sm text-muted-foreground">
                View-only: see who is on duty, patients in line, and full ticket details. You cannot call, treat,
                transfer, or change anything from here.
              </p>
              <div className="flex flex-wrap gap-2">
                <Select
                  value={observeRoomId}
                  onValueChange={(id) => {
                    setObserveRoomId(id);
                    void loadObserve(id);
                  }}
                >
                  <SelectTrigger className="max-w-md"><SelectValue placeholder="Choose room to observe" /></SelectTrigger>
                  <SelectContent>
                    {rooms.map((r) => (
                      <SelectItem key={r.counter_id} value={r.counter_id}>
                        {r.name} · {r.service}{r.occupied ? " · occupied" : " · vacant"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!observeRoomId || observeLoading}
                  onClick={() => void loadObserve(observeRoomId)}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {observeLoading && <p className="text-sm text-muted-foreground">Loading room…</p>}

            {observeData && !observeLoading && (
              <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                <section className="rounded-2xl border bg-card p-5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {observeData.room} · {observeData.service}
                  </p>
                  <p className="mt-1 text-sm">
                    {observeData.occupied ? (
                      <span className="font-semibold text-destructive">
                        Staff on duty: {observeData.occupant || observeData.occupant_email || "staff"}
                      </span>
                    ) : (
                      <span className="font-semibold text-success">Room vacant — no staff checked in</span>
                    )}
                  </p>
                  <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
                    Observation only — management actions are disabled
                  </div>
                  {(() => {
                    const current = observeData.tickets.find((t) => t.status === "serving" || t.status === "called");
                    if (!current) {
                      return <p className="mt-8 text-center text-muted-foreground">No patient at this desk right now</p>;
                    }
                    const pname = [current.patient_first, current.patient_last, current.patient_surname].filter(Boolean).join(" ");
                    return (
                      <div className="mt-4 space-y-3">
                        <div className="flex items-end justify-between gap-3">
                          <p className="font-display text-6xl font-extrabold text-primary">{current.token}</p>
                          <span className="rounded-full bg-accent/30 px-3 py-1 text-sm font-semibold capitalize">{current.status}</span>
                        </div>
                        {current.hospital_no && <p className="text-sm">Hospital #: <b>{current.hospital_no}</b></p>}
                        {pname && <p className="text-sm">Patient: <b>{pname}</b>{current.patient_phone ? ` · ${current.patient_phone}` : ""}</p>}
                        <p className="text-sm text-muted-foreground">
                          {PRIORITY_LABEL[current.priority] ?? `Priority ${current.priority}`}
                          {" · "}{PAYMENT_LABEL[current.payment] ?? current.payment}
                          {current.insurer_name || current.payment_detail ? ` (${current.insurer_name || current.payment_detail})` : ""}
                          {" · "}{current.visit_type === "booked" ? "Appointment" : "Walk-in"}
                          {current.triage_level ? ` · triage ${current.triage_level}` : ""}
                        </p>
                        {current.triage_note && (
                          <p className="rounded-lg bg-muted p-2 text-sm">Reasons: {current.triage_note}</p>
                        )}
                        {!!current.care_path?.length && (
                          <p className="text-sm">
                            Care path:{" "}
                            {current.care_path.map((c, i) => (
                              <span key={`${c}-${i}`} className={i === current.path_step ? "font-bold text-primary" : "text-muted-foreground"}>
                                {i ? " → " : ""}{c}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </section>

                <section className="rounded-2xl border bg-card p-5">
                  <h3 className="font-bold">
                    Waiting ({observeData.tickets.filter((t) => t.status === "waiting").length})
                  </h3>
                  <ul className="mt-3 max-h-[70vh] divide-y overflow-y-auto">
                    {observeData.tickets.filter((t) => t.status === "waiting").map((t) => {
                      const pname = [t.patient_first, t.patient_last, t.patient_surname].filter(Boolean).join(" ");
                      return (
                        <li key={t.id} className="py-3 text-sm">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-display text-lg font-bold">{t.token}</p>
                              {t.hospital_no && <p className="text-xs text-muted-foreground">Hosp. {t.hospital_no}</p>}
                              {pname && <p className="text-xs">{pname}</p>}
                              {t.triage_note && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{t.triage_note}</p>}
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <p>{PRIORITY_LABEL[t.priority] ?? t.priority}</p>
                              <p>{PAYMENT_LABEL[t.payment] ?? t.payment}</p>
                              <p>{new Date(t.queued_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</p>
                              {t.appointment_at && (
                                <p>Appt {new Date(t.appointment_at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</p>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {!observeData.tickets.some((t) => t.status === "waiting") && (
                      <li className="py-8 text-center text-muted-foreground">No patients waiting in this room’s queue</li>
                    )}
                  </ul>
                </section>
              </div>
            )}
          </TabsContent>

          <TabsContent value="summon" className="mt-4 rounded-2xl border bg-card p-4 space-y-3">
            <h2 className="flex items-center gap-2 font-bold"><Megaphone className="h-5 w-5" /> Summon staff</h2>
            <p className="text-sm text-muted-foreground">
              All {approvedStaff.length} approved staff are listed. They’ll see the call on their Notifications tab and banner.
            </p>
            <Select value={summonUser} onValueChange={setSummonUser}>
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder={approvedStaff.length ? "Choose approved staff" : "No approved staff yet"} />
              </SelectTrigger>
              <SelectContent>
                {approvedStaff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name} · {s.email} {s.on_duty ? "(on duty)" : "(away)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!approvedStaff.length && (
              <p className="text-sm text-destructive">Approve staff under the Staff tab before summoning.</p>
            )}
            <Input placeholder="Message (optional)" value={summonMsg} onChange={(e) => setSummonMsg(e.target.value)} className="max-w-xl" />
            <Button onClick={summon} disabled={!summonUser}><Bell className="h-4 w-4" /> Send summon</Button>
          </TabsContent>

          <TabsContent value="timesheet" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
              <div>
                <label className="text-xs font-semibold">From</label>
                <Input type="date" value={sheetFrom} onChange={(e) => setSheetFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold">To</label>
                <Input type="date" value={sheetTo} onChange={(e) => setSheetTo(e.target.value)} />
              </div>
              <Button variant="outline" onClick={() => void loadTimesheet()} disabled={sheetLoading}>
                {sheetLoading ? "Loading…" : "Refresh"}
              </Button>
              <Button variant="outline" onClick={exportTimesheetDaily}>
                <Download className="h-4 w-4" /> Daily hours CSV
              </Button>
              <Button onClick={exportTimesheetWindows}>
                <Download className="h-4 w-4" /> Login windows CSV
              </Button>
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-4 w-4" />
                Tracked while staff are checked into a room (Nairobi time)
              </p>
            </div>

            {!!sheetTotals.length && (
              <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
                <h3 className="font-bold mb-2">
                  Period totals · {timesheet?.from} → {timesheet?.to}
                </h3>
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">Staff</th>
                      <th>Days worked</th>
                      <th>Total hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sheetTotals.map((t) => (
                      <tr key={t.email}>
                        <td className="py-2">
                          <p className="font-semibold">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.email}</p>
                        </td>
                        <td>{t.days}</td>
                        <td className="font-display text-lg font-bold text-primary">{t.hours.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
              <h3 className="font-bold mb-2">
                Daily detail ({timesheet?.rows?.length ?? 0} rows)
              </h3>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1">Staff</th>
                    <th>Day</th>
                    <th>Hours</th>
                    <th>First login</th>
                    <th>Last activity</th>
                    <th>Sessions</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(timesheet?.rows ?? []).map((r) => {
                    const key = `${r.user_id}-${r.day}`;
                    const open = expandedSheet === key;
                    return (
                      <Fragment key={key}>
                        <tr>
                          <td className="py-2">
                            <p className="font-semibold">{r.name}</p>
                            <p className="text-xs text-muted-foreground">{r.email}</p>
                            {r.still_online && (
                              <span className="mt-0.5 inline-block rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                                Online now
                              </span>
                            )}
                          </td>
                          <td>{nairobiDate(r.day)}</td>
                          <td className="font-display text-base font-bold text-primary">{Number(r.hours).toFixed(2)}</td>
                          <td>{nairobiTime(r.first_login)}</td>
                          <td>{nairobiTime(r.last_activity)}</td>
                          <td>{r.sessions}</td>
                          <td>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExpandedSheet(open ? null : key)}
                            >
                              {open ? "Hide" : "Windows"}
                            </Button>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={7} className="bg-muted/40 px-3 py-3">
                              <ul className="space-y-2 text-sm">
                                {(r.windows ?? []).map((w, i) => (
                                  <li key={`${key}-w-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                                    <span className="font-semibold">
                                      {nairobiTime(w.started_at)} → {w.open || !w.ended_at ? "still online" : nairobiTime(w.ended_at)}
                                    </span>
                                    <span className="text-muted-foreground">{w.minutes} min</span>
                                    <span className="text-muted-foreground">{w.room || "desk"}</span>
                                    {w.open && (
                                      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase text-success">
                                        Open
                                      </span>
                                    )}
                                  </li>
                                ))}
                                {!r.windows?.length && (
                                  <li className="text-muted-foreground">No session windows recorded</li>
                                )}
                              </ul>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {!timesheet?.rows?.length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground">
                        No staff login hours in this range yet — hours start when staff check into a room
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="data" className="mt-4 space-y-4">
            <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-4">
              <div>
                <label className="text-xs font-semibold">Day (Nairobi)</label>
                <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
              </div>
              <Button variant="outline" onClick={load}>Refresh</Button>
              <Button onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>
              <p className="text-sm text-muted-foreground flex items-center gap-1"><Moon className="h-4 w-4" /> Includes triage / walk-in reasons as medication & visit context</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniMap title="By triage" data={stats?.by_triage ?? {}} />
              <MiniMap title="By payment" data={stats?.by_payment ?? {}} />
              <MiniMap title="By status" data={stats?.by_status ?? {}} />
            </div>
            <div className="rounded-2xl border bg-card p-4 overflow-x-auto">
              <h3 className="font-bold mb-2">Visits · {stats?.total_patients ?? 0}</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="py-1">Token</th><th>Hosp #</th><th>Patient</th><th>Service</th><th>Triage</th><th>Reasons</th><th>Payment</th></tr>
                </thead>
                <tbody className="divide-y">
                  {(stats?.visits ?? []).map((v, i) => (
                    <tr key={`${v.token}-${i}`}>
                      <td className="py-1 font-display font-bold">{v.token}</td>
                      <td>{v.hospital_no || "—"}</td>
                      <td>{v.patient_name || "—"}</td>
                      <td>{v.service}</td>
                      <td>{v.triage_level}</td>
                      <td className="max-w-[14rem] truncate" title={v.triage_note || ""}>{v.triage_note || "—"}</td>
                      <td>{v.payment}</td>
                    </tr>
                  ))}
                  {!stats?.visits?.length && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">No patients this day</td></tr>}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function WorkIdCell({ staff, onSave }: { staff: StaffRow; onSave: (id: string, workId: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (value.trim().length < 4) return;
    setBusy(true);
    try {
      await onSave(staff.id, value.trim());
      setValue("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        className="h-8 w-28 text-xs"
        placeholder={staff.work_id_last4 ? `••••${staff.work_id_last4}` : "Not set"}
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase().replace(/[^A-Z0-9/-]/g, "").slice(0, 24))}
        aria-label={`Work ID for ${staff.full_name}`}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 px-2 text-xs"
        disabled={busy || value.trim().length < 4}
        onClick={() => void save()}
      >
        {busy ? "…" : "Set"}
      </Button>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-destructive/40 bg-destructive/5" : "bg-card"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold text-primary">{value}</p>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 font-bold">{icon}{title}</h3>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "approved" ? "bg-success/15 text-success" :
    status === "pending" ? "bg-accent/30 text-accent-foreground" :
    status === "suspended" ? "bg-destructive/15 text-destructive" :
    "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${cls}`}>{status}</span>;
}

function MiniMap({ title, data }: { title: string; data?: Record<string, number> }) {
  const entries = Object.entries(data || {});
  return (
    <div className="rounded-xl border bg-card p-3 text-sm">
      <p className="font-semibold">{title}</p>
      <ul className="mt-2 space-y-1">
        {entries.map(([k, v]) => (
          <li key={k} className="flex justify-between"><span>{k}</span><span className="font-bold">{v}</span></li>
        ))}
        {!entries.length && <li className="text-muted-foreground">—</li>}
      </ul>
    </div>
  );
}
