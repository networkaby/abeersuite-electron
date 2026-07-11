import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
export default makePermissionLayout([
    PERMISSIONS.POS_COUNTERS_CREATE,
    PERMISSIONS.POS_COUNTERS_EDIT,
    PERMISSIONS.POS_COUNTERS_DELETE,
]);
