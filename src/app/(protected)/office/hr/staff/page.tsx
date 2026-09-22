import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffDirectory from "@/modules/hr/components/StaffDirectory";

// /office/hr/staff — the Staff Directory. The sidebar tick opens it (see layout);
// hr:staff:edit decides what you may do on it (add, edit, mark as left).
export default async function StaffDirectoryPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    return <StaffDirectory canEdit={canEdit} />;
}
