import { create } from "zustand";

export type Step = "phone" | "customer" | "ticket";
export type BasicCustomer = { id: number; name: string; phone: string };

interface QuickTicketStore {
    open: boolean;
    step: Step;
    phone: string;
    customer: BasicCustomer | null;
    initialPipelineId: string | null;
    setOpen: (open: boolean) => void;
    setStep: (step: Step) => void;
    setPhone: (phone: string) => void;
    setCustomer: (customer: BasicCustomer | null) => void;
    setInitialPipelineId: (id: string | null) => void;
    reset: () => void;
}

const defaults = {
    open: false,
    step: "phone" as Step,
    phone: "",
    customer: null,
    initialPipelineId: null as string | null,
};

export const useQuickTicketStore = create<QuickTicketStore>((set) => ({
    ...defaults,
    setOpen: (open) => set({ open }),
    setStep: (step) => set({ step }),
    setPhone: (phone) => set({ phone }),
    setCustomer: (customer) => set({ customer }),
    setInitialPipelineId: (initialPipelineId) => set({ initialPipelineId }),
    reset: () => set(defaults),
}));
