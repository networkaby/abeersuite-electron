import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default makePermissionLayout(PERMISSIONS.ROLES_MANAGE);
