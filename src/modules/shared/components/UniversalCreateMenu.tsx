"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, X, Ticket } from "lucide-react";
import axios from "axios";
import { useQuickTicketStore } from "@/store/quickTicketStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
                <Card className="mb-3 w-64 overflow-hidden py-0">
                    <div className="flex items-center justify-between border-b border-border bg-muted px-4 py-2.5">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Create New</span>
                        <Button onClick={() => setMenuOpen(false)} variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-foreground">
                            <X size={13} />
                        </Button>
                    </div>
                    <div className="py-1">
                        {pipelines.length === 0 && (
                            <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
                        )}
                        {pipelines.map((p) => (
                            <Button
                                key={p.id}
                                onClick={() => handleNewTicket(p.id)}
                                variant="ghost"
                                className="h-auto w-full justify-start rounded-none border-b border-border px-4 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-primary/10 hover:text-primary last:border-b-0"
                            >
                                <span className={`w-2.5 h-2.5 shrink-0 border border-border ${p.color.split(" ")[0]}`} />
                                <Ticket size={14} className="shrink-0 text-muted-foreground" />
                                <span>New {p.label} Ticket</span>
                            </Button>
                        ))}
                        <div className="border-t border-border pt-1">
                            <Button
                                disabled
                                variant="ghost"
                                className="h-auto w-full cursor-not-allowed justify-start px-4 py-2.5 text-left text-sm text-muted-foreground opacity-50"
                            >
                                <span className="w-2.5 h-2.5 border border-border bg-muted shrink-0" />
                                <span>Voucher Entry</span>
                                <span className="ml-auto text-xs border border-border bg-muted text-muted-foreground px-1.5 py-0.5">Soon</span>
                            </Button>
                        </div>
                    </div>
                </Card>
            )}

            {/* FAB */}
            <Button
                onClick={() => setMenuOpen((o) => !o)}
                className={`h-auto px-5 py-3 shadow ${menuOpen ? "ring-2 ring-primary/30 ring-offset-1" : ""}`}
            >
                <Plus size={18} className={`transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`} />
                New
            </Button>
        </div>
    );
}
