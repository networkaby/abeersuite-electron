import { auth } from "@/auth";
import { notFound, redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffProfileWorkspace from "@/modules/hr/components/StaffProfileWorkspace";

// /office/hr/staff/[userId] — one staff member's HR profile (Job / Pay / Money).
export default async function StaffProfilePage({ params }: { params: Promise<{ userId: string }> }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }
    const userId = Number((await params).userId);
    if (!Number.isInteger(userId) || userId <= 0) notFound();

    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    return <StaffProfileWorkspace userId={userId} canEdit={canEdit} />;
}
