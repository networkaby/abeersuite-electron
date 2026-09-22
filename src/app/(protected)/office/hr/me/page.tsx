import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import MyHrPage from "@/modules/hr/components/MyHrPage";

// /office/hr/me — "My Info". The one HR page a person is given for themselves.
//
// Nothing here is granted beyond the sidebar tick the layout already demands —
// the page shows the signed-in person's own record and offers no action on
// anybody else. The userId goes down only for the payslip route, which checks
// self-or-HR on its own side, and `isHr` only decides whether the leave-notice
// rule binds him when he asks for leave.
export default async function Page() {
    const session = await auth();
    const userId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const isHr = hasPermissionWithScope(permissions, PERMISSIONS.HR_LEAVE_APPROVE);
    return <MyHrPage userId={userId} isHr={isHr} />;
}
