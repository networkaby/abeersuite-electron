import { z } from "zod";
import { PAPER_FORMATS } from "@/shared/lib/print/voucherTemplateDefaults";

const txt = (max: number) => z.string().max(max).optional();

export const voucherTemplateUpdateSchema = z.object({
    headerLine1:    txt(120),
    headerLine2:    txt(120),
    addressBlock:   txt(1000),
    gstinLine:      txt(120),
    phoneLine:      txt(120),
    logoUrl:        txt(500),

    // Every visible element has an A4 flag (base name) + a `…Thermal` flag.
    showLogo:                 z.boolean().optional(),
    showLogoThermal:          z.boolean().optional(),
    showHeaderText:           z.boolean().optional(),
    showHeaderTextThermal:    z.boolean().optional(),
    showAddress:              z.boolean().optional(),
    showAddressThermal:       z.boolean().optional(),
    showBranchAddress:        z.boolean().optional(),
    showBranchAddressThermal: z.boolean().optional(),
    showGstin:                z.boolean().optional(),
    showGstinThermal:         z.boolean().optional(),
    showPhone:                z.boolean().optional(),
    showPhoneThermal:         z.boolean().optional(),
    showTaxSummary:           z.boolean().optional(),
    showTaxSummaryThermal:    z.boolean().optional(),
    showMrp:                  z.boolean().optional(),
    showMrpThermal:           z.boolean().optional(),
    showLineNote:             z.boolean().optional(),
    showLineNoteThermal:      z.boolean().optional(),
    showSignature:            z.boolean().optional(),
    showSignatureThermal:     z.boolean().optional(),
    showQrCode:               z.boolean().optional(),
    showBarcode:              z.boolean().optional(),
    showBarcodeThermal:       z.boolean().optional(),
    showBank:                 z.boolean().optional(),
    showBankThermal:          z.boolean().optional(),
    showPartyBalance:         z.boolean().optional(),
    showPartyBalanceThermal:  z.boolean().optional(),
    showWarranty:             z.boolean().optional(),
    showWarrantyThermal:      z.boolean().optional(),
    warrantySellerText:       txt(500),
    warrantyManufacturerText: txt(500),
    warrantyCombinedText:     txt(500),
    warrantyNoneText:         txt(500),

    // Service Shipping Label meta fields (Sheet · Thermal 80mm · Tl 100×50mm).
    showTicket:               z.boolean().optional(),
    showTicketThermal:        z.boolean().optional(),
    showTicketTl:             z.boolean().optional(),
    showDate:                 z.boolean().optional(),
    showDateThermal:          z.boolean().optional(),
    showDateTl:               z.boolean().optional(),
    showRef:                  z.boolean().optional(),
    showRefThermal:           z.boolean().optional(),
    showRefTl:                z.boolean().optional(),
    showDevice:               z.boolean().optional(),
    showDeviceThermal:        z.boolean().optional(),
    showDeviceTl:             z.boolean().optional(),
    showFooter:               z.boolean().optional(),
    showFooterThermal:        z.boolean().optional(),
    showFooterTl:             z.boolean().optional(),

    // Service Slip sign-off rows (A4 base + thermal).
    showSentBy:               z.boolean().optional(),
    showSentByThermal:        z.boolean().optional(),
    showReceivedBy:           z.boolean().optional(),
    showReceivedByThermal:    z.boolean().optional(),
    showPreparedBy:           z.boolean().optional(),
    showPreparedByThermal:    z.boolean().optional(),
    showFindings:             z.boolean().optional(),
    showFindingsThermal:      z.boolean().optional(),
    // Salary slip attendance section (A4 base + thermal).
    showAttendance:           z.boolean().optional(),
    showAttendanceThermal:    z.boolean().optional(),
    showCommission:           z.boolean().optional(),
    showCommissionThermal:    z.boolean().optional(),

    termsText:      txt(1000),
    footerLine:     txt(200),
    signatureLabel: txt(80),
    disclaimerLine: txt(300),

    defaultPaper:   z.enum(PAPER_FORMATS as unknown as [string, ...string[]]).optional(),
    paperWidthMm:   z.number().int().min(50).max(120).optional(),
    fontFamily:     txt(120),
    fontSizePx:     z.number().int().min(8).max(20).optional(),
});

export type VoucherTemplateUpdateInput = z.infer<typeof voucherTemplateUpdateSchema>;
