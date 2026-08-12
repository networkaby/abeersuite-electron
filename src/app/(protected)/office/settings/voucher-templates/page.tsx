import Link from "next/link";
import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
    rowToVoucherTemplateDefaults,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { VoucherTemplatesPanel } from "@/modules/settings/components/VoucherTemplatesPanel";

export const metadata = { title: "Print Templates" };

export default async function VoucherTemplatesPage() {
    const [rows, organisation] = await Promise.all([
        prisma.voucherPrintTemplate.findMany(),
        getOrganisation(),
    ]);
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    // Hand a fully-populated array to the client so it doesn't have to wait
    // on a second fetch (and rows missing from the seed get default-shaped
    // entries to render).
    const templates: VoucherTemplateDefaults[] = VOUCHER_TEMPLATE_KINDS.map((kind) => {
        const r = byKind.get(kind);
        return r ? rowToVoucherTemplateDefaults(r) : buildVoucherTemplateDefaults(kind);
    });

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-4 px-6 pt-3 pb-6">
            <div>
                <h1 className="text-xl font-semibold">Print Templates</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Customise the print template per voucher kind — header, GSTIN, terms, signature, footer.
                    Each kind has a <b>default paper format</b> (A4 or 80mm thermal); use the &ldquo;Preview as&rdquo; toggle
                    on the right to inspect the other format without changing the default. Open{" "}
                    <Link className="underline hover:text-foreground" href="/office/settings/voucher-templates/preview">
                        Print Preview
                    </Link>{" "}for a side-by-side demo gallery.
                </p>
            </div>
            <VoucherTemplatesPanel initialTemplates={templates} organisation={organisation} />
        </div>
        </ScrollArea>
    );
}
