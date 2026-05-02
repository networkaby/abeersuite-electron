# Customer site / external surface — shared imports registry

When `src/app/(external)/**` or `src/modules/external/**` imports **pre-existing** code outside those trees, add a row here so splitting into a separate customer app is traceable.

| External file | Existing import path | Type | Reason | Split strategy |
|---------------|----------------------|------|--------|----------------|
| `src/app/(external)/layout.tsx` | `@/modules/external/ExternalRootShell` | component | NextAuth `SessionProvider` for portal/shop | duplicate thin shell or shared `packages/ui-session` |
| `src/modules/external/ExternalRootShell.tsx` | `next-auth/react` `SessionProvider` | npm | Client session | keep |
| `src/modules/external/portal/PortalHeader.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/modules/external/shop/ShopHeader.tsx` | `@/components/ui/badge` | shadcn | Cart count badge | keep |
| `src/modules/external/shop/AddToCartButton.tsx` | `@/components/ui/button` | shadcn | UI | keep |
| `src/app/(external)/portal/login/page.tsx` | `@/components/ui/*` | shadcn | Forms | keep |
| `src/app/(external)/portal/register/page.tsx` | `@/components/ui/*`, `axios` | mixed | Same as other client pages | axios → fetch or shared http client |
| `src/app/(external)/portal/tickets/page.tsx` | `@/components/ui/badge`, `@/auth`, `@/lib/prisma` | server | SSR tickets | extract `packages/db` + auth types |
| `src/app/(external)/shop/page.tsx` | `@/lib/prisma`, `@/lib/money-inr` | server | Catalog SSR | extract packages |
| `src/app/(external)/shop/order/[id]/page.tsx` | `@/components/ui/button`, `@/lib/prisma`, `@/lib/money-inr` | server | Order confirmation | extract packages |
| `src/store/external/shopCartStore.ts` | `zustand` | npm | Cart state | keep |

_Add new rows for any future imports from `@/modules/shared/*`, `@/lib/*` (beyond prisma/money), or staff-only APIs._
