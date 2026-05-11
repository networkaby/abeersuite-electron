import { create } from "zustand";

/**
 * EXPLORATORY — separate from the live SaleDialog store so we can open a
 * full-screen sale dialog side-by-side with the current dialog for comparison.
 * Delete when the layout experiment is over.
 */
interface SaleFullScreenDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useSaleFullScreenDialogStore = create<SaleFullScreenDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
