import { z } from "zod";
import { VOUCHER_TEMPLATE_KINDS, PAPER_FORMATS } from "@/shared/lib/print/voucherTemplateDefaults";

export const voucherTemplateKindSchema = z.enum(
    VOUCHER_TEMPLATE_KINDS as unknown as [string, ...string[]],
);

const txt = (max: number) => z.string().max(max).optional();

export const voucherTemplateUpdateSchema = z.object({
    headerLine1:    txt(120),
    headerLine2:    txt(120),
    addressBlock:   txt(1000),
    gstinLine:      txt(120),
    phoneLine:      txt(120),
    logoUrl:        txt(500),

    showLogo:       z.boolean().optional(),
    showAddress:    z.boolean().optional(),
    showGstin:      z.boolean().optional(),
    showPhone:      z.boolean().optional(),
    showTaxSummary: z.boolean().optional(),
    showMrp:        z.boolean().optional(),
    showSignature:  z.boolean().optional(),
    showQrCode:     z.boolean().optional(),

    termsText:      txt(1000),
    footerLine:     txt(200),
    signatureLabel: txt(80),

    defaultPaper:   z.enum(PAPER_FORMATS as unknown as [string, ...string[]]).optional(),
    paperWidthMm:   z.number().int().min(50).max(120).optional(),
    fontFamily:     txt(120),
    fontSizePx:     z.number().int().min(8).max(20).optional(),
});

export type VoucherTemplateUpdateInput = z.infer<typeof voucherTemplateUpdateSchema>;
