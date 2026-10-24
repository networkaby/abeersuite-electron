import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import GiftCardCard from "@/shared/components/print/GiftCardCard";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { requireStaffPage } from "@/shared/lib/auth/permissions";
import { formatAmount } from "@/shared/lib/format/moneyInr";

// Printable gift card. Opened in a new tab from the Gift Cards admin page;
// ReceiptButtons auto-prints on mount (browser dialog — a card, not a counter
// slip). Brand / label / terms / foot come from the GIFT_CARD print template.
export default async function GiftCardPrintPage({ params }: { params: Promise<{ id: string }> }) {
    await requireStaffPage();

    const { id } = await params;

    const card = await prisma.giftCard.findUnique({
        where: { id: Number(id) },
        include: { ownerAccount: { select: { name: true } } },
    });
    if (!card) notFound();

    const [template, qrDataUrl] = await Promise.all([
        getVoucherTemplate("GIFT_CARD"),
        QRCode.toDataURL(card.code, { width: 240, margin: 1, errorCorrectionLevel: "M" }),
    ]);
    const subLines = [
        ...(card.ownerAccount ? [`For ${card.ownerAccount.name}.`] : []),
        ...(card.expiresAt ? [`Valid until ${card.expiresAt.toISOString().slice(0, 10)}.`] : []),
    ];

    return (
        <>
            <SetDocumentTitle title={`Gift Card ${card.code}`} />
            <style>{`
          body { background: #f1f5f9; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
          @media print { body { background: #fff; padding: 0; } .no-print { display: none !important; } }
        `}</style>
            <div className="no-print" style={{ width: "360px" }}><ReceiptButtons /></div>
            <GiftCardCard
                template={template}
                data={{ valueText: `₹${formatAmount(Number(card.balance))}`, code: card.code, qrDataUrl, subLines }}
            />
        </>
    );
}
