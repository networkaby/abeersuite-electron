import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { CallLogWorkspace } from "@/modules/crm/components";

// /office/crm/call-log — raw PBX call stream for triage (create lead / flag spam).
export default async function CallLogPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="h-full">
            <CallLogWorkspace />
        </div>
    );
}
