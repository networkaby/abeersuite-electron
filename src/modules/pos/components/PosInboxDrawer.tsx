"use client";

// ── PosInboxDrawer ────────────────────────────────────────────────────────────
// Messages, right at the counter — the same screen as CRM → Messages (customer
// WhatsApp + staff chats + groups), so the counter never has to leave for the
// office. Slides in from the right edge like PosUpsellDrawer. Staff who may not
// open CRM → Messages get the Team / Groups chips only. While it is open the
// new-message popup hides (chatDrawer.ts); the popup's ↗ opens a chat here.
// Backdrop click or Esc closes it.

import { Suspense, useEffect } from "react";
import { useSession } from "next-auth/react";
import { X, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessagesWorkspace } from "@/modules/crm/components";
import { canOpenPage } from "@/shared/lib/auth/pageAccess";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { setChatDrawerOpen } from "@/modules/message/lib/chatDrawer";

export function PosInboxDrawer({
    open,
    onClose,
    openPhone,
}: {
    open: boolean;
    onClose: () => void;
    /** A customer chat to open, asked for by the popup's ↗. */
    openPhone?: string | null;
}) {
    const permissions = (useSession().data?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const can = (id: string) => hasPermissionWithScope(permissions, id);

    useEffect(() => {
        setChatDrawerOpen(open);
        return () => setChatDrawerOpen(false);
    }, [open]);

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
                className={`fixed inset-y-0 right-0 z-50 flex w-250 max-w-[95vw] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
                aria-hidden={!open}
                inert={!open}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
                    <MessageSquare size={15} className="shrink-0 text-primary" />
                    <h3 className="text-sm font-semibold">Messages</h3>
                    <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onClose} title="Close (Esc)">
                        <X size={14} />
                    </Button>
                </div>

                <div className="min-h-0 flex-1">
                    {/* MessagesWorkspace reads ?filter= / ?phone= via useSearchParams,
                        which needs a Suspense boundary. */}
                    <Suspense fallback={null}>
                        {open && (
                            <MessagesWorkspace
                                customers={canOpenPage("/office/crm/messages", permissions)}
                                canReply={can(PERMISSIONS.MESSAGES_REPLY)}
                                canTicket={can(PERMISSIONS.HELP_CREATE) || can(PERMISSIONS.DEALS_CREATE) || can(PERMISSIONS.TICKETS_CREATE)}
                                openPhone={openPhone}
                            />
                        )}
                    </Suspense>
                </div>
            </aside>
        </>
    );
}
