import { create } from "zustand";

interface ReceiptDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useReceiptDialogStore = create<ReceiptDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
