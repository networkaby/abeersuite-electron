import { ScrollArea } from "@/components/ui/scroll-area";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import {
    VOUCHER_TEMPLATE_KINDS,
    buildVoucherTemplateDefaults,
    rowToVoucherTemplateDefaults,
    type VoucherTemplateDefaults,
} from "@/shared/lib/print/voucherTemplateDefaults";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { VoucherTemplatesPreviewGallery } from "@/modules/settings/components/VoucherTemplatesPreviewGallery";

export const metadata = { title: "Print Template Preview" };

export default async function VoucherTemplatesPreviewPage() {
    const [rows, organisation] = await Promise.all([
        prisma.voucherPrintTemplate.findMany(),
        getOrganisation(),
    ]);
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    const templates: VoucherTemplateDefaults[] = VOUCHER_TEMPLATE_KINDS.map((kind) => {
        const r = byKind.get(kind);
        return r ? rowToVoucherTemplateDefaults(r) : buildVoucherTemplateDefaults(kind);
    });

    return (
        <ScrollArea className="h-full" type="always">
        <div className="space-y-4 px-6 pt-3 pb-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-xl font-semibold">Print Template Preview</h1>
                    <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
                        Side-by-side A4 and 80mm thermal preview for the selected voucher kind. Use this on a
                        client demo to show exactly what each print will look like before going live. Edit the
                        template at <span className="font-mono text-xs">/office/settings/voucher-templates</span>.
                    </p>
                </div>
            </div>
            <VoucherTemplatesPreviewGallery templates={templates} organisation={organisation} />
        </div>
        </ScrollArea>
    );
}
