import { create } from "zustand";

interface ContraDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useContraDialogStore = create<ContraDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
