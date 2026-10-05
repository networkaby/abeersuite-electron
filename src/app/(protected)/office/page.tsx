/**
 * /office — Home dashboard.
 *
 * A greeting, then a grid of cards. Each card is one file under
 * `modules/home/cards/` and decides nothing about layout — to add one, write the
 * card and add it to the grid below with its own visibility rule.
 *
 *   My day          — everyone: the person's own work (POS shift for now).
 *   Business health — Purchase voucher ticks: working capital, liquid fund,
 *                     inventory value over a period (default 15 days).
 */

import { auth } from "@/auth";
import { ScrollArea } from "@/components/ui/scroll-area";
import { resolvedUserFromSession } from "@/shared/lib/auth/permissions";
import LiveRefresh from "@/shared/components/LiveRefresh";
import MyDayCard from "@/modules/home/cards/MyDayCard";
import BusinessHealthCard from "@/modules/home/cards/BusinessHealthCard";
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

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                <MyDayCard userId={user.id} permissions={user.permissions} />
                {canSeeBusinessHealth(user.permissions) && (
                    <div className="lg:col-span-2"><BusinessHealthCard /></div>
                )}
            </div>
        </div>
        </ScrollArea>
    );
}
