"use client";

import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePanelStore, type PanelMode } from "@/store/panelStore";
import { BranchSwitcher } from "@/shared/components/BranchSwitcher";

function nextMode(mode: PanelMode): PanelMode {
    if (mode === "expanded") return "collapsed";
    if (mode === "collapsed") return "hidden";
    return "expanded";
}

export function TopBar() {
    const {
        sidebarMode, setSidebarMode,
        barMode, setBarMode,
    } = usePanelStore();

    return (
        <div className="dark chrome-surface flex h-9 shrink-0 items-center border-b border-border-strong bg-surface-frame px-2 gap-1 z-30 relative text-foreground">
            {/* ── Sidebar trigger ─────────────────────────────── */}
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSidebarMode(nextMode(sidebarMode))}
                title={
                    sidebarMode === "hidden"
                        ? "Show sidebar"
                        : sidebarMode === "expanded"
                        ? "Collapse sidebar"
                        : "Hide sidebar"
                }
                className={[
                    "transition-opacity",
                    sidebarMode === "hidden" ? "opacity-40 hover:opacity-100" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
            >
                <PanelLeft size={15} />
            </Button>

            <div className="flex-1" />

            {/* ── Active branch switcher ──────────────────────── */}
            <BranchSwitcher />

            <div className="w-2" />

            {/* ── Button bar trigger ──────────────────────────── */}
            <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setBarMode(nextMode(barMode))}
                title={
                    barMode === "hidden"
                        ? "Show action bar"
                        : barMode === "expanded"
                        ? "Collapse action bar"
                        : "Hide action bar"
                }
                className={[
                    "transition-opacity",
                    barMode === "hidden" ? "opacity-40 hover:opacity-100" : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
            >
                <PanelRight size={15} />
            </Button>
        </div>
    );
}
