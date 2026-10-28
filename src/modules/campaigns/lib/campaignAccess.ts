import { requireAnyPermission, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
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

/** Reading the Google connection: the Channels page, or anyone who posts (Post to Google shows it). */
export const requireGoogleStatus = () =>
    requireAnyPermission(
        sidebarChildPermissionId("campaigns", "channels"),
        sidebarChildPermissionId("campaigns", "compose"),
        sidebarChildPermissionId("campaigns", "queue-calendar"),
        PERMISSIONS.CAMPAIGNS_GOOGLE_CONNECT,
    );

/** Connecting, picking the listing and disconnecting Google — its own tick. */
export const requireGoogleConnect = () => requirePermission(PERMISSIONS.CAMPAIGNS_GOOGLE_CONNECT);

/** Reading the Facebook connection: the Channels page, or anyone who posts (Post to Facebook shows it). */
export const requireFacebookStatus = () =>
    requireAnyPermission(
        sidebarChildPermissionId("campaigns", "channels"),
        sidebarChildPermissionId("campaigns", "compose"),
        sidebarChildPermissionId("campaigns", "queue-calendar"),
        PERMISSIONS.CAMPAIGNS_FACEBOOK_CONNECT,
    );

/** Connecting, picking the page and disconnecting Facebook — its own tick. */
export const requireFacebookConnect = () => requirePermission(PERMISSIONS.CAMPAIGNS_FACEBOOK_CONNECT);
