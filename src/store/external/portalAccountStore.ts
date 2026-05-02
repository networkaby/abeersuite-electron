import { create } from "zustand";

export type PortalAccountOption = {
    accountId: number;
    accountType: "personal" | "company";
    label: string;
    companyId: number | null;
    companyName: string | null;
};

type PortalAccountStore = {
    options: PortalAccountOption[];
    activeAccountId: number | null;
    loading: boolean;
    setContext: (payload: { options: PortalAccountOption[]; activeAccountId: number }) => void;
    setLoading: (loading: boolean) => void;
};

export const usePortalAccountStore = create<PortalAccountStore>((set) => ({
    options: [],
    activeAccountId: null,
    loading: false,
    setContext: ({ options, activeAccountId }) => set({ options, activeAccountId }),
    setLoading: (loading) => set({ loading }),
}));

