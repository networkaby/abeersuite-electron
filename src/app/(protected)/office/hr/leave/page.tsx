import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import LeaveBoard from "@/modules/hr/components/LeaveBoard";

// /office/hr/leave — leave requests. Nav access opens it; the grant decides what may be changed.
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) redirect("/office/work-flow-inbox");
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_LEAVE_APPROVE);
    const selfId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    return <LeaveBoard canEdit={canEdit} selfId={selfId} />;
}
