import { REPAIR_PIPELINE_NAME } from "@/modules/repairing/lib/repairPipeline";
import { DEALS_PIPELINE_NAME } from "@/modules/deals/lib/dealsPipeline";
import { HELP_PIPELINE_NAME } from "@/modules/help/lib/helpPipeline";
import { ADMIN_TASKS_PIPELINE_ID } from "@/modules/administration/lib/adminPipeline";

/**
 * Sidebar count badges — the registry.
 *
 * A "surface" is one list a user looks at. Each gets its own per-user seen marker
 * (UserSurfaceSeen), so opening CRM never clears Help Desk. Adding a badge means
 * adding a row here plus the href in Sidebar's `navCounts`, nothing else.
 *
 * An open ticket is counted in exactly ONE badge: its module while it sits in a
 * plain status, the Work Inbox once it lands in a work-bearing sub-status. The
 * count follows the ticket as it moves — see getNavCounts.
 */

/**
 * Surface keys. Stored in UserSurfaceSeen.surface, so renaming one silently resets
 * everybody's marker for it — treat these as data, not labels.
 */
export const NAV_SURFACE = {
    /** Not a pipeline list — the Work Inbox has its own rule (see getNavCounts). */
    workInbox: "work-inbox",
    repair: "repair",
    deals: "deals",
    help: "help",
    administration: "administration",
} as const;

export type NavSurfaceKey = (typeof NAV_SURFACE)[keyof typeof NAV_SURFACE];

export const WORK_INBOX_SURFACE = NAV_SURFACE.workInbox;

export type NavSurface = {
    key: NavSurfaceKey;
    /** Pipelines are looked up by name, except Administration which is seeded by id. */
    pipelineName?: string;
    pipelineId?: string;
};

export const PIPELINE_NAV_SURFACES: NavSurface[] = [
    { key: NAV_SURFACE.repair,         pipelineName: REPAIR_PIPELINE_NAME },
    { key: NAV_SURFACE.deals,          pipelineName: DEALS_PIPELINE_NAME },
    { key: NAV_SURFACE.help,           pipelineName: HELP_PIPELINE_NAME },
    { key: NAV_SURFACE.administration, pipelineId: ADMIN_TASKS_PIPELINE_ID },
];

/** Every valid surface key — the /api/nav/seen route validates against this. */
export const ALL_NAV_SURFACES: string[] = Object.values(NAV_SURFACE);

export type SurfaceCount = { all: number; new: number };
export type NavCounts = Record<string, SurfaceCount>;

/**
 * The whole /api/nav/counts payload.
 *
 * The two chat badges ride along with the surface badges rather than polling for
 * themselves — one request per tick instead of three. They are not surfaces (no
 * seen marker, no `new` half), so they sit beside `surfaces`, not inside it.
 */
export type NavCountsPayload = {
    surfaces: NavCounts;
    /** Unread chat messages across every room this user can see. */
    inboxUnread: number;
    /** Unread messages in this user's system room — the notification bell badge. */
    notificationUnread: number;
};
