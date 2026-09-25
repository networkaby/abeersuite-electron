import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffExplorer from "@/modules/hr/components/StaffExplorer";

// /office/hr/staff — the Staff Directory, list-and-detail like the Cash Book:
// the staff on the left, the chosen person's profile on the right. The sidebar
// tick opens the page (see layout); the gates below decide what may be done on
// it, and they are passed through to the profile workspace in the right pane
// (`?user=<id>`). Adding and editing a login use the same keys and the same
// API as Admin → Users; deleting one is done on Admin → Users only.
export default async function StaffDirectoryPage() {
    const session = await auth();
    const user = session?.user as { permissions?: string[] } | undefined;
    const permissions = user?.permissions ?? [];
    return (
        <StaffExplorer
            canEdit={hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT)}
            canCreateUsers={hasPermissionWithScope(permissions, PERMISSIONS.USERS_CREATE)}
            canEditUsers={hasPermissionWithScope(permissions, PERMISSIONS.USERS_EDIT)}
            canEditPositions={hasPermissionWithScope(permissions, PERMISSIONS.POSITIONS_EDIT)}
        />
    );
}
