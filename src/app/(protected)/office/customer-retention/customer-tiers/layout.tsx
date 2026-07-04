import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
// View rides the sidebar link grant; any spend-tier capability also opens the page.
export default makePermissionLayout([
    sidebarChildPermissionId("retention", "spend-tiers"),
    PERMISSIONS.TIERS_MANAGE,
    PERMISSIONS.TIERS_CREATE,
    PERMISSIONS.TIERS_EDIT,
    PERMISSIONS.TIERS_DELETE,
]);
