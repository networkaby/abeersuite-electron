# Segment 09 — Shared hooks

## Goal

Extract four cross-module hooks. Eliminates ~70% duplication across three comboboxes + the POS party search, and unifies 90+ inline delete/fetch patterns.

**PosScreen UX must be byte-identical.** Hooks are applied internally; PosScreen's snapshot panel, "New customer" dialog, cart, payment splits, and Ctrl+Enter checkout all keep current behaviour. Only its party-search ArrowUp/Down/Enter/Escape is delegated to `useComboboxNav`; only its debounced lookup is delegated to `usePartySearch`.

## Files created

- `src/shared/hooks/useComboboxNav.ts`
- `src/shared/hooks/usePartySearch.ts`
- `src/shared/hooks/useDeleteWithConfirm.ts`
- `src/shared/hooks/useApiResource.ts`
- `src/shared/hooks/index.ts` (barrel)

## Contracts

### `useComboboxNav`
```ts
export function useComboboxNav(opts: {
  count: number;                       // length of the filtered list
  onSelect: (index: number) => void;
  onClear?: () => void;
}): {
  open: boolean;
  setOpen: (v: boolean) => void;
  highlighted: number;
  setHighlighted: (i: number) => void;
  dropdownWidth: number | null;
  wrapperRef: RefObject<HTMLDivElement>;
  listRef: RefObject<HTMLUListElement>;
  handleKeyDown: (e: KeyboardEvent) => void;   // ArrowUp/Down/Enter/Escape (Tab caller-overridable)
  handleBlur: () => void;                       // 150ms close delay
  handleFocus: () => void;
  clear: () => void;
};
```

### `usePartySearch`
```ts
export type PartyHit = {
  id: number;
  name: string;
  phone: string | null;
  type: "customer" | "company";
  accountId: number | null;
  linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};
export function usePartySearch(query: string, opts?: { enabled?: boolean }):
  { hits: PartyHit[]; loading: boolean };
// 200ms debounce, abort on unmount, empty-query short-circuits to []
```

### `useDeleteWithConfirm`
```ts
export function useDeleteWithConfirm(opts: {
  url: (id: string | number) => string;
  message?: (item?: unknown) => string;
  onSuccess?: () => void;
}): {
  deleting: boolean;
  remove: (id: string | number, item?: unknown) => Promise<void>;
};
```

### `useApiResource`
```ts
export function useApiResource<T>(url: string | null, opts?: { initial?: T }):
  { data: T | undefined; loading: boolean; error: string | null; reload: () => void };
```

## Consumer wiring

### `useComboboxNav` consumers (4)

1. `src/modules/accountancy/components/GlAccountCombobox.tsx` — replaces inline `open`/`highlighted`/keyboard handler.
2. `src/modules/accountancy/components/PartyCombobox.tsx` — replaces inline state + nav.
3. `src/modules/inventory/components/InvProductCombobox.tsx` — replaces inline state + nav.
4. **`src/modules/pos/components/PosScreen.tsx`** — replaces only the party-search keyboard branch; preserves all other shortcuts (Ctrl+Enter, etc.) intact by intercepting the keydown before delegating ArrowUp/Down/Enter/Escape.

### `usePartySearch` consumers (2)

1. `src/modules/accountancy/components/PartyCombobox.tsx` — replaces inline debounce+fetch.
2. **`src/modules/pos/components/PosScreen.tsx`** — replaces inline debounce+fetch (`custQuery` → `query`, `custHits` → `hits`). Snapshot loading on selection (`pickByAccountId` → `/api/pos/account-snapshot/{id}`) is **not** part of this hook and stays inline.

### `useDeleteWithConfirm` consumers (60+)

Run `Grep('confirm\(.*Delete' src/app -A 2 -B 1)`. For each match, replace the surrounding `if (!confirm(...)) return; try { await axios.delete(...); toast.success; reload() } catch { toast.error }` block with a `useDeleteWithConfirm` call.

### `useApiResource` consumers (30+)

Run `Grep('useEffect\(\(\) => \{[^}]*axios\.get|fetch\(' src)`. For each `useEffect` whose body just GETs and `setState` on `data` + `loading`, replace with `useApiResource(url)`.

## Step-by-step

1. Write the four hook files + barrel.
2. Refactor the 3 comboboxes (one per commit ideally) — each loses ~150 lines of nav/debounce.
3. Refactor PosScreen's party-search section — confirm UX byte-identical via manual checklist (snapshot loads, "New customer" opens, Ctrl+Enter checkouts, cart unchanged).
4. Sweep `useDeleteWithConfirm` and `useApiResource` consumers in batches by module.
5. `tsc --noEmit`, `npm run build`.

