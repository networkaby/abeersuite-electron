import { create } from "zustand";

type CreateDialogStore = {
    personOpen: boolean;
    companyOpen: boolean;
    helpOpen: boolean;
    dealOpen: boolean;
    taskOpen: boolean;
    setPersonOpen: (open: boolean) => void;
    setCompanyOpen: (open: boolean) => void;
    setHelpOpen: (open: boolean) => void;
    setDealOpen: (open: boolean) => void;
    setTaskOpen: (open: boolean) => void;
};

export const useCreateDialogStore = create<CreateDialogStore>((set) => ({
    personOpen: false,
    companyOpen: false,
    helpOpen: false,
    dealOpen: false,
    taskOpen: false,
    setPersonOpen: (open) => set({ personOpen: open }),
    setCompanyOpen: (open) => set({ companyOpen: open }),
    setHelpOpen: (open) => set({ helpOpen: open }),
    setDealOpen: (open) => set({ dealOpen: open }),
    setTaskOpen: (open) => set({ taskOpen: open }),
}));
