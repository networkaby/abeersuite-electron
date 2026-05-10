# Segment 10 — Module folder standardisation

## Goal

Bring every `src/modules/<m>/` to the same shape so file location is predictable. Adds missing `lib/` and `hooks/` subfolders where modules already have logic mixed into components.

**** new add by user -  

1. src\app\(protected)\office\(admin) change to src\app\(protected)\office\admin and similer to all so that we get real separation in url.  already some modul has route level separetion just need to remove the ()
2.  new component added new commit happend after you left after last segment done.   *****

## Target shape

```
src/modules/<m>/
├─ components/   PascalCase .tsx
├─ lib/          camelCase .ts (pure logic, queries, helpers)
├─ hooks/        camelCase .ts (only when client state isn't in Zustand)
└─ types.ts      module-internal types not derivable from Prisma
```

## Per-module work


| Module        | Current                                    | Action                                                                                                                                                                                   |
| ------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accountancy` | `components/`, `lib/`, `hooks/`            | ✅ already correct (received `postInvoiceJe.ts` in Segment 08)                                                                                                                            |
| `admin`       | `components/` (2 files)                    | Add `lib/` if logic emerges; otherwise leave                                                                                                                                             |
| `core`        | `components/` (1 file)                     | Leave; consider `lib/` later                                                                                                                                                             |
| `customer`    | `components/` (3 files)                    | ✅ already received `crmPipeline.ts`, `companyContacts.ts`, `contactWrite.ts` in Segment 08                                                                                               |
| `ecommerce`   | `components/`, `lib/`                      | ✅ received `ordersPipeline.ts` in Segment 08                                                                                                                                             |
| `external`    | `shop/`, `portal/`, `store/` (sub-domains) | Already a special case — leave structure                                                                                                                                                 |
| `inventory`   | `components/`, `lib/product-admin.ts`      | Rename `product-admin.ts` → `productAdmin.ts`; extract any inline business logic from components into `lib/`                                                                             |
| `message`     | `components/`, `lib/`                      | Audit: rename any kebab-case files in `lib/` to camelCase                                                                                                                                |
| `pos`         | `components/` (1 file: PosScreen)          | Single-screen module — leave                                                                                                                                                             |
| `repairing`   | `components/` (17 files)                   | ✅ received `ticketScope.ts` in Segment 08; **also** extract dashboard queries from `RepairingDashboardPage.tsx` (Segment 11) into `lib/dashboardQueries.ts` (done as part of Segment 11) |
| `shared`      | (deleted in Segment 01)                    | n/a                                                                                                                                                                                      |


## Step-by-step

1. Walk each module and rename any remaining kebab-case `.ts` files in `lib/` to camelCase.
2. Sweep imports for renames.
3. Where a component file > 250 lines has clearly separable pure logic (queries, math), the extraction happens **in the matching segment that touches it** (11 or 12), not here. This segment is just structure + naming.
4. `tsc --noEmit`, `npm run build`.

## Verification

- Every module that has pure logic has a `lib/` folder
- Every file in `src/modules/<m>/lib/` is camelCase `.ts`
- Every component file is PascalCase `.tsx`
- `tsc --noEmit` clean
- `npm run build` clean

## Out of scope

- Page-component extraction → Segments 11 & 12.
- Adding new hooks → Segment 09.
- Module-level barrel `index.ts` files — explicitly avoided. Existing convention is no barrels at the module root; keep imports explicit.

---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).