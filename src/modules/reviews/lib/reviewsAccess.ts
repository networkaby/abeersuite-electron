import { requireAnyPermission, requirePermission } from "@/shared/lib/auth/permissions";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { sidebarChildPermissionId } from "@/shared/lib/auth/sidebarModules";

/** Reading reviews rides the CRM → Reviews sidebar link (or the reply tick). */
export const requireReviewsPage = () => requireAnyPermission(sidebarChildPermissionId("crm", "reviews"), PERMISSIONS.REVIEWS_REPLY);

/** Replying is public on Google, and Refresh spends Google quota — its own tick. */
export const requireReviewsReply = () => requirePermission(PERMISSIONS.REVIEWS_REPLY);
