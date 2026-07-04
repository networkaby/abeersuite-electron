import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PanelMode = "expanded" | "collapsed" | "hidden";
type VisibleMode = "expanded" | "collapsed";

interface PanelStore {
    sidebarMode: PanelMode;
    barMode: PanelMode;
    /** Last non-hidden state — restored when sidebar is shown again */
    _sidebarLast: VisibleMode;
    /** Last non-hidden state — restored when bar is shown again */
    _barLast: VisibleMode;
    setSidebarMode: (m: PanelMode) => void;
    setBarMode: (m: PanelMode) => void;
    /** Toggle between hidden and last visible state (expanded or collapsed) */
    toggleSidebarVisible: () => void;
    /** Toggle between hidden and last visible state */
    toggleBarVisible: () => void;
}

export const usePanelStore = create<PanelStore>()(
    persist(
        (set) => ({
            sidebarMode: "expanded",
            barMode: "expanded",
            _sidebarLast: "expanded",
            _barLast: "expanded",

            setSidebarMode: (m) =>
                set((s) => ({
                    sidebarMode: m,
                    _sidebarLast: m !== "hidden" ? (m as VisibleMode) : s._sidebarLast,
                })),

            setBarMode: (m) =>
                set((s) => ({
                    barMode: m,
                    _barLast: m !== "hidden" ? (m as VisibleMode) : s._barLast,
                })),

            toggleSidebarVisible: () =>
                set((s) =>
                    s.sidebarMode === "hidden"
                        ? { sidebarMode: s._sidebarLast }
                        : { sidebarMode: "hidden", _sidebarLast: s.sidebarMode as VisibleMode }
                ),

            toggleBarVisible: () =>
                set((s) =>
                    s.barMode === "hidden"
                        ? { barMode: s._barLast }
                        : { barMode: "hidden", _barLast: s.barMode as VisibleMode }
                ),
        }),
        { name: "panel-store" }
    )
);
