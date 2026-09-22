import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PayrollRunList from "@/modules/hr/components/PayrollRunList";

// /office/hr/payroll — the monthly runs. The sidebar tick opens it (see layout);
// hr:payroll:run decides whether you may generate and post one.
export default async function PayrollPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canRun = hasPermissionWithScope(permissions, PERMISSIONS.HR_PAYROLL_RUN);
    const canGive = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    return <PayrollRunList canRun={canRun} canGive={canGive} />;
}
