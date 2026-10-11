import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { MessagesWorkspace } from "@/modules/crm/components";

// /office/crm/messages — customer messages (WhatsApp now), one thread per number,
// linked to the customer by phone and to a ticket when there is work to do.
export default async function MessagesPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }
    const can = (id: string) => hasPermissionWithScope(permissions, id);

    return (
        <div className="h-full">
            <MessagesWorkspace
                canReply={can(PERMISSIONS.MESSAGES_REPLY)}
                canTicket={can(PERMISSIONS.HELP_CREATE) || can(PERMISSIONS.DEALS_CREATE) || can(PERMISSIONS.TICKETS_CREATE)}
            />
        </div>
    );
}
