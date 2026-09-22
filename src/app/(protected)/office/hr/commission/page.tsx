import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import CommissionBoard from "@/modules/hr/components/CommissionBoard";

// /office/hr/commission — each person's monthly sales target and commission
// scheme, and how the month is going against it. The sidebar tick opens it;
// setting or revising a scheme is pay and takes the same key as a salary
// revision (hr:staff:edit).
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    return <CommissionBoard canEdit={canEdit} />;
}
