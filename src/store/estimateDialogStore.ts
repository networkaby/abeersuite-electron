import { create } from "zustand";

interface EstimateDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useEstimateDialogStore = create<EstimateDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
