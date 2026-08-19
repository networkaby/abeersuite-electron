"use client";

// ── PosInboxDrawer ────────────────────────────────────────────────────────────
// Team chat, right at the counter. Slides in from the right edge like
// PosUpsellDrawer, but wider — wide enough to hold InboxModule's own two-pane
// layout (room list + chat) unmodified, just embedded (no page breadcrumb).
// Backdrop click or Esc closes it.

import { Suspense, useEffect } from "react";
import { X, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import InboxModule from "@/modules/message/components/InboxModule";

export function PosInboxDrawer({
    open,
    onClose,
    currentUserId,
    currentUserName,
}: {
    open: boolean;
    onClose: () => void;
    currentUserId?: number;
    currentUserName?: string;
}) {
    // Esc closes the drawer.
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [open, onClose]);

    return (
        <>
            {/* Backdrop — fades in; blocks interaction with the counter behind. */}
            <div
                onClick={onClose}
                className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
            />
            {/* The drawer — slides in from the right edge. */}
            <aside
                className={`fixed inset-y-0 right-0 z-50 flex w-[820px] max-w-[95vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
                aria-hidden={!open}
                inert={!open}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
                    <MessageSquare size={15} className="shrink-0 text-primary" />
                    <h3 className="text-sm font-semibold">Team Chat</h3>
                    <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onClose} title="Close (Esc)">
                        <X size={14} />
                    </Button>
                </div>

                <div className="min-h-0 flex-1">
                    {/* InboxModule reads the URL's ?section= via useSearchParams, which
                        requires a Suspense boundary — the POS route carries no such
                        query string, so it just falls back to its default ("groups"). */}
                    <Suspense fallback={null}>
                        {open && (
                            <InboxModule currentUserId={currentUserId} currentUserName={currentUserName} embedded />
                        )}
                    </Suspense>
                </div>
            </aside>
        </>
    );
}
