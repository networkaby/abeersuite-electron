import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
export default makePermissionLayout([
    PERMISSIONS.POSITIONS_MANAGE,
    PERMISSIONS.POSITIONS_CREATE,
    PERMISSIONS.POSITIONS_EDIT,
    PERMISSIONS.POSITIONS_DELETE,
]);
