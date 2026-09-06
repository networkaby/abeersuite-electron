import { prisma } from "@/shared/lib/prisma/prismaClient";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import ReceiptButtons from "@/shared/components/ReceiptButtons";
import SetDocumentTitle from "@/shared/components/print/SetDocumentTitle";
import CouponCard from "@/shared/components/print/CouponCard";
import { getVoucherTemplate } from "@/shared/lib/print/voucherTemplate";
import { couponHeadline, couponValueText } from "@/modules/coupons/lib/couponShare";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// Printable coupon card. Opened from the Coupons admin page; ReceiptButtons
// auto-prints on mount (browser dialog — a card, not a counter slip). Brand /
// label / terms / foot come from the COUPON print template.
export default async function CouponPrintPage({ params }: { params: Promise<{ id: string }> }) {
    await requireStaffPage();

    const { id } = await params;

    const coupon = await prisma.coupon.findUnique({ where: { id: Number(id) } });
    if (!coupon || !coupon.code) notFound();

    const [template, qrDataUrl] = await Promise.all([
        getVoucherTemplate("COUPON"),
        QRCode.toDataURL(coupon.code, { width: 240, margin: 1, errorCorrectionLevel: "M" }),
    ]);

    const subLines = [
        `${couponValueText(coupon)}.`,
        ...(coupon.minBillValue != null && Number(coupon.minBillValue) > 0 ? [`Min bill ₹${Number(coupon.minBillValue).toLocaleString("en-IN")}.`] : []),
        ...(coupon.endsAt ? [`Valid until ${coupon.endsAt.toISOString().slice(0, 10)}.`] : []),
    ];

    return (
        <>
            <SetDocumentTitle title={`Coupon ${coupon.code}`} />
            <style>{`
          body { background: #f1f5f9; padding: 24px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
          @media print { body { background: #fff; padding: 0; } .no-print { display: none !important; } }
        `}</style>
            <div className="no-print" style={{ width: "360px" }}><ReceiptButtons /></div>
            <CouponCard
                template={template}
                data={{ headline: couponHeadline(coupon), name: coupon.name, code: coupon.code, qrDataUrl, subLines }}
            />
        </>
    );
}
