import { redirect, notFound } from "next/navigation";
import { prisma } from "@/shared/lib/prisma/prismaClient";
import { voucherSourceForType, referenceHref } from "@/modules/accountancy/lib/voucherUrls";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const voucherId = Number(id);
    if (!voucherId || isNaN(voucherId)) {
        notFound();
    }

    const voucher = await prisma.universalVoucher.findUnique({
        where: { id: voucherId },
        // An inventory kind (SALE / PURCHASE / …) is edited by its VoucherDetail
        // id — a different id space from the spine — so carry that id along.
        select: { type: true, voucherDetail: { select: { id: true } } },
    });

    if (voucher) {
        const source = voucherSourceForType(voucher.type);
        const rawId = source === "inv" ? voucher.voucherDetail?.id ?? null : voucherId;
        const url = rawId != null ? referenceHref(source, rawId, voucher.type) : null;
        if (url) {
            redirect(url);
        }
    }

    // Fallback if not identified as universal voucher: try contra
    redirect(`/vouchers/contras/${voucherId}`);
}
