# Kijabe Hospital Queue System – Roadmap

- [x] Check-in kiosk (English/Kiswahili, service, walk-in/booked, payment, priority, phone, printable token + QR)
- [x] TV display (now calling, per-department queues, voice announcement)
- [x] Staff console (login, choose counter, call next / recall / serve / complete / no-show / transfer)
- [x] Patient ticket status page + feedback after visit
- [x] Audit trail of staff queue actions (action, time, staff account; no patient names or visit details), read-only
- [x] Queue advisor (AI non-clinical workflow suggestions for staff)
- [x] Kiosk phone entry starts with +254
- [x] Favicon
- [x] Automations: auto-recall, auto no-show, missed patients re-called, nightly close, doctor → billing routing, long-wait alerts, surge overflow desks
- [x] Public read-only public queue API
- [x] AI policy assistant for automation thresholds (admins)
- [x] Server-side scheduler (every minute, clinic hours)
- [x] Automation settings page per department
- [x] Simulation mode with sample tickets

## Stage 1 – patient registry & care path
- [x] Kiosk: full name + phone/card/ID lookup; returning patients skip registration, new ones register (card number issued)
- [x] "Been here before / last visit" + appointment time & department
- [x] Colour triage: RED (severe pain, unconscious, bleeding by severity, breathing) > ORANGE (65+, pregnant, disability, mother & infant) > GREEN
- [x] Care path: consultation = triage → doctor → payment desk → (lab/pharmacy/inpatient chosen by staff); pharmacy/lab = payment desk first; ticket closes after last step
- [x] Unique running ticket numbers (6-digit); active tickets never wiped at midnight (24/7)
- [x] Staff: skip non-responding patient & call next; escalate to emergency; send to next step
- [x] All Kijabe departments, clinics and rooms

## Stage 2 – payments
- [x] M-Pesa STK push at cashier (Daraja sandbox); insurance/SHA verification; cash ATM pad; estimated prices per department; payment required before completing payment-desk step

## Stage 3 – calling
- [x] Loud female voice reading tokens letter/digit by letter on TV; live phone tracking (realtime + poll fallback)
