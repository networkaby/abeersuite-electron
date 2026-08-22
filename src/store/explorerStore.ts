import { create } from "zustand";

export const useExplorerStore = create<{
    open: boolean;
    setOpen: (open: boolean) => void;
}>((set) => ({
    open: false,
    setOpen: (open) => {
        console.log("[explorer]", open ? "opened" : "closed");
        set({ open });
    },
}));
