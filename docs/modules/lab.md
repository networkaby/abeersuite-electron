# Lab — Front Office / Back Office prototype

> Experimental workspace exploring a "universal helper" UI pattern: one search box + a customer concierge panel + quick-action tiles that any staff member can use without picking a module first. **Prototype only** — not part of the production `/office` flow yet. Lives under `/lab` so it's reachable from the address bar but invisible from the sidebar.

## URLs

- `/lab` — redirects to `/lab/front`.
- `/lab/front` — Front Office prototype: `UniversalHelperSearch` (persistent search list with product + device + ticket + customer hits) + heads-up customer strip + channel picker.
- `/lab/back` — Back Office prototype: department-briefing variant for back-office roles.

The `LabTopBar` component lets the user toggle between `/lab/front` and `/lab/back`.

## Module folder

`src/modules/lab/components/`:
- `UniversalHelperSearch.tsx` — single search input with multi-source results (products, devices, tickets, customers).
- `CandidateRow.tsx` — search-hit row renderer.
- `CustomerContextPanel.tsx` — selected-customer side panel.
- `CustomerHeadsUpStrip.tsx` — top-of-page heads-up for the currently-focused customer.
- `InteractionChannelPicker.tsx` — pick the channel (phone / WhatsApp / in-store / etc.) for the current interaction.
- `LabTopBar.tsx` — front/back toggle.
- `QuickActionTiles.tsx` — large clickable tiles for common actions.
- `QuickTicketDialog.tsx` — inline ticket creation.
- `RegisterCustomerDialog.tsx` — inline customer registration.
- `TodaysPulse.tsx` — daily-numbers widget.

`src/modules/lab/lib/buildCandidates.ts` — search-result normaliser across product / device / ticket / customer sources.

## Permissions

None. `/lab/*` is gated only by the staff session check in `src/app/(protected)/lab/layout.tsx` (redirects customers to `/portal` and unauthenticated users to `/staff/login`). Any logged-in staff can reach it.

## Why it's here

The prototype tests whether a single "type what you need" entry beats today's module-first navigation for front-desk and back-office staff who don't know which module owns a given customer touchpoint. Once a decision is made, this folder will either:

- **Promote** to a real module under `/office/<name>/` and integrate with the existing sidebar, OR
- **Delete** entirely if the prototype is rejected.

Either way, `/lab` is not a long-term URL.

## Out of scope

- Production hardening — no permission gates beyond staff session, no analytics, no permissions matrix integration.
- Mobile — desktop only.
- Customer-side equivalent — staff-only experiment.

_Last updated: 2026-05-19 — initial doc covering the 2026-05-15 prototype (commits `6207ed9`, `052cbf0`, `8c92757`, `48bca63`, `fd4c1b5`)._