## Verification

- [ ] All four hooks created
- [ ] `tsc --noEmit` clean
- [ ] `npm run build` clean
- [ ] Browser — voucher form: party combobox, GL combobox keyboard nav (Up/Down/Enter/Escape) works
- [ ] Browser — inventory voucher: product combobox keyboard nav works
- [ ] Browser — **POS**: search a customer, snapshot loads correctly, click "New customer" → dialog opens with all fields, create person+company → returns to cart, add items, Ctrl+Enter → checkout dialog. Identical to before.
- [ ] Browser — any list page with delete: confirm dialog appears, delete works, list refreshes, error path shows toast.

## Rollback

`git revert`. Each consumer refactor is independent — partial revert is fine if one breaks.

## Risks

- Subtle keyboard-nav regressions on Tab handling. Combobox tests should explicitly include Tab → "should commit selection if user typed differently than selected label" (current behaviour in GlAccountCombobox).
- PosScreen Ctrl+Enter could be lost if `useComboboxNav.handleKeyDown` is wired before the custom branch. Wire **after** custom shortcuts.

---

## Post-execution notes (2026-05-11) — Segment 09a

Status: **partial complete** — 4 hooks built + 2 comboboxes refactored. PartyCombobox refactor, PosScreen refactor, and the two bulk sweeps are split into follow-up commits within this segment.

### What landed (09a):

- `src/shared/hooks/{useComboboxNav,usePartySearch,useDeleteWithConfirm,useApiResource}.ts` + `index.ts` barrel.
- `GlAccountCombobox` refactored to use `useComboboxNav` (state, refs, keydown, blur, clear, scroll-into-view all delegated; Tab commit-on-exit kept inline as designed).
- `InvProductCombobox` refactored similarly.

### Hook design decisions during execution:

- **Tab is consumer-owned.** The hook's `handleKeyDown` covers ArrowUp/Down/Enter/Escape only. Consumers wrap it and inspect `e.key === "Tab"` before delegating. GlAccount and InvProduct both commit selection if the typed input differs from the selected label; PartyCombobox + PosScreen will have their own behaviours.
- **`highlighted` auto-resets on `count` change** (was a manual reset in each combobox).
- **`clear` doesn't reset `query`** — callers do that themselves via `onClear` callback, because the query state lives in the consumer (not the hook).

### Reality vs plan — sweep counts:

| Pattern | Plan estimate | Actual |
|---|---|---|
| `confirm()` delete patterns | 60+ | **16** |
| `useEffect + axios.get` | 30+ | **138** total `axios.get` calls; only a fraction follow the `useEffect+setState+setLoading` pattern that fits `useApiResource` cleanly |

### Deferred to follow-up commits within this segment:

- **PartyCombobox refactor** — has extra API/debounce machinery and an inline create-party dialog. Will adopt `useComboboxNav` + `usePartySearch` in a separate commit so the diff stays small and reviewable.
- **PosScreen party-search refactor** — UX-critical. Snapshot panel, "New customer" dialog, cart, payment splits, and Ctrl+Enter checkout must all keep current behaviour. Separate commit, verified manually in the browser end-to-end before merging.
- **useDeleteWithConfirm sweep** — 16 sites. Mechanical but each callsite has its own confirm message / reload callback / error-message style. Worth doing; separate commit.
- **useApiResource sweep** — too varied. Of 138 `axios.get` calls, many are inside event handlers (not `useEffect`-pattern), and many have richer state than `data + loading + error`. Adopt incrementally as files are touched for other reasons, not as a sweep.

### Verification

- `tsc --noEmit` clean
- `npm run build` clean
- Smoke: `/api/finance/gl-accounts` returns 200 with 73 accounts (the GlAccountCombobox consumer endpoint).

### Per AGENTS.md "after every plan" rule

- **Reusables registry** — `docs/reusables.md` gains a Hooks section.
- **Module docs** — none touched.
- **Todo list** — completed.


---

## Adapting to new findings during execution

If while running this plan you discover that an assumption is stale — file paths drifted, scope counts are wrong, a helper already exists elsewhere, a sweep produces fewer or more hits than estimated — **update the relevant plan files in the same PR before committing**. Do not silently work around the divergence: the next plan in the sequence may rely on the path or symbol you just changed, and the next agent (or human) reads the plan cold. Add a short "Post-execution notes" section recording what actually happened, mirroring the pattern set by [01-layout-sweep.md](01-layout-sweep.md) and [02-utility-quick-wins.md](02-utility-quick-wins.md).
