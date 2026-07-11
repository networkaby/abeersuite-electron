import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
export default makePermissionLayout([
    PERMISSIONS.BRANCHES_CREATE,
    PERMISSIONS.BRANCHES_EDIT,
    PERMISSIONS.BRANCHES_DELETE,
]);
