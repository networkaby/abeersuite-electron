import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import StaffDirectory from "@/modules/hr/components/StaffDirectory";

// /office/hr/staff — the Staff Directory. Nav access decides "may you open it";
// hr:staff:edit decides what you may do on it (add, edit, mark as left).
export default async function StaffDirectoryPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }
    const canEdit = hasPermissionWithScope(permissions, PERMISSIONS.HR_STAFF_EDIT);
    return <StaffDirectory canEdit={canEdit} />;
}
