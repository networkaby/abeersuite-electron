import { create } from "zustand";
import type { SetStateAction } from "react";
import type { Snapshot, CartLine, ChargeRow } from "@/modules/pos/lib/posDraftTypes";

// ── POS draft (in-memory, no persist) ────────────────────────────────────────
//
// The slice of a POS voucher that is safe to carry across a mode switch: the
// chosen customer, the goods cart, and the generic bill adjustments (shipping /
// round-off / charges). Because a Zustand store is a module-level singleton, it
// survives the <Link> navigation between /vouchers/pos/new ↔ /order ↔ /estimate
// — so a cashier who has half-built a Sale can flip to Order or Estimate without
// losing the cart. NO persist middleware: a half-built money cart must not
// resurrect across a reload / next day (stale prices, a different shift).
//
// Deliberately NOT in the store (kept local to each screen):
//   • Sale-only money state — tender splits, the open shift, surplus.
//   • Server-validated money fields — coupon, loyalty redemption, gift card.
//     Their ₹ value is tied to the exact cart+customer; carrying them across a
//     mode switch (where the cart can change) would risk a stale amount. Phase 2
//     can revisit once each screen re-validates on cart change.
//   • Transient UI — product search box, dialogs, the loaded product list.
//
// Setters mirror React's `Dispatch<SetStateAction<T>>` so the existing call
// sites in both screens (`setCart((p) => …)`, `setCart([])`) work unchanged.

function applyAction<T>(prev: T, action: SetStateAction<T>): T {
    return typeof action === "function" ? (action as (p: T) => T)(prev) : action;
}

type PosDraftState = {
    snapshot: Snapshot | null;
    cart: CartLine[];
    shippingAmtStr: string;
    roundOffStr: string;
    roundOffManuallyEdited: boolean;
    charges: ChargeRow[];
    // Repair ticket this draft was preloaded from (Generate Bill). Rides through
    // to /api/pos/sale so the resulting voucher links back to the ticket. Cleared
    // by reset() and on a manual customer change (see usePosBilling).
    ticketId: number | null;
    setSnapshot: (v: SetStateAction<Snapshot | null>) => void;
    setTicketId: (v: SetStateAction<number | null>) => void;
    setCart: (v: SetStateAction<CartLine[]>) => void;
    setShippingAmtStr: (v: SetStateAction<string>) => void;
    setRoundOffStr: (v: SetStateAction<string>) => void;
    setRoundOffManuallyEdited: (v: SetStateAction<boolean>) => void;
    setCharges: (v: SetStateAction<ChargeRow[]>) => void;
    /// Clear the whole draft. Used by edit mode (mount + unmount) to isolate an
    /// existing-voucher edit from the carried draft. The new-voucher success path
    /// clears fields individually (it keeps the customer for a quick re-bill).
    reset: () => void;
};

const initialDraft: Pick<
    PosDraftState,
    "snapshot" | "cart" | "shippingAmtStr" | "roundOffStr" | "roundOffManuallyEdited" | "charges" | "ticketId"
> = {
    snapshot: null,
    cart: [],
    shippingAmtStr: "",
    roundOffStr: "",
    roundOffManuallyEdited: false,
    charges: [],
    ticketId: null,
};

export const usePosDraftStore = create<PosDraftState>((set) => ({
    ...initialDraft,
    setSnapshot: (v) => set((s) => ({ snapshot: applyAction(s.snapshot, v) })),
    setTicketId: (v) => set((s) => ({ ticketId: applyAction(s.ticketId, v) })),
    setCart: (v) => set((s) => ({ cart: applyAction(s.cart, v) })),
    setShippingAmtStr: (v) => set((s) => ({ shippingAmtStr: applyAction(s.shippingAmtStr, v) })),
    setRoundOffStr: (v) => set((s) => ({ roundOffStr: applyAction(s.roundOffStr, v) })),
    setRoundOffManuallyEdited: (v) => set((s) => ({ roundOffManuallyEdited: applyAction(s.roundOffManuallyEdited, v) })),
    setCharges: (v) => set((s) => ({ charges: applyAction(s.charges, v) })),
    reset: () => set(initialDraft),
}));
