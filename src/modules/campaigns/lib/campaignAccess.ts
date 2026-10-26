import { requireAnyPermission } from "@/shared/lib/auth/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

/** Reading and writing campaigns rides the Campaigns sidebar link (sending is campaigns:send). */
export const requireCampaignsPage = () => requireAnyPermission(sidebarChildPermissionId("campaigns", "campaigns"));

/** Posts ride the Compose or the Queue & Calendar sidebar tick — either one opens them. */
export const requirePostsPage = () =>
    requireAnyPermission(sidebarChildPermissionId("campaigns", "compose"), sidebarChildPermissionId("campaigns", "queue-calendar"));

/** Due Reminders' rules page. `settings:manage` too, from when it lived under Settings. */
export const requireDueRemindersPage = () =>
    requireAnyPermission(sidebarChildPermissionId("campaigns", "due-reminders"), "settings:manage");

/** The Scheduled list — and its Remove, which only edits the due-reminder Never remind list. */
export const requireScheduledPage = () =>
    requireAnyPermission(sidebarChildPermissionId("campaigns", "scheduled"), sidebarChildPermissionId("campaigns", "due-reminders"), "settings:manage");
