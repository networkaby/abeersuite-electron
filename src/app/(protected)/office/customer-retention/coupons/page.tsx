import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { CouponPage } from "@/modules/coupons/components/CouponPage";
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
            <div className="px-6 pt-3 pb-3">
                <CouponPage masters={{ categories, products, groups, brands }} brandName={org.brandName} />
            </div>
        </ScrollArea>
    );
}
