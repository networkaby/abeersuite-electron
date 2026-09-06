import { notFound } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { isPaperFormat } from "@/shared/lib/print/voucherTemplateDefaults";
import { buildPaymentSlipPrint } from "@/modules/accountancy/lib/paymentSlip";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// Payment slip for a GL cash voucher — a RECEIPT (money collected from a party
// at the counter, the POS "Rcv" flow) or a PAYMENT (cash paid out, the "Exp"
// flow). It is the counter cash slip, so it prints thermal-first: the combined
// bridge (/print/payment) fires on mount with a browser fallback that offers
// the A4 / thermal picker — each format rendering its own template.
//
// All slip data comes from buildPaymentSlipPrint(), the same builder the POS
// sale response uses for its silent print, so both print ways show one slip.
export default async function PaymentReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string }>;
}) {
    await requireStaffPage();

    const { id } = await params;
    const sp = (await searchParams) ?? {};

    const slip = await buildPaymentSlipPrint(Number(id));
    if (!slip) notFound();

    // Counter slip → thermal-first; `?paper=` override + the picker can switch.
    const format = sp.paper && isPaperFormat(sp.paper) ? sp.paper : "THERMAL_80MM";
    const isThermal = format === "THERMAL_80MM";
    const autoPrint = sp.autoprint !== "0";

    return (
        <ReceiptPreview
            format={format}
            template={slip.template}
            sample={slip.sample}
            toolbar={
                <PrintToolbar
                    bridge={isThermal && autoPrint
                        ? { endpoint: "/print/payment", payload: slip.relayPayload }
                        : undefined}
                    autoPrint={autoPrint}
                    showFormatPicker
                    currentPaper={format}
                />
            }
            docTitle={`${slip.kind === "RECEIPT" ? "Receipt" : "Payment"} ${slip.reference}`}
        />
    );
}
