/**
 * /office — Home dashboard.
 *
 * A greeting, then a wrapping row of cards. Each card is one file under
 * `modules/home/cards/` and decides nothing about layout — to add one, write the
 * card and add it to the row below with its own visibility rule.
 *
 *   Timeline        — everyone on a counter: today's duty ruler, above the cards.
 *   My day          — everyone: the person's own work (POS shift for now).
 *   Business health — Purchase voucher ticks: three cards — working capital,
 *                     liquid fund, inventory value — each with its own period
 *                     (default 15 days); Cash flow; Cash runway; Sales and
 *                     net profit by month (a full row).
 */

import { auth } from "@/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import LiveRefresh from "@/shared/components/LiveRefresh";
import MyDayCard from "@/modules/home/cards/MyDayCard";
import MyTimelineCard from "@/modules/home/cards/MyTimelineCard";
import BusinessHealthCard from "@/modules/home/cards/BusinessHealthCard";
import CashFlowCard from "@/modules/home/cards/CashFlowCard";
import CashRunwayCard from "@/modules/home/cards/CashRunwayCard";
import SalesProfitCard from "@/modules/home/cards/SalesProfitCard";
import { canSeeBusinessHealth } from "@/modules/home/lib/businessHealth";

export default async function OfficePage() {
    const session = await auth();

    // Resolve user — safe to cast: layout already redirected non-staff & unauthenticated
    const user = resolvedUserFromSession(session ?? {});
    const name = (session?.user as { name?: string })?.name ?? "there";

    const hour = new Date().getHours();
    const greeting =
        hour < 12 ? "Good morning" :
        hour < 17 ? "Good afternoon" :
                    "Good evening";

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            {/* My day is server-rendered; re-render when a shift opens or closes. */}
            <LiveRefresh topics={["ledger"]} />
            <div>
                <h1 className="text-2xl font-bold text-foreground">
                    {greeting}, {name}! 👋
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </p>
            </div>

            <MyTimelineCard />

            {/* Flex, not grid: each card takes half a row (two across) and wraps to
                full width when the screen is too narrow for two. */}
            <div className="flex flex-wrap items-start gap-4 *:min-w-[min(100%,420px)] *:flex-[1_1_calc(50%-0.5rem)]">
                <MyDayCard userId={user.id} permissions={user.permissions} />
                {canSeeBusinessHealth(user.permissions) && (
                    <>
                        <BusinessHealthCard metric="workingCapital" />
                        <BusinessHealthCard metric="liquidFund" />
                        <BusinessHealthCard metric="inventory" />
                        <CashFlowCard />
                        <CashRunwayCard />
                        {/* Twelve months need the whole row. */}
                        <div className="basis-full!"><SalesProfitCard /></div>
                    </>
                )}
            </div>
        </div>
        </ScrollArea>
    );
}
