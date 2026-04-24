import { create } from "zustand";

export type Step = "phone" | "account" | "ticket";
export type BasicAccount = { id: number; name: string; phone?: string | null; type: string };

interface QuickTicketStore {
    open: boolean;
    step: Step;
    phone: string;
    account: BasicAccount | null;
    billingAccountId: number | null;
    initialPipelineId: string | null;
    setOpen: (open: boolean) => void;
    setStep: (step: Step) => void;
    setPhone: (phone: string) => void;
    setAccount: (account: BasicAccount | null) => void;
    setBillingAccountId: (id: number | null) => void;
    setInitialPipelineId: (id: string | null) => void;
    reset: () => void;
}

const defaults = {
    open: false,
    step: "phone" as Step,
    phone: "",
    account: null,
    billingAccountId: null as number | null,
    initialPipelineId: null as string | null,
};

export const useQuickTicketStore = create<QuickTicketStore>((set) => ({
    ...defaults,
    setOpen: (open) => set({ open }),
    setStep: (step) => set({ step }),
    setPhone: (phone) => set({ phone }),
    setAccount: (account) => set({ account }),
    setBillingAccountId: (billingAccountId) => set({ billingAccountId }),
    setInitialPipelineId: (initialPipelineId) => set({ initialPipelineId }),
    reset: () => set(defaults),
}));
