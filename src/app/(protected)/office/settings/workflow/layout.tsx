import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { WorkflowTabsNav } from "@/modules/admin/components/WorkflowTabsNav";

// Section gate: workflow masters (statuses, pipelines, workers, works) are part
// of Settings — managing them rides settings:manage. Granular per-user gates for
// *using* these masters live in the consuming modules (repair, etc.).
export default async function WorkflowLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.SETTINGS_MANAGE)) {
        redirect("/office/work-flow-inbox");
    }
    return (
        <div className="flex h-full flex-col">
            <div className="flex-none px-6 pt-3">
                <WorkflowTabsNav />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
