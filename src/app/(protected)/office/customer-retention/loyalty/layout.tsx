import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
// View rides the sidebar link grant; any loyalty capability also opens the page.
export default makePermissionLayout([
    sidebarChildPermissionId("retention", "loyalty"),
    PERMISSIONS.LOYALTY_MANAGE,
    PERMISSIONS.LOYALTY_CREATE,
    PERMISSIONS.LOYALTY_EDIT,
    PERMISSIONS.LOYALTY_DELETE,
]);
