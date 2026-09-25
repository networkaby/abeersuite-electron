import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import EmployeePortal from "@/modules/hr/components/portal/EmployeePortal";

// /office/me — the Employee Portal. The one page every staff member has about
// themselves: work, leave, pay, their own details, and the social wall last.
//
// No permission tick and none is missing: it is a FREE ROUTE (freeRoutes.ts),
// it shows the signed-in person's own record and offers no action on anybody
// else. The id goes down only so the two per-person routes (staff record,
// profile) are asked about the session user — never about a colleague.
export default async function Page() {
    const session = await auth();
    const user = session?.user as { id?: string; permissions?: string[] } | undefined;
    const userId = Number(user?.id ?? 0);
    if (!userId) redirect("/login");
    const perms = user?.permissions ?? [];
    return (
        <EmployeePortal
            userId={userId}
            canPaySalary={hasPermissionWithScope(perms, PERMISSIONS.HR_PAYROLL_RUN)}
            canOpenHr={hasModuleNavAccess(perms, "hr")}
        />
    );
}
