import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { LoyaltyConfigForm } from "@/modules/loyalty/components/LoyaltyConfigForm";
import { LoyaltyEarnRules } from "@/modules/loyalty/components/LoyaltyEarnRules";
import { ratesFromConfig, expiryCutoff } from "@/modules/loyalty/lib";

export const metadata = { title: "Loyalty" };

export default async function LoyaltyHubPage() {
    const config = await prisma.loyaltyConfig.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    const rates = ratesFromConfig(config);
    const cutoff = expiryCutoff(new Date(), rates);

    const [categories, groups, products, outstandingAgg] = await Promise.all([
        prisma.invCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProductGroup.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProduct.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2000, select: { id: true, sku: true, name: true } }),
        // Org-wide outstanding points (in-window) — drives the read-only memo liability.
        prisma.loyaltyLot.aggregate({
            where: { pointsRemaining: { gt: 0 }, ...(cutoff ? { earnedAt: { gt: cutoff } } : {}) },
            _sum: { pointsRemaining: true },
        }),
    ]);
    const outstandingPts = outstandingAgg._sum.pointsRemaining ?? 0;
    const outstandingValue = outstandingPts * rates.redeemValue;
    const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <ScrollArea className="h-full" type="always">
            <div className="space-y-6 px-6 pt-3 pb-6">
                <div>
                    <h1 className="text-xl font-semibold">Loyalty</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Customer points wallet — earn at POS, redeem as a bill discount. Earning never touches the GL;
                        redemption posts to the dedicated &ldquo;Loyalty Points Redeemed&rdquo; ledger.
                    </p>
                </div>

                <Card className="max-w-xl">
                    <CardContent className="flex items-center justify-between p-4">
                        <div>
                            <div className="text-xs text-muted-foreground">Outstanding loyalty liability (memo)</div>
                            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtINR(outstandingValue)}</div>
                            <p className="mt-1 text-[11px] text-muted-foreground">{outstandingPts.toLocaleString("en-IN")} unexpired points × ₹{rates.redeemValue}/pt · not booked to the GL.</p>
                        </div>
                    </CardContent>
                </Card>

                <LoyaltyConfigForm />
                <LoyaltyEarnRules categories={categories} groups={groups} products={products} />
            </div>
        </ScrollArea>
    );
}
