import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
// View rides the sidebar link grant; any protection capability also opens the page.
export default makePermissionLayout([
    sidebarChildPermissionId("retention", "protection"),
    PERMISSIONS.RETENTION_PROTECTION_MANAGE,
]);
