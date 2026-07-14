import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Coins, BadgeCheck, BadgeX } from "lucide-react";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { LoyaltyConfigForm } from "@/modules/loyalty/components/LoyaltyConfigForm";
import { LoyaltyEarnRules } from "@/modules/loyalty/components/LoyaltyEarnRules";
import { LoyaltyMilestones } from "@/modules/loyalty/components/LoyaltyMilestones";
import { ratesFromConfig, expiryCutoff } from "@/modules/loyalty/lib";

export const metadata = { title: "Loyalty" };

const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function LoyaltyHubPage() {
    const config = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const rates = ratesFromConfig(config);
    const cutoff = expiryCutoff(new Date(), rates);

    const [categories, groups, products, outstandingAgg] = await Promise.all([
        prisma.invCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProductGroup.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProduct.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2000, select: { id: true, sku: true, name: true } }),
        prisma.loyaltyLot.aggregate({
            where: { pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
            _sum: { pointsRemaining: true },
        }),
    ]);
    const outstandingPts = outstandingAgg._sum.pointsRemaining ?? 0;
    const outstandingValue = outstandingPts * rates.redeemValue;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-6 px-6 pt-4 pb-10">
                {/* Header */}
                {/* <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Gift size={22} />
                    </div>
                    <div>
                        <h1 className="text-xl font-semibold leading-tight">Loyalty Program</h1>
                        <p className="text-sm text-muted-foreground">
                            Customers earn points at POS and redeem them as a bill discount. Earning is off-book; redemption posts to the dedicated &ldquo;Loyalty Points Redeemed&rdquo; ledger.
                        </p>
                    </div>
                </div> */}

                {/* Stat strip */}
                <div className="grid gap-3 sm:grid-cols-3">
                    <Card className="border-l-4 border-l-amber-400">
                        <CardContent className="p-4">
                            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Coins size={14} /> Outstanding liability</div>
                            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtINR(outstandingValue)}</div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">memo only — not booked to the GL</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs font-medium text-muted-foreground">Unexpired points</div>
                            <div className="mt-1 text-2xl font-semibold tabular-nums">{outstandingPts.toLocaleString("en-IN")}</div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">worth ₹{rates.redeemValue}/pt across all customers</p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="p-4">
                            <div className="text-xs font-medium text-muted-foreground">Program status</div>
                            <div className={`mt-1 flex items-center gap-1.5 text-lg font-semibold ${config.enabled ? "text-emerald-600" : "text-muted-foreground"}`}>
                                {config.enabled ? <><BadgeCheck size={18} /> Active</> : <><BadgeX size={18} /> Off</>}
                            </div>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                                {config.enabled
                                    ? `earning ${config.earnEnabled ? "on" : "off"} · redeeming ${config.redeemEnabled ? "on" : "off"} · ${rates.expiryEnabled ? `expiry ${rates.expiryDays}d` : "no expiry"}`
                                    : "earning & redeeming paused"}
                            </p>
                        </CardContent>
                    </Card>
                </div>

                <LoyaltyConfigForm />
                <LoyaltyEarnRules categories={categories} groups={groups} products={products} />
                <LoyaltyMilestones />
            </div>
        </ScrollArea>
    );
}
