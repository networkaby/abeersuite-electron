"use client";

import { Suspense } from "react";
import { useSession } from "next-auth/react";
import MobileHeader from "./MobileHeader";
import { MessagesWorkspace } from "@/modules/crm/components";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

/**
 * Mobile Inbox screen — customer WhatsApp chats and staff team chats on the phone.
 * Embeds MessagesWorkspace, which adapts between a full-width chat list and a full-width
 * message thread with a back button on mobile screens.
 */
export default function MobileInbox() {
    const permissions = (useSession().data?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const can = (id: string) => hasPermissionWithScope(permissions, id);

    return (
        <div className="flex flex-1 flex-col h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] overflow-hidden">
            <MobileHeader title="Inbox" />
            <div className="min-h-0 flex-1">
                <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading inbox…</div>}>
                    <MessagesWorkspace
                        customers={true}
                        canReply={can(PERMISSIONS.MESSAGES_REPLY)}
                        canTicket={can(PERMISSIONS.HELP_CREATE) || can(PERMISSIONS.DEALS_CREATE) || can(PERMISSIONS.TICKETS_CREATE)}
                    />
                </Suspense>
            </div>
        </div>
    );
}
