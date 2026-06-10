import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { WorkflowTabsNav } from "@/modules/admin/components/WorkflowTabsNav";

// Section gate: reachable with EITHER statuses or pipelines access (the four
// tabs each keep their own per-page gate, so e.g. Pipelines still needs
// settings:pipelines).
export default async function WorkflowLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const allowed = [PERMISSIONS.SETTINGS_STATUSES, PERMISSIONS.SETTINGS_PIPELINES];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !allowed.some((p) => permissions.includes(p))) {
        redirect("/office/core/assignments");
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
