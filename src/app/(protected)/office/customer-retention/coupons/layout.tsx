import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";
// View rides the sidebar link grant; any coupon capability also opens the page.
export default makePermissionLayout([
    sidebarChildPermissionId("retention", "coupons"),
    PERMISSIONS.COUPONS_MANAGE,
    PERMISSIONS.COUPONS_CREATE,
    PERMISSIONS.COUPONS_EDIT,
    PERMISSIONS.COUPONS_DELETE,
    PERMISSIONS.COUPONS_DISCOUNT_EDIT,
]);
