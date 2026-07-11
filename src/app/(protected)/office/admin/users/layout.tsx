import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
export default makePermissionLayout([
    PERMISSIONS.USERS_CREATE,
    PERMISSIONS.USERS_EDIT_ORG,
    PERMISSIONS.USERS_DELETE_ORG,
]);
