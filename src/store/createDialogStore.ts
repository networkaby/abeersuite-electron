import { create } from "zustand";

type CreateDialogStore = {
    personOpen: boolean;
    companyOpen: boolean;
    helpOpen: boolean;
    setPersonOpen: (open: boolean) => void;
    setCompanyOpen: (open: boolean) => void;
    setHelpOpen: (open: boolean) => void;
};

export const useCreateDialogStore = create<CreateDialogStore>((set) => ({
    personOpen: false,
    companyOpen: false,
    helpOpen: false,
    setPersonOpen: (open) => set({ personOpen: open }),
    setCompanyOpen: (open) => set({ companyOpen: open }),
    setHelpOpen: (open) => set({ helpOpen: open }),
}));
