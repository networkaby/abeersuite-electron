# Segment 13 — Shared UI primitives

## Goal

Three small components that absorb the most-repeated inline JSX across list/CRUD pages. ~60 replacement sites.

## Files created

- `src/shared/components/DataPageHeader.tsx`
- `src/shared/components/DataTableStates.tsx` (exports `TableLoadingRow`, `TableEmptyRow`, `TableErrorRow`)
- `src/shared/components/StatusBadge.tsx`

## Contracts

### `DataPageHeader`
```tsx
type Props = {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
};
export function DataPageHeader({ title, subtitle, icon, actions }: Props) { /* … */ }
```
Replaces `<div className="flex items-center justify-between">…<h1>…<p>…<Button>` blocks (~15 sites).

### `DataTableStates`
```tsx
export function TableLoadingRow({ colSpan }: { colSpan: number }) { /* … */ }
export function TableEmptyRow({ colSpan, message?: string }: { colSpan: number; message?: string }) { /* … */ }
export function TableErrorRow({ colSpan, error }: { colSpan: number; error: string }) { /* … */ }
```
Replaces inline `<TableRow><TableCell colSpan={N}>Loading…</TableCell></TableRow>` and friends (~20 sites).

### `StatusBadge`
```tsx
type Kind = "invoice" | "journal" | "glType" | "ticket" | "order" | "generic";
export function StatusBadge({ kind, value }: { kind: Kind; value: string }) {
  // looks up className from src/utils/constants.ts maps
}
```
Replaces hardcoded `<Badge className="bg-green-100 text-green-700">…` (~24 sites).

## Sweep

### `DataPageHeader` consumers

Run `Grep('flex items-center justify-between' -A 5 src/app src/modules)`. Replace every list/detail page's header.

Hot files:
- `src/app/(protected)/office/(admin)/branches/page.tsx`
- `src/app/(protected)/office/(admin)/departments/page.tsx`
- `src/app/(protected)/office/(admin)/posts/page.tsx`
- `src/app/(protected)/office/(admin)/pipelines/page.tsx`
- `src/app/(protected)/office/(admin)/statuses/page.tsx`
- `src/app/(protected)/office/(inventory)/inventory/brands/page.tsx`
- `src/app/(protected)/office/(inventory)/inventory/categories/page.tsx`
- (after Segments 11 & 12, these are now module components — sweep in module components, not in page.tsx)

### `DataTableStates` consumers

Run `Grep('Loading…|No items|No results' src -A 1 -B 1)`. Replace `<TableRow><TableCell colSpan={N}>...</TableCell></TableRow>` blocks.

### `StatusBadge` consumers

Run `Grep('bg-(green|red|blue|yellow|orange|gray)-100 text-' src/modules src/app)`. Replace hardcoded color classes with `<StatusBadge kind=… value=…>`.

## Step-by-step

1. Build the three components. Use existing color maps from `src/utils/constants.ts` (`INVOICE_STATUS_COLORS`, `JOURNAL_STATUS_COLORS`, `GL_TYPE_COLORS`, `COLOR_OPTIONS`).
2. Sweep `DataPageHeader` first (most visible).
3. Sweep `DataTableStates` next.
4. Sweep `StatusBadge` last (most pervasive but lowest risk).
5. `tsc --noEmit`, `npm run build`.

## Verification

- [ ] All three components built
- [ ] Sweep counts:
  - `Grep('flex items-center justify-between')` count drops by ~15
  - `<TableCell.*Loading|No items` literal count drops by ~20
  - `bg-green-100 text-` count drops by ~24
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser walkthrough: every list page's header still renders correctly with title + actions
- [ ] Browser: empty list shows "No items"; loading shows "Loading…"
- [ ] Browser: status badges retain their previous colors

## Out of scope (deferred)

- A generic `<ResourceCrudPage>` shell — too many bespoke columns/actions for one shell to fit cleanly. Re-evaluate after this segment.
- A generic `<FilterBar>` — pages diverge too much.
- A generic `<Modal>` wrapper around shadcn `<Dialog>` — shadcn's API is already terse; another wrapper adds cognitive cost.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
