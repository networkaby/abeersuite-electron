# Segment 02 — Utility quick wins

## Goal

Add three small formatters to existing shared format utilities, then replace ~20 inline duplicates. Eliminates "every component reinvents `Intl.NumberFormat('en-IN', …)`" and "every client reinvents `formatTime`".

## Files modified

- `src/shared/lib/format/moneyInr.ts` — add `formatRupees(rupees: number): string`
- `src/shared/lib/format/formatDate.ts` — add `formatInboxTime(iso: string): string` and `formatTimeOnly(iso: string): string`

## Files swept (replace inline → import)

### `Intl.NumberFormat("en-IN", …)` → `formatRupees`

- `src/app/(protected)/office/(core)/call-log/page.tsx` (lines 48-54: `formatCurrency`)
- `src/app/(external)/portal/wallet/page.tsx` (lines 9-11: `formatInr`)
- `src/app/(external)/portal/orders/page.tsx` (lines 10-12: `formatInr`)
- `src/modules/inventory/components/InvProductCombobox.tsx`
- `src/app/(protected)/office/ecommerce/orders/page.tsx`
- `src/app/(protected)/office/ecommerce/coupons/page.tsx`
- `src/app/(protected)/office/(crm)/crm/page.tsx`
- (audit any remaining inline `Intl.NumberFormat("en-IN"` matches; should be 7-10 more)

### Inline `formatTime` → `formatInboxTime` / `formatTimeOnly`

- `src/modules/message/components/InboxModule.tsx` (lines 52-61, smart variant) → `formatInboxTime`
- `src/app/(protected)/office/(social)/users/[id]/page.tsx` (lines 109-111, simple variant) → `formatTimeOnly`

## Step-by-step

1. Add to `src/shared/lib/format/moneyInr.ts`:
   ```ts
   export function formatRupees(rupees: number): string {
     return new Intl.NumberFormat("en-IN", {
       style: "currency", currency: "INR",
       minimumFractionDigits: 0, maximumFractionDigits: 0,
     }).format(rupees);
   }
   ```
2. Add to `src/shared/lib/format/formatDate.ts`:
   ```ts
   export function formatInboxTime(iso: string): string {
     const utc = iso && !iso.endsWith("Z") && !iso.includes("+") ? iso + "Z" : iso;
     const date = new Date(utc);
     const now = new Date();
     if (date.toDateString() === now.toDateString()) {
       return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
     }
     return date.toLocaleDateString([], { month: "short", day: "numeric" });
   }
   export function formatTimeOnly(iso: string): string {
     return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
   }
   ```
3. Sweep each file in the list — delete the inline function, add the import.
4. `npx tsc --noEmit`, `npm run build`.

## Verification

- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser: call-log page renders amounts as `₹1,234`
- [ ] Browser: portal wallet + portal orders render amounts
- [ ] Browser: inbox shows "10:42 AM" today, "Mar 5" yesterday/older
- [ ] Browser: user page shows time-only timestamps

## Out of scope

- The 31 files using inline `toLocaleDateString()` for **dates** (not times). Many use bespoke formats (accountancy reports). Audit case-by-case in a future minor pass — not in this PR.

---

## Post-execution notes (2026-05-10)

Status: **complete** — `tsc --noEmit` clean, `npm run build` clean, dev server compiles call-log + inbox without errors.

What actually got swept (smaller than the plan estimated):

- **Currency** — only 3 inline `Intl.NumberFormat("en-IN", …)` call sites existed, not 7–10:
  - `src/app/(protected)/office/(core)/call-log/page.tsx` — `formatCurrency` removed, replaced with `formatRupees` (rupee input, no decimals).
  - `src/app/(external)/portal/wallet/page.tsx` — `formatInr` removed, replaced.
  - `src/app/(external)/portal/orders/page.tsx` — `formatInr` removed, replaced.
  - The plan also mentioned `InvProductCombobox.tsx`, `ecommerce/orders/page.tsx`, `ecommerce/coupons/page.tsx`, `(crm)/crm/page.tsx`. Grep confirms those don't have inline `Intl.NumberFormat` — they already use `formatRupeesFromPaise` (paise input).
- **Time** — both files swept as planned:
  - `src/modules/message/components/InboxModule.tsx` — inline `formatTime` removed, replaced with `formatInboxTime` (preserves Supabase UTC fix).
  - `src/app/(protected)/office/(social)/users/[id]/page.tsx` — inline `formatTime` removed, replaced with `formatTimeOnly`.

Helpers added:

- `formatRupees(rupees)` in `src/shared/lib/format/moneyInr.ts` — rupee input, no decimals (companion to existing `formatRupeesFromPaise`).
- `formatInboxTime(iso)` in `src/shared/lib/format/formatDate.ts` — smart inbox/chat timestamp, today→time, older→short date.
- `formatTimeOnly(iso)` in `src/shared/lib/format/formatDate.ts` — `10:42 AM` style.

Per AGENTS.md "after every plan" rule:

- **Reusables registry** — `docs/reusables.md` created (a stub keyed off what's currently in `src/shared/`). Segment 16 will expand it as later segments add api/, constants/, schemas/, hooks/, etc. The three new formatters above are listed.
- **Module docs** — none touched; this segment doesn't add module-specific behavior.
- **Todo list** — completed throughout.
