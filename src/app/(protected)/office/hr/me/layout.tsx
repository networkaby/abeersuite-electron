import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// /office/hr/me — My Info. This is THE tick a staff member is given: it opens
// this page and, because HR is gated page by page, nothing else in the module.
export default makePermissionLayout(sidebarChildPermissionId("hr", "me"));
