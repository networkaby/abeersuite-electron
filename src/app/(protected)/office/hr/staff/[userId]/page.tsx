import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffProfileWorkspace from "@/modules/hr/components/StaffProfileWorkspace";

// /office/hr/staff/[userId] — one staff member's HR profile.
//
// Three separate gates, because the tabs do three different kinds of work:
// hr:staff:edit for the HR record, users:edit for the role / scope / password,
// positions:edit for the seat. A person holding only the first sees the Access
// and Seats surfaces read-only rather than being sent to Administration.
export default async function StaffProfilePage({ params }: { params: Promise<{ userId: string }> }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }
    const userId = Number((await params).userId);
    if (!Number.isInteger(userId) || userId <= 0) notFound();

    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    const canEditUsers = hasPermissionWithScope(permissions, PERMISSIONS.USERS_EDIT);
    const canEditPositions = hasPermissionWithScope(permissions, PERMISSIONS.POSITIONS_EDIT);
    return (
        <StaffProfileWorkspace
            userId={userId}
            canEdit={canEdit}
            canEditUsers={canEditUsers}
            canEditPositions={canEditPositions}
        />
    );
}
