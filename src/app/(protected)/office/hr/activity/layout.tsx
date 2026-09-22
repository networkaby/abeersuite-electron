import { makePermissionLayout } from "@/shared/lib/auth/makePermissionLayout";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

// /office/hr/activity — Employee Activity — the sidebar tick IS the view gate,
// the same way every HR page works: holding Attendance must not hand out this
// one, because this is where a person's hours and stretches are readable.
export default makePermissionLayout(sidebarChildPermissionId("hr", "activity"));
