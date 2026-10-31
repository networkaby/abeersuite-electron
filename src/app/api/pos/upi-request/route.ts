import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/shared/lib/auth/permissions";
import { validateRequest } from "@/shared/lib/api";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { getOrganisation } from "@/shared/lib/org/getOrganisation";
import { sendPushAndWhatsApp } from "@/shared/lib/whatsapp/notifyBill";
import { WA_APP_LINK, WA_BILL_LINK_BASE } from "@/shared/lib/whatsapp/billTemplates";
import { encodeUpiPayCode } from "@/modules/pos/lib/upiPayLink";
import { formatAmount, withCurrency } from "@/shared/lib/format/moneyInr";
import { loadCurrencySymbol } from "@/shared/lib/format/currencySymbol.server";

const schema = z.object({
    phone: z.string().min(10).max(20),
    vpa: z.string().trim().min(3).max(100).regex(/^[\w.\-]+@[\w.\-]+$/),
    amount: z.number().positive().max(10_000_000),
    note: z.string().max(60).default(""),
    partyName: z.string().max(120).nullish(),
});

// POST /api/pos/upi-request — the POS Share UPI QR dialog's WhatsApp button.
// Sends the approved PAY_REQUEST template from the shop's number; its Pay now
// button opens /portal/b/p<signed> → the customer's UPI app. The answer's
// `status` is "sent", or why not (no-mobile / disabled / not-configured /
// failed) — the dialog then falls back to WhatsApp Web + paste.
export async function POST(req: Request) {
    const { data, error } = await validateRequest(req, schema);
    if (error) return error;
    const { response } = await requirePermission(PERMISSIONS.POS_UPI_REQUEST_SEND);
    if (response) return response;

    await loadCurrencySymbol();
    const linkCode = encodeUpiPayCode({ vpa: data.vpa, amount: data.amount, note: data.note });
    const amountText = formatAmount(data.amount);
    const { wa } = await sendPushAndWhatsApp({
        kind: "PAY_REQUEST",
        refId: 0,
        linkCode,
        personId: null,
        phones: [{ phone: data.phone, isPrimary: true, verifiedAt: null }],
        values: {
            customer: data.partyName?.trim() || "Customer",
            billNo: data.note,
            amount: amountText,
            date: "",
            prevBalance: "",
            balance: "",
            device: "",
            subject: "",
            shop: getOrganisation().brandName,
            link: `${WA_BILL_LINK_BASE}${linkCode}`,
            app: WA_APP_LINK,
        },
        push: { title: "", body: "" },
        headerImage: `${WA_BILL_LINK_BASE}${linkCode}/qr`,
        summary: `UPI payment request · ${withCurrency(amountText)}`,
    });
    if (wa.status === "failed") console.error("[upi-request] WhatsApp send failed", wa.error);
    return NextResponse.json({ status: wa.status, error: wa.error ?? null });
}
