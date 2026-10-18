import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

/** Reading and writing campaigns rides the Campaigns sidebar link (sending is campaigns:send). */
export const requireCampaignsPage = () => requireAnyPermission(sidebarChildPermissionId("campaigns", "campaigns"));
