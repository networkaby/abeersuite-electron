import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { CouponList } from "@/modules/coupons/components/CouponList";
import { CouponConfigCard } from "@/modules/coupons/components/CouponConfigCard";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";

export const metadata = { title: "Coupons" };

export default async function CouponsPage() {
    const [categories, products, groups, brands, org] = await Promise.all([
        prisma.invCategory.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invProduct.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2000, select: { id: true, sku: true, name: true } }),
        prisma.invProductGroup.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        prisma.invBrand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
        getOrganisation(),
    ]);

    return (
        <ScrollArea className="h-full" type="always">
            <div className="w-full space-y-5 px-6 pt-4 pb-10">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Coupons</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        Promotions for POS &amp; the online shop. Non-stackable coupons replace the spend-tier discount and block loyalty redemption.
                    </p>
                </div>
                <CouponConfigCard />
                <CouponList masters={{ categories, products, groups, brands }} brandName={org.brandName} />
            </div>
        </ScrollArea>
    );
}
