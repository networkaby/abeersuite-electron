/**
 * /office — Role-Aware Home Page
 *
 * Four-layer design (per docs/modules/home.md):
 *
 *   LAYER 1 — Universal Customer Panel (everyone, always)
 *     Quick product lookup + repair status + 3 log buttons (Sales/Helpdesk/Internal)
 *
 *   LAYER 2 — Branch filter
 *     Data inside widgets is already scoped by session.branchIds + activeBranch.
 *
 *   LAYER 3 — Department-based layout
 *     Each department sees a briefing card tailored to their work:
 *       DEP-REPAIR  → RepairBriefing
 *       DEP-SALES   → ShowroomBriefing
 *       DEP-DESK    → ShowroomBriefing
 *       DEP-FIN     → FinanceBriefing (links only)
 *       DEP-IT      → AdminBriefing
 *       DEP-HR      → HrBriefing
 *       DEP-DESP    → DespatchBriefing
 *
 *   LAYER 4 — Position-wise buttons
 *     Gated inside each briefing component with hasPermission(). Admin bypass
 *     users see the AdminBriefing regardless of department.
 *
 * If a user has MULTIPLE departments, all their briefings are stacked.
 * If a user has ZERO departments, a "no department assigned" fallback shows.
 */

import { auth } from "@/auth";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import UniversalCustomerPanel from "@/modules/home/UniversalCustomerPanel";
import {
    RepairBriefing,
    ShowroomBriefing,
    FinanceBriefing,
    AdminBriefing,
    DespatchBriefing,
    HrBriefing,
    NoDeptCard,
} from "@/modules/home/DeptBriefings";

// Map stable Department.id → which briefing component to render.
// "admin" is a virtual key used for admin:bypass users regardless of dept.
type DeptKey =
    | "DEP-REPAIR"
    | "DEP-SALES"
    | "DEP-DESK"
    | "DEP-FIN"
    | "DEP-IT"
    | "DEP-HR"
    | "DEP-DESP"
    | "admin";

export default async function OfficePage() {
    const session = await auth();

    // Resolve user — safe to cast: layout already redirected non-staff & unauthenticated
    const user = resolvedUserFromSession(session ?? {});
    const name = (session?.user as { name?: string })?.name ?? "there";

    // Determine which department briefings to show
    const deptIds = user.departmentIds as string[];
    const isAdmin = user.permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    // Deduplicate and collect the set of briefings to render
    const deptSet = new Set<DeptKey>();

    if (isAdmin) {
        deptSet.add("admin");
    }

    for (const id of deptIds) {
        switch (id as DeptKey) {
            case "DEP-REPAIR": deptSet.add("DEP-REPAIR"); break;
            case "DEP-SALES":  deptSet.add("DEP-SALES");  break;
            case "DEP-DESK":   deptSet.add("DEP-DESK");   break;
            case "DEP-FIN":    deptSet.add("DEP-FIN");    break;
            case "DEP-IT":     deptSet.add("DEP-IT");     break;
            case "DEP-HR":     deptSet.add("DEP-HR");     break;
            case "DEP-DESP":   deptSet.add("DEP-DESP");   break;
        }
    }

    // DEP-SALES and DEP-DESK both use ShowroomBriefing — collapse to one
    const showShowroom = deptSet.has("DEP-SALES") || deptSet.has("DEP-DESK");

    // Greeting line (morning / afternoon / evening)
    const hour = new Date().getHours();
    const greeting =
        hour < 12 ? "Good morning" :
        hour < 17 ? "Good afternoon" :
                    "Good evening";

    return (
        <div className="space-y-6 pb-8">
            {/* Greeting */}
            <div>
                <h1 className="text-2xl font-bold text-foreground">
                    {greeting}, {name}! 👋
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </p>
            </div>

            {/* Layer 1: Universal Customer Panel — shown to everyone */}
            <UniversalCustomerPanel />

            {/* Layers 3 & 4: Department briefings */}
            {deptSet.size === 0 ? (
                <NoDeptCard name={name} />
            ) : (
                <div className="space-y-4">
                    {deptSet.has("admin") && <AdminBriefing />}
                    {deptSet.has("DEP-REPAIR") && <RepairBriefing userId={user.id} isAdmin={isAdmin} />}
                    {showShowroom && <ShowroomBriefing />}
                    {deptSet.has("DEP-FIN") && <FinanceBriefing />}
                    {deptSet.has("DEP-DESP") && <DespatchBriefing />}
                    {deptSet.has("DEP-HR") && <HrBriefing />}
                    {/* DEP-IT users: show AdminBriefing (already handled by "admin" key above,
                        but if they're not admin:bypass, show it separately) */}
                    {deptSet.has("DEP-IT") && !isAdmin && <AdminBriefing />}
                </div>
            )}
        </div>
    );
}
