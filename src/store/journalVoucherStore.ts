import { create } from "zustand";

// Global open/close state for the JournalVoucherDialog. Mounted once in the
// protected layout so any page can call `setOpen(true)` mid-flow to record an
// adjustment without leaving the current route.
interface JournalVoucherStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useJournalVoucherStore = create<JournalVoucherStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
