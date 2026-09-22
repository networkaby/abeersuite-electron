import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffExplorer from "@/modules/hr/components/StaffExplorer";

// /office/hr/staff — the Staff Directory, list-and-detail like the Cash Book:
// the staff on the left, the chosen person's profile on the right. The sidebar
// tick opens the page (see layout); the three gates below decide what may be
// done on it — the same three the /staff/[userId] page reads, because the same
// profile workspace is rendered in the right pane.
export default async function StaffDirectoryPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    return (
        <StaffExplorer
            canEdit={hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT)}
            canEditUsers={hasPermissionWithScope(permissions, PERMISSIONS.USERS_EDIT)}
            canEditPositions={hasPermissionWithScope(permissions, PERMISSIONS.POSITIONS_EDIT)}
        />
    );
}
