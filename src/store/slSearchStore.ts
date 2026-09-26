import { create } from "zustand";

// Open/closed flag for the office-wide SL Search dialog. The sidebar's Workspace
// "SL Search" item opens it; the dialog itself is mounted once in the office
// layout, so it works from any office page.

type SlSearchStore = {
    open: boolean;
    setOpen: (open: boolean) => void;
};

export const useSlSearchStore = create<SlSearchStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
