import { create } from "zustand";

export type PanelMode = "expanded" | "collapsed" | "hidden";

interface PanelStore {
    sidebarMode: PanelMode;
    barMode: PanelMode;
    setSidebarMode: (m: PanelMode) => void;
    setBarMode: (m: PanelMode) => void;
}

export const usePanelStore = create<PanelStore>((set) => ({
    sidebarMode: "expanded",
    barMode: "expanded",
    setSidebarMode: (sidebarMode) => set({ sidebarMode }),
    setBarMode: (barMode) => set({ barMode }),
}));
