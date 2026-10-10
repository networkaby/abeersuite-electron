import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import InboxModule from "@/modules/message/components/InboxModule";
import { Loader2 } from "lucide-react";

export default async function InboxPage() {
    const session = await auth();
    const userId   = session?.user?.id   ? parseInt(session.user.id, 10) : undefined;
    const userName = session?.user?.name ?? undefined;
    // Staff chats now live beside the customers in CRM → Messages; only staff
    // without CRM keep this standalone page.
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (hasModuleNavAccess(permissions, "crm")) redirect("/office/crm/messages?filter=all");

    return (
        <Suspense fallback={
            <div className="flex h-full items-center justify-center">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
            </div>
        }>
            <InboxModule currentUserId={userId} currentUserName={userName} />
        </Suspense>
    );
}
