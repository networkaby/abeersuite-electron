# Vouchers routes (`/vouchers`)

App Router tree for creating and editing vouchers. Most types use full-page forms here; list/register views live under `/office/accountancy/vouchers-registers/...` (and POS has its own list at `/vouchers/pos`).

## Shared shell

| File | Purpose |
|------|---------|
| `layout.tsx` | Auth + `SessionWrapper` for all `/vouchers/*` |
| `loading.tsx` | Loading UI for this segment |

---

## `(gl)` — General ledger vouchers

Route group `(gl)` does **not** appear in the URL. Standalone full-page GL forms (`(gl)/layout.tsx` — fixed full-screen shell, no office sidebar).

| Voucher | Routes |
|---------|--------|
| Sales | `/vouchers/sales/new` |
| Sale returns | `/vouchers/sale-returns/new` |
| Purchases | `/vouchers/purchases/new` |
| Purchase returns | `/vouchers/purchase-returns/new` |
| Receipts | `/vouchers/receipts/new`, `/vouchers/receipts/[id]` |
| Payments | `/vouchers/payments/new`, `/vouchers/payments/[id]` |
| Contras | `/vouchers/contras/new`, `/vouchers/contras/[id]` |
| Credit notes | `/vouchers/credit-notes/new`, `/vouchers/credit-notes/[id]` |
| Debit notes | `/vouchers/debit-notes/new`, `/vouchers/debit-notes/[id]` |
| Journal entries | `/vouchers/journal-entries/new`, `/vouchers/journal-entries/[id]` |
| Estimates | `/vouchers/estimates/new` |

**GL — new only (no `[id]` route in this folder):** sales, sale-returns, purchases, purchase-returns, estimates.

---

## Inventory & operations vouchers

| Voucher | Routes |
|---------|--------|
| POS | `/vouchers/pos` (list), `/vouchers/pos/new`, `/vouchers/pos/[id]` |
| Sales orders | `/vouchers/sales-orders/new`, `/vouchers/sales-orders/[id]` |
| Purchase orders | `/vouchers/purchase-orders/new`, `/vouchers/purchase-orders/[id]` |
| GRN (goods receipt) | `/vouchers/grn/new`, `/vouchers/grn/[id]` |
| Challans | `/vouchers/challans/new`, `/vouchers/challans/[id]` |
| Manufacturing journals | `/vouchers/manufacturing-journals/new`, `/vouchers/manufacturing-journals/[id]` |
| Physical stock | `/vouchers/physical-stock/new`, `/vouchers/physical-stock/[id]` |
| Branch transfers | `/vouchers/branch-transfers/new`, `/vouchers/branch-transfers/[id]` |
| Rejections in | `/vouchers/rejections-in/new`, `/vouchers/rejections-in/[id]` |
| Rejections out | `/vouchers/rejections-out/new`, `/vouchers/rejections-out/[id]` |
| Online orders | `/vouchers/online-orders/[id]` (detail only — storefront-produced; no office `new/` yet) |
| Online invoices | `/vouchers/online-invoices/[id]` (detail only — fulfilment of an online order; no office `new/` yet) |

POS has its own `pos/layout.tsx` and `pos/new/layout.tsx`.

---

## File tree (route files)

```
vouchers/
├── layout.tsx
├── loading.tsx
├── (gl)/
│   ├── layout.tsx
│   ├── contras/[id]/page.tsx, contras/new/page.tsx
│   ├── credit-notes/[id]/page.tsx, credit-notes/new/page.tsx
│   ├── debit-notes/[id]/page.tsx, debit-notes/new/page.tsx
│   ├── estimates/new/page.tsx
│   ├── journal-entries/[id]/page.tsx, journal-entries/new/page.tsx
│   ├── payments/[id]/page.tsx, payments/new/page.tsx
│   ├── purchase-returns/new/page.tsx
│   ├── purchases/new/page.tsx
│   ├── receipts/[id]/page.tsx, receipts/new/page.tsx
│   ├── sale-returns/new/page.tsx
│   ├── sales/new/page.tsx
├── branch-transfers/[id]/page.tsx, branch-transfers/new/page.tsx
├── challans/[id]/page.tsx, challans/new/page.tsx
├── grn/[id]/page.tsx, grn/new/page.tsx
├── manufacturing-journals/[id]/page.tsx, manufacturing-journals/new/page.tsx
├── physical-stock/[id]/page.tsx, physical-stock/new/page.tsx
├── pos/page.tsx, pos/layout.tsx, pos/[id]/page.tsx, pos/new/page.tsx, pos/new/layout.tsx
├── purchase-orders/[id]/page.tsx, purchase-orders/new/page.tsx
├── rejections-in/[id]/page.tsx, rejections-in/new/page.tsx
├── rejections-out/[id]/page.tsx, rejections-out/new/page.tsx
└── sales-orders/[id]/page.tsx, sales-orders/new/page.tsx
```

---

## Related

- **Registers (lists):** `/office/accountancy/vouchers-registers/*` — see `VouchersRegistersNav.tsx` and `docs/modules/` for module docs.
- **Navigation config:** `src/utils/constants.ts` (POS, inventory, finance menus).
