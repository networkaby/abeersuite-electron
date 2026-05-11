import { create } from "zustand";

interface PurchaseDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const usePurchaseDialogStore = create<PurchaseDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
