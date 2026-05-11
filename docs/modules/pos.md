# POS (Point of Sale)

> Counter-side sale screen. Search a customer, build a cart of inventory items, take cash / card / cheque / bank-transfer / wallet payment, post the sale to the GL.

## URLs

### UI pages
- `/office/pos` — the single-page POS register. Full-screen, keyboard-driven (Ctrl+Enter checkout). File: `src/app/(protected)/office/pos/page.tsx` (thin wrapper) + `src/modules/pos/components/PosScreen.tsx` (1411-line client component).

### API routes
- `GET /api/people?lookup=…` — debounced party search shared with `PartyCombobox` (the party-picker hook `usePartySearch` from `@/shared/hooks`).
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
- `PosScreen` (file: `src/modules/pos/components/PosScreen.tsx`) — the entire POS UI. Sections: party search + snapshot panel, cart, totals + tax, payment splits, "New customer" inline-create dialog, recent-tickets sidebar.
- `PartyPicker` (`src/shared/components/PartyPicker/index.tsx`) — used by POS for the party search box (same picker used elsewhere).

## Library / helpers
- POS itself has no `lib/` — single-screen module per Segment 10 audit.
- Consumes: `postInvoiceJe` (`src/modules/accountancy/lib/postInvoiceJe.ts`), `usePartySearch` (`src/shared/hooks/usePartySearch.ts`), `useComboboxNav` (planned in Segment 09c).

## Common workflows (wiring)
1. **Take a sale**: type customer name/phone → pick from dropdown → snapshot panel loads (balance, credit limit, alerts) → add items (`InvProductCombobox`) → pick payment method → **Ctrl+Enter** opens checkout → `POST /api/pos/sale` → voucher + GL post + stock decrement → success toast + print receipt.
2. **New customer on the fly**: type a name with no matches → "New customer" button → inline dialog → creates `Person` + `Account` under Sundry Debtors → returns to cart with the new party selected.

## Recent decisions / gotchas
- **PosScreen is UX-critical** — Segment 09c will refactor party search to use `useComboboxNav` + `usePartySearch`, but the snapshot panel, "New customer" dialog, cart, payment splits, and Ctrl+Enter shortcut must stay byte-identical. Manual end-to-end browser verification before each related commit.
- `POST /api/pos/sale` posts to the GL synchronously — long-running for big carts. No queue yet.

## Out of scope / deferred
- Barcode scanner integration (would extend the product picker keyboard handler).
- Layby / hold orders.
- Cash-drawer / printer hardware control.
- Per-cashier discount permissions.

_Last updated: 2026-05-11 — covers state after Segment 14 (API path rename) and the route-group promotion. Awaiting Segment 09c PosScreen refactor._
