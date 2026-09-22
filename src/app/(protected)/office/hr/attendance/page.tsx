import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import AttendanceRegister from "@/modules/hr/components/AttendanceRegister";

// /office/hr/attendance — the attendance register. The sidebar tick opens it (see layout); the grant decides what may be changed.
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_ATTENDANCE_EDIT);
    const selfId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    return <AttendanceRegister canEdit={canEdit} selfId={selfId} />;
}
