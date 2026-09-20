import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import HolidayList from "@/modules/hr/components/HolidayList";

// /office/hr/holidays — the holiday list. Nav access opens it; the grant decides what may be changed.
export default async function Page() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) redirect("/office/work-flow-inbox");
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_ATTENDANCE_EDIT);
    const selfId = Number((session?.user as { id?: string } | undefined)?.id ?? 0);
    return <HolidayList canEdit={canEdit} selfId={selfId} />;
}
