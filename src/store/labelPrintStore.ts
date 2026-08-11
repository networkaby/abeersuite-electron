import { create } from "zustand";
import { persist } from "zustand/middleware";

// ── Barcode-label queue (persisted to localStorage) ──────────────────────────
//
// The products queued for label printing, shared by the two doors into the same
// job: Pricing Strategy → "Update & print labels" (pick from the catalogue, set
// the price) and → "Print labels" (search / scan / voucher only). Tick products
// on one page, walk to the other, same list.
//
// Persisted, unlike the POS draft: a label run is a batch of work, not a moment.
// Staff open the print page in a second browser tab, reload after a price fix, or
// come back after lunch — the queue has to still be there. That is safe here
// because the store holds ids + the printing intent ONLY. What a label SAYS
// (name, price, MRP, date) is re-derived from live product data on every load,
// so a restored queue can never print a stale price.

const STORAGE_KEY = "pricing.label-print-queue.v1";

type LabelPrintState = {
    /** Queued product ids, in the order they were added. */
    ids: number[];
    /** Hand-typed copies, per product. Absent = use the default (see defaultCopies). */
    copies: Record<number, number>;
    /** Units received on the GRN/Purchase line that queued the product. */
    incoming: Record<number, number>;
    /**
     * Products whose price/barcode was re-saved this session. These need a label
     * on every piece on the shelf, not just the incoming ones — the copies default
     * switches from "incoming qty" to "stock qty" for them.
     */
    touched: number[];

    add: (ids: number[], opts?: { incoming?: Record<number, number> }) => void;
    remove: (id: number) => void;
    setCopies: (id: number, copies: number) => void;
    markTouched: (ids: number[]) => void;
    clear: () => void;
};

export const useLabelPrintStore = create<LabelPrintState>()(persist((set) => ({
    ids: [],
    copies: {},
    incoming: {},
    touched: [],

    add: (ids, opts) =>
        set((s) => ({
            ids: [...s.ids, ...ids.filter((id) => !s.ids.includes(id))],
            // Re-adding the same product from a second voucher adds up the units.
            incoming: opts?.incoming
                ? Object.entries(opts.incoming).reduce(
                    (acc, [id, qty]) => ({ ...acc, [id]: (acc[Number(id)] ?? 0) + qty }),
                    { ...s.incoming },
                )
                : s.incoming,
        })),

    remove: (id) =>
        set((s) => {
            const copies = { ...s.copies };
            const incoming = { ...s.incoming };
            delete copies[id];
            delete incoming[id];
            return { ids: s.ids.filter((x) => x !== id), copies, incoming };
        }),

    setCopies: (id, copies) => set((s) => ({ copies: { ...s.copies, [id]: copies } })),

    markTouched: (ids) =>
        set((s) => ({ touched: [...s.touched, ...ids.filter((id) => !s.touched.includes(id))] })),

    clear: () => set({ ids: [], copies: {}, incoming: {}, touched: [] }),
}), { name: STORAGE_KEY }));
