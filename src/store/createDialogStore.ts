import { create } from "zustand";

type CreateDialogStore = {
    personOpen: boolean;
    companyOpen: boolean;
    setPersonOpen: (open: boolean) => void;
    setCompanyOpen: (open: boolean) => void;
};

export const useCreateDialogStore = create<CreateDialogStore>((set) => ({
    personOpen: false,
    companyOpen: false,
    setPersonOpen: (open) => set({ personOpen: open }),
    setCompanyOpen: (open) => set({ companyOpen: open }),
}));
