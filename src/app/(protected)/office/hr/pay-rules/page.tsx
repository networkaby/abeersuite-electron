import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PayRulesCard from "@/modules/hr/components/PayRulesCard";

// /office/hr/pay-rules — how time turns into money. Preview only for now: the
// screen exists so the rules can be agreed before they are stored and wired into
// the payroll run. The sidebar tick opens it (see layout); the grant decides what may be changed.
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_ATTENDANCE_EDIT);
    return <PayRulesCard canEdit={canEdit} />;
}
