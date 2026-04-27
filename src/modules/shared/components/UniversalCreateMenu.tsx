"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, X, Ticket } from "lucide-react";
import axios from "axios";
import { useQuickTicketStore } from "@/store/quickTicketStore";

type PipelineOption = { id: string; label: string; color: string; isDefault: boolean; isActive: boolean };

export default function UniversalCreateMenu() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const menuRef = useRef<HTMLDivElement>(null);
    const { setOpen: openTicketModal, setInitialPipelineId } = useQuickTicketStore();

    useEffect(() => {
        axios.get<PipelineOption[]>("/api/pipelines")
            .then((r) => setPipelines(r.data.filter((p) => p.isActive)))
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [menuOpen]);

    const handleNewTicket = (pipelineId: string) => {
        setMenuOpen(false);
        setInitialPipelineId(pipelineId);
        openTicketModal(true);
    };

    return (
        <div ref={menuRef} className="fixed bottom-8 right-8 z-40 flex flex-col items-end gap-0">
            {/* Popover menu */}
            {menuOpen && (
                <div className="mb-3 border-2 border-border shadow bg-card w-64 overflow-hidden">
                    <div className="px-4 py-2.5 border-b-2 border-border bg-muted flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Create New</span>
                        <button onClick={() => setMenuOpen(false)} className="text-muted-foreground hover:text-foreground">
                            <X size={13} />
                        </button>
                    </div>
                    <div className="py-1">
                        {pipelines.length === 0 && (
                            <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
                        )}
                        {pipelines.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => handleNewTicket(p.id)}
                                className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-primary/10 hover:text-primary border-b border-border last:border-b-0"
                            >
                                <span className={`w-2.5 h-2.5 shrink-0 border border-border ${p.color.split(" ")[0]}`} />
                                <Ticket size={14} className="shrink-0 text-muted-foreground" />
                                <span>New {p.label} Ticket</span>
                            </button>
                        ))}
                        <div className="border-t border-border pt-1">
                            <button
                                disabled
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground cursor-not-allowed text-left opacity-50"
                            >
                                <span className="w-2.5 h-2.5 border border-border bg-muted shrink-0" />
                                <span>Voucher Entry</span>
                                <span className="ml-auto text-xs border border-border bg-muted text-muted-foreground px-1.5 py-0.5">Soon</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* FAB */}
            <button
                onClick={() => setMenuOpen((o) => !o)}
                className={`flex items-center gap-2 border-2 border-primary bg-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow transition-all hover:bg-primary/90 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none ${menuOpen ? "ring-2 ring-primary/30 ring-offset-1" : ""}`}
            >
                <Plus size={18} className={`transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`} />
                New
            </button>
        </div>
    );
}
