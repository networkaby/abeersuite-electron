import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import PayrollRunList from "@/modules/hr/components/PayrollRunList";

// /office/hr/payroll — the monthly runs. Nav access decides "may you open it";
// hr:payroll:run decides whether you may generate and post one.
export default async function PayrollPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }
    const canRun = hasPermissionWithScope(permissions, PERMISSIONS.HR_PAYROLL_RUN);
    return <PayrollRunList canRun={canRun} />;
}
