import Link from "next/link";
import { Store, User } from "lucide-react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { BUSINESS_TIME_ZONE } from "@/shared/lib/constants/business";

/**
 * Home "My day" card — the signed-in person's own work snapshot. Starts with the
 * POS shift; attendance, leave, salary and notices join as each goes live.
 */
export default async function MyDayCard({ userId, permissions }: { userId: number; permissions: string[] }) {
    const canRunTill = hasPermissionWithScope(permissions, "pos:shift:open", false);
    const shift = await prisma.posShift.findFirst({
        where: { userId, status: "OPEN" },
        select: { openedAt: true, counter: { select: { name: true } } },
    });

    return (
        <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
                <User size={16} className="text-primary" />
                <h2 className="text-sm font-semibold text-foreground">My day</h2>
            </div>

            {shift || canRunTill ? (
                <Link
                    href="/vouchers/pos"
                    className="mt-3 flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 hover:bg-muted/70 transition-colors"
                >
                    <div>
                        <p className="text-xs text-muted-foreground">My POS shift</p>
                        <p className={`text-base font-semibold ${shift ? "text-emerald-600" : "text-foreground"}`}>
                            {shift
                                ? `Open since ${shift.openedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: BUSINESS_TIME_ZONE })}`
                                : "No shift open"}
                        </p>
                    </div>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Store size={14} />
                        {shift?.counter.name ?? "Open POS Register"}
                    </span>
                </Link>
            ) : (
                <p className="mt-3 text-sm text-muted-foreground">Your attendance, leave and notices will show here.</p>
            )}
        </section>
    );
}
