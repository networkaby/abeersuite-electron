import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { SIDEBAR_MODULES } from "@/shared/lib/auth/sidebarModules";

// Any one Campaigns sidebar tick opens the folder; each page is then locked by its
// own tick in proxy.ts (pageAccess.ts), so Compose alone does not open Broadcast.
export default makePermissionLayout(SIDEBAR_MODULES.find((m) => m.key === "campaigns")?.childPermissionIds ?? []);
