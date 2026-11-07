<div align="center">
  <img src="./assets/readme-hero.svg" alt="Kijabe Care Flow — neon outpatient queue banner" width="100%" />
</div>

<div align="center">
  <img src="./public/favicon.png" width="88" height="88" alt="Kijabe Care Flow logo" />
</div>

<h1 align="center">KIJABE CARE FLOW</h1>

<p align="center">
  <strong>Outpatient queue intelligence for AIC Kijabe Hospital.</strong><br/>
  Registration, kiosk check-in, staff console and room displays — one live queue, from the front door to the pharmacy window.
</p>

<p align="center">
  <a href="#the-flow"><img alt="Queue engine" src="https://img.shields.io/badge/QUEUE_ENGINE-ATOMIC-159ed5?style=for-the-badge&labelColor=071f33" /></a>
  <a href="#the-stack"><img alt="TanStack Start" src="https://img.shields.io/badge/TANSTACK_START-1.x-0c729c?style=for-the-badge&labelColor=071f33" /></a>
  <img alt="React 19" src="https://img.shields.io/badge/REACT-19-159ed5?style=for-the-badge&labelColor=071f33" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TYPESCRIPT-STRICT-60a5fa?style=for-the-badge&labelColor=071f33" />
  <img alt="PostgreSQL" src="https://img.shields.io/badge/POSTGRESQL-RLS-0c729c?style=for-the-badge&labelColor=071f33" />
  <img alt="PWA" src="https://img.shields.io/badge/PWA-INSTALLABLE-7cf5d5?style=for-the-badge&labelColor=071f33" />
</p>

<p align="center">
  <em>“Health Care to God’s Glory.”</em>
</p>

---

## The flow

A patient should never have to ask where to go next. Care Flow answers that with a single ticket that travels the hospital faster than the patient does.

```mermaid
flowchart LR
  R["Registration<br/>new patient, Kiswahili-first"] --> K["Kiosk check-in<br/>ticket + QR"]
  K --> Q{"Queue engine<br/>atomic numbering"}
  Q --> C["Staff console<br/>call · recall · transfer · complete"]
  C --> M["M-Pesa billing<br/>STK push"]
  Q --> D["Room display<br/>live board"]
  Q --> T["Ticket status<br/>phone page"]
  C --> A["Automation<br/>per-department thresholds"]
  A --> Q

  classDef lane fill:#08243a,stroke:#159ed5,stroke-width:1.5px,color:#eaf7ff;
  class R,K,Q,C,M,D,T,A lane;
```

Every state change is a database function with an audit row underneath it — the neon is the interface, the trail is the truth.

---

## Built for the floor, not the demo

| Lane | What the user sees | Guardrail underneath |
| --- | --- | --- |
| **Registration** | A calm, bilingual intake that leads with Kiswahili for new patients | Registrar-scoped access; nothing queues until registration lands |
| **Kiosk** | One tap issues a ticket with a phone-scannable QR | Anonymous by design, RPC-only, no direct table reads |
| **Queue engine** | Fair, atomic ticket numbers per department | Postgres security-definer functions; numbering and calling cannot race |
| **Staff console** | Call, recall, transfer, complete — with the next patient always one key away | A staff or admin role row is required; a login alone grants nothing |
| **Billing** | M-Pesa STK push from the consult desk | Initiated server-side; callbacks reconcile payment state |
| **Displays** | A live room board that reads from across the ward | Polls a status endpoint; no patient identifiers on screen |
| **Ticket status** | Patients track their own ticket from a phone | RPC-only; phone numbers stay hidden from the public |
| **Automation** | Departments tune their own wait thresholds | Bounded validation, admin-only writes, simulation mirrors the DB checks |

### The audit rule

`ticket_events` is append-only: staff can read it, never rewrite it, and it must never hold patient identifiers. Compliance is a schema decision, not a policy PDF.

---

## The stack

```mermaid
flowchart TB
  subgraph Edge["Patient-facing surfaces"]
    KI["Kiosk"]
    TV["TV / room display"]
    ST["Ticket status"]
  end

  subgraph Core["TanStack Start server"]
    RT["Router + SSR"]
    SF["Server functions"]
    QF["Queue RPCs"]
    AI["Gemini advisor"]
    MP["M-Pesa STK"]
  end

  DB[("PostgreSQL<br/>RLS + security-definer functions")]

  KI --> QF
  TV --> QF
  ST --> QF
  RT --> SF
  SF --> QF
  SF --> AI
  SF --> MP
  QF --> DB
  MP --> DB

  classDef surface fill:#08243a,stroke:#60a5fa,color:#eaf7ff;
  classDef core fill:#0b2c48,stroke:#159ed5,color:#eaf7ff;
  class KI,TV,ST surface;
  class RT,SF,QF,AI,MP core;
```

