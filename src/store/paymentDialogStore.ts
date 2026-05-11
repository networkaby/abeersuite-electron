import { create } from "zustand";

interface PaymentDialogStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const usePaymentDialogStore = create<PaymentDialogStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
