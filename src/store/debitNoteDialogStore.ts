import { create } from "zustand";

interface DebitNoteDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useDebitNoteDialogStore = create<DebitNoteDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
