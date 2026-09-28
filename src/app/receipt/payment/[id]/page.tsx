import { redirect } from "next/navigation";
import PrintToolbar from "@/shared/components/print/PrintToolbar";
import ReceiptPreview from "@/shared/components/print/ReceiptPreview";
import { resolvePaperFormat } from "@/shared/lib/print/voucherTemplate";
import { buildPaymentSlipPrint } from "@/modules/accountancy/lib/paymentSlip";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// Payment slip for a GL cash voucher — a RECEIPT (money collected from a party
// at the counter, the POS "Rcv" flow) or a PAYMENT (cash paid out, the "Exp"
// flow). Two ways in: `?mode=thermal` fires the bridge once (no printer /
// bridge down → this page stays open as the format-selection page); any other
// way is the selection page — A4 / thermal picker, browser print dialog.
//
// All slip data comes from buildPaymentSlipPrint(), the same builder the POS
// sale response uses for its silent print, so both print ways show one slip.
export default async function PaymentReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ paper?: string; autoprint?: string; mode?: string }>;
}) {
    await requireStaffPage();

    const { id } = await params;
    const sp = (await searchParams) ?? {};

    const slip = await buildPaymentSlipPrint(Number(id));
    // null = no such voucher, or a cash Payment into a party's bank — that one
    // prints as the Bank Deposit Slip on the generic voucher page (which also
    // answers 404 for a voucher that doesn't exist).
    if (!slip) {
        const qs = new URLSearchParams(
            Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
        ).toString();
        redirect(`/receipt/voucher/gl/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
    }

    // `?paper=` wins, then `?mode=thermal` (the thermal way in) → 80mm, else A4.
    const format = resolvePaperFormat(slip.template, sp.paper, sp.mode);
    const isThermal = format === "THERMAL_80MM" && sp.mode === "thermal";
    const autoPrint = sp.autoprint !== "0";

    return (
        <ReceiptPreview
            format={format}
            template={slip.template}
            sample={slip.sample}
            toolbar={
                <PrintToolbar
                    bridge={isThermal && autoPrint
                        ? { endpoint: "/print/voucher", payload: slip.relayPayload }
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
