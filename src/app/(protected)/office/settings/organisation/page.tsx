import { ScrollArea } from "@/components/ui/scroll-area";
import { getOrganisationRaw } from "@/shared/lib/org/getOrganisation";
import { OrganisationForm } from "@/modules/settings/components/OrganisationForm";

export const metadata = { title: "Organisation" };

export default async function OrganisationPage() {
    const initial = await getOrganisationRaw();
    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-4 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Organisation</h1>
                <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                    Your own business identity — appears on every invoice, voucher, and receipt. Leave a field
                    blank to fall back to the value in <span className="font-mono text-xs">
                    constants-company-details.ts</span>. Voucher Templates (per kind) can override these on a
                    case-by-case basis.
                </p>
            </div>
            <OrganisationForm initial={initial} />
        </div>
        </ScrollArea>
    );
}
