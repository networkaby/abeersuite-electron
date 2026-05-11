import { create } from "zustand";

interface CreditNoteDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useCreditNoteDialogStore = create<CreditNoteDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
