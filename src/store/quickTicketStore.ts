import { create } from "zustand";

export type Step = "phone" | "account" | "ticket";

export type BasicIdentity = {
    id: number;
    name: string;
    phone?: string | null;
    type: "customer" | "company";
    accountId: number | null;
    linkedCompanies?: { id: number; name: string; accountId: number | null }[];
};

interface QuickTicketStore {
    open: boolean;
    step: Step;
    phone: string;
    identity: BasicIdentity | null;
    billingAccountId: number | null;
    initialPipelineId: string | null;
    setOpen: (open: boolean) => void;
    setStep: (step: Step) => void;
    setPhone: (phone: string) => void;
    setIdentity: (identity: BasicIdentity | null) => void;
    setBillingAccountId: (id: number | null) => void;
    setInitialPipelineId: (id: string | null) => void;
    reset: () => void;
}

const defaults = {
    open: false,
    step: "phone" as Step,
    phone: "",
    identity: null,
    billingAccountId: null as number | null,
    initialPipelineId: null as string | null,
};

export const useQuickTicketStore = create<QuickTicketStore>((set) => ({
    ...defaults,
    setOpen: (open) => set({ open }),
    setStep: (step) => set({ step }),
    setPhone: (phone) => set({ phone }),
    setIdentity: (identity) => set({ identity }),
    setBillingAccountId: (billingAccountId) => set({ billingAccountId }),
    setInitialPipelineId: (initialPipelineId) => set({ initialPipelineId }),
    reset: () => set(defaults),
}));
