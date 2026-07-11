import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
// View rides the sidebar link grant; any gift-card capability also opens the page.
export default makePermissionLayout([
    sidebarChildPermissionId("retention", "gift-cards"),
    PERMISSIONS.GIFT_CARDS_CREATE,
    PERMISSIONS.GIFT_CARDS_EDIT,
    PERMISSIONS.GIFT_CARDS_DELETE,
]);
