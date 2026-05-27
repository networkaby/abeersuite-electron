import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { OrgDefaultsForm } from "@/modules/settings/components/OrgDefaultsForm";

export const metadata = { title: "Org Defaults" };

export default async function OrgDefaultsPage() {
    const units = await prisma.invUnit.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, code: true, label: true, isActive: true },
    });

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-6 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Org Defaults</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Organization-wide defaults pre-filled when creating products, sale invoices, and purchase orders.
                </p>
            </div>
            <OrgDefaultsForm units={units} />
        </div>
        </ScrollArea>
    );
}
