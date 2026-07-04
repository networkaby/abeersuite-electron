import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default makePermissionLayout([
    PERMISSIONS.ROLES_MANAGE,
    PERMISSIONS.ROLES_CREATE,
    PERMISSIONS.ROLES_EDIT_ORG,
    PERMISSIONS.ROLES_DELETE_ORG,
]);
