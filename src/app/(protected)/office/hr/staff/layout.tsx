import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// /office/hr/staff — Staff Directory — the sidebar tick IS the view gate. HR is ticked page by page in the
// Role matrix, so holding one HR link must not open the others: the area layout
// only says "you belong in HR", this one says "you may open this page".
export default makePermissionLayout(sidebarChildPermissionId("hr", "staff"));
