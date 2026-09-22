import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// /office/hr/commission — targets & commission — the sidebar tick IS the view
// gate, like every other HR page: holding one HR link must not open the others.
export default makePermissionLayout(sidebarChildPermissionId("hr", "commission"));
