import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PayRulesCard from "@/modules/hr/components/PayRulesCard";

// /office/hr/pay-rules — how time turns into money. Preview only for now: the
// screen exists so the rules can be agreed before they are stored and wired into
// the payroll run. Nav access opens it; the grant decides what may be changed.
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) redirect("/office/work-flow-inbox");
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_ATTENDANCE_EDIT);
    return <PayRulesCard canEdit={canEdit} />;
}
