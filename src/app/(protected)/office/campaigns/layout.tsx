import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// Opens on the Campaigns sidebar link; writing campaigns rides the same tick.
export default makePermissionLayout([sidebarChildPermissionId("campaigns", "campaigns")]);
