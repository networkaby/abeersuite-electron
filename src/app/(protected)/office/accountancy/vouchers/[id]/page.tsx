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
        select: { type: true },
    });

    if (voucher) {
        const source = voucherSourceForType(voucher.type);
        const url = referenceHref(source, voucherId, voucher.type);
        if (url) {
            redirect(url);
        }
    }

    // Fallback if not identified as universal voucher: try contra
    redirect(`/vouchers/contras/${voucherId}`);
}