- **TanStack Start + React 19** — full-stack routing, SSR and server functions in one tree.
- **TypeScript, strict** — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on.
- **PostgreSQL** with row-level security; queue transitions live in SQL functions, not in the client.
- **Tailwind CSS 4** with a Kijabe palette (`#159ed5`, `#0c729c`, `#60a5fa`, `#102a43`).
- **PWA** — installable kiosk and display shells.
- **Gemini** — server-side queue advisor; keys never reach the browser.
- **M-Pesa Daraja** — STK push and callback reconciliation.
- **WebAuthn** — biometric work-ID sign-in for staff.

---

## Quick start

```sh
git clone https://github.com/Luffy254-cyber-spec/KijabeHospitalQueue.git
cd KijabeHospitalQueue
npm install
cp .env.example .env        # then fill in the values below
npm run db:bootstrap        # create schema, roles and helper functions
npm run dev                 # http://localhost:8080
```

Use `npm run dev -- --port 8081` if you prefer the kiosk port used on the LAN.

### Environment

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Local `kijabe_care_flow` database by default |
| `AUTH_SECRET` | Signs local staff session tokens | Replace the development value before deploying |
| `GEMINI_API_KEY` | Queue advisor + announcements | Server-only; never expose to the client |
| `MPESA_ENV` | `sandbox` or `production` | Selects the Daraja host |
| `MPESA_SHORTCODE` | Paybill / till number | — |
| `MPESA_PASSKEY` | Lipa na M-Pesa passkey | Must match the chosen environment and shortcode |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja app credentials | Sandbox and production keys differ |
| `MPESA_CALLBACK_URL` | Public HTTPS endpoint | Must end in `/api/mpesa/callback` |
| `VITE_PUBLIC_APP_URL` | Origin encoded into ticket QR codes | LAN IP for kiosks, public domain when hosted |
| `PUBLIC_APP_URL` | Origin used in staff verification emails | Must be a host Firebase allows |

Secrets belong in `.env` (ignored by git) or in your host’s environment settings — never in a commit.

### Useful scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build (Nitro output) |
| `npm run preview` | Preview the built server |
| `npm run lint` | ESLint |
| `npm run test` | Vitest |
| `npm run db:bootstrap` | Local database bootstrap |

---

## Design language

The interface borrows the hospital’s own identity — the cross-and-continent mark, the deep `#102a43` navy, the `#159ed5` cyan — and pushes it forward: neon ECG traces, glassy ticket cards, a live board that feels closer to a mission-control wall than a waiting-room sign.

Small details matter here:

- The landing page carries the hospital’s floating **Feedback** and **Email** pills, with the same gradient, expansion and easing as kijabehospital.or.ke.
- Footer social links idle in a single uniform navy and only ignite to their brand color on hover, with a sticky zoom and a one-shot 3D flip.
- Motion is decorative, never load-bearing: everything degrades under `prefers-reduced-motion`.

---

## Privacy posture

- Public surfaces (kiosk, display, ticket status) speak only through RPCs and never expose phone numbers or patient identifiers.
- Staff actions require a role row; open sign-up grants nothing.
- AI prompts and API keys live server-side, behind staff authentication.
- Every queue transition writes an audit event; the audit trail holds no patient details.

---

## Deployment notes

- **Vercel** — the build currently targets Nitro’s `cloudflare-module` preset. Set a Vercel/Nitro preset (or let Nitro auto-detect) before deploying there.
- **Firebase Hosting** — `kijabeoutflow.firebaseapp.com` is Firebase’s default domain, not a Node runtime; it cannot serve `/api/mpesa/callback` on its own. Use Cloud Functions/Cloud Run, or point M-Pesa at the Vercel deployment.
- **Database** — either deployment needs a reachable PostgreSQL instance; a local `localhost` database will not be reachable from the cloud.
- **Daraja** — the M-Pesa callback must be public HTTPS, and the passkey/shortcode pair must match `MPESA_ENV`.

---

## License

MIT — see [LICENSE](./LICENSE).

<div align="center">
  <sub>AIC Kijabe Hospital · Kijabe, Kiambu County, Kenya</sub><br/>
  <sub><strong>Care Flow</strong> — the queue moves like a pulse.</sub>
</div>
