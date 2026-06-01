import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { LoyaltyConfigForm } from "@/modules/loyalty/components/LoyaltyConfigForm";
import { LoyaltyEarnRules } from "@/modules/loyalty/components/LoyaltyEarnRules";

export const metadata = { title: "Loyalty" };

export default async function LoyaltyHubPage() {
    const [categories, groups, products] = await Promise.all([
        prisma.invCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProductGroup.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProduct.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2000, select: { id: true, sku: true, name: true } }),
    ]);

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
                <LoyaltyConfigForm />
                <LoyaltyEarnRules categories={categories} groups={groups} products={products} />
            </div>
        </ScrollArea>
    );
}
