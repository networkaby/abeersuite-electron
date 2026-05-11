import { create } from "zustand";

interface SaleDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useSaleDialogStore = create<SaleDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
