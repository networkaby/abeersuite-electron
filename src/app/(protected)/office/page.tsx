/**
 * /office — Permission-Aware Home Page
 *
 * Layout (departments deferred — see PROJECT_BRAIN "Known gotchas"):
 *
 *   LAYER 1 — Universal Customer Panel (everyone, always)
 *     Quick product lookup + repair status + 3 log buttons (Sales/Helpdesk/Internal)
 *
 *   LAYER 2 — Branch filter
 *     Data inside widgets is already scoped by session.branchIds + activeBranch.
 *
 *   LAYER 3 — Briefing cards, gated by PERMISSION (not department)
 *     Every user sees the SAME dashboard; each briefing card appears only when
 *     the user holds a representative permission for that area, and admin:bypass
 *     sees all. Action buttons inside each card stay permission-gated.
 *
 *   Department-based layout (one card per department) is deferred until the
 *   department feature ships; until then departments are cosmetic and the
 *   dashboard is common + permission-driven.
 */

import { auth } from "@/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import { hasPermissionWithScope, hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import UniversalCustomerPanel from "@/modules/home/UniversalCustomerPanel";
import {
    RepairBriefing,
    ShowroomBriefing,
    FinanceBriefing,
    AdminBriefing,
    DespatchBriefing,
    HrBriefing,
    AllClearCard,
} from "@/modules/home/DeptBriefings";

export default async function OfficePage() {
    const session = await auth();

    // Resolve user — safe to cast: layout already redirected non-staff & unauthenticated
    const user = resolvedUserFromSession(session ?? {});
    const name = (session?.user as { name?: string })?.name ?? "there";

    const isAdmin = user.permissions.includes(PERMISSIONS.ADMIN_BYPASS);

    // Which briefing cards to render — gated by PERMISSION, not department.
    // `hasPermissionWithScope` short-circuits true on admin:bypass and accepts
    // any scope at or above the one named, so a holder of e.g. tickets:view:org
    // still matches the tickets:view:own gate below.
    const can = (permissionId: string) => hasPermissionWithScope(user.permissions, permissionId);

    const showAdmin    = isAdmin || can("users:manage") || can("settings:manage") || can("roles:manage");
    // Repair permission layer is being rebuilt — gate the card on repair sidebar-nav
    // access (new visibility model) instead of the removed tickets:* permissions.
    const showRepair   = hasModuleNavAccess(user.permissions, "repair");
    const showShowroom = can("pos:shift:open") || can("pos:shift:view:branch");
    const showFinance  = can("accountancy:view:own") || can("finance:voucher:create");
    const showDespatch = can("inventory:view:branch");
    const showHr       = can("users:manage");

    const anyCard = showAdmin || showRepair || showShowroom || showFinance || showDespatch || showHr;

    // Greeting line (morning / afternoon / evening)
    const hour = new Date().getHours();
    const greeting =
        hour < 12 ? "Good morning" :
        hour < 17 ? "Good afternoon" :
                    "Good evening";

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
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

            {/* Layer 3: Permission-gated briefings (common dashboard, department-agnostic) */}
            {anyCard ? (
                <div className="space-y-4">
                    {showAdmin && <AdminBriefing />}
                    {showRepair && <RepairBriefing userId={user.id} isAdmin={isAdmin} />}
                    {showShowroom && <ShowroomBriefing />}
                    {showFinance && <FinanceBriefing />}
                    {showDespatch && <DespatchBriefing />}
                    {showHr && <HrBriefing />}
                </div>
            ) : (
                <AllClearCard name={name} />
            )}
        </div>
        </ScrollArea>
    );
}
