# POS (Point of Sale)

> Counter-side sale screen. Search a customer, build a cart of inventory items, take cash / card / cheque / bank-transfer / wallet payment, post the sale to the GL.

## URLs

### UI pages
- `/office/pos` — the single-page POS register. Full-screen, keyboard-driven (Ctrl+Enter checkout). File: `src/app/(protected)/office/pos/page.tsx` (thin wrapper) + `src/modules/pos/components/PosScreen.tsx` (client component).

### API routes
- `GET /api/people?lookup=…` — debounced party search consumed by shared `PartySearchAndCreate` (`src/shared/components/PartySearchAndCreate.tsx`).
- `GET /api/pos/account-snapshot/[accountId]` — full customer profile (balance, credit limit, turnover, loyalty, recent tickets, warranty alerts, personalised offers).
- `GET /api/pos/person-snapshot/[id]` — same as above but keyed on `personId` (for company-linked persons).
- `GET /api/pos/people/search?q=…` — alternate search endpoint (kept for back-compat with older POS calls).
- `POST /api/pos/sale` — submit the cart. Creates `InvVoucher` (type=SALE) + posts the GL via `postInvoiceJe` + adjusts stock.

## Permissions (gate keys)
- No dedicated POS permissions today; the page falls back to `requireAuth()`. POS-specific keys (e.g. `pos:sell`, `pos:discount`) are a future concern.

## Prisma models
- `InvVoucher` (file: `prisma/schema/inventory.prisma`) — the receipt; `type = "SALE"`, `journalEntryId` back-links the GL post.
- `InvVoucherLine` — one row per cart item; carries qty, rate, tax, discount.
- `JournalEntry` + `JournalLine` — GL post created by `postInvoiceJe` (one per voucher).
- `Account` — party ledger (debited) + Sales A/c (credited) + Cash/Bank ledger (debited on payment).
- `Person` / `Company` — selected via party picker; linked to the voucher via `accountId`.

## Key components
- `PosScreen` (file: `src/modules/pos/components/PosScreen.tsx`) — the entire POS UI. Sections: party search + snapshot panel, cart, totals + tax, payment splits, and recent-tickets sidebar.
- `PartySearchAndCreate` (`src/shared/components/PartySearchAndCreate.tsx`) — shared party omnibox used by POS. Handles search, keyboard navigation, and inline Person/Company creation.

## Library / helpers
- POS itself has no `lib/` — single-screen module per Segment 10 audit.
- Consumes: `postInvoiceJe` (`src/modules/accountancy/lib/postInvoiceJe.ts`) and shared `PartySearchAndCreate` (`src/shared/components/PartySearchAndCreate.tsx`), which internally uses `usePartySearch`.

## Common workflows (wiring)
1. **Take a sale**: search person/company by name/phone/email → pick from dropdown → snapshot panel loads (balance, credit limit, alerts) → add items (`InvProductCombobox`) → pick payment method → **Ctrl+Enter** opens checkout → `POST /api/pos/sale` → voucher + GL post + stock decrement → success toast + print receipt.
2. **New customer on the fly**: type a party with no matches (or click "New customer") → inline dialog in `PartySearchAndCreate` → creates Person and optionally Company (+ link when both are created) → POS locks the picked party and focuses product search.

## Recent decisions / gotchas
- **PosScreen is UX-critical** — party search/create logic is now centralized in shared `PartySearchAndCreate`. Any future changes must preserve current keyboard flow (pick party, lock search, focus product input) and checkout shortcuts.
- `POST /api/pos/sale` posts to the GL synchronously — long-running for big carts. No queue yet.

## Out of scope / deferred
- Barcode scanner integration (would extend the product picker keyboard handler).
- Layby / hold orders.
- Cash-drawer / printer hardware control.
- Per-cashier discount permissions.

_Last updated: 2026-05-11 — includes the shared `PartySearchAndCreate` integration in POS._
