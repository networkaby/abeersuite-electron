import PosQuoteScreen from "@/modules/pos/components/PosQuoteScreen";

// /vouchers/pos/estimate                    → new estimate
// /vouchers/pos/estimate?voucherId=12       → reopen estimate #12 in edit mode
//                                             (via editFormUrl — Day Book / registers)
// /vouchers/pos/estimate?id=12              → same (direct link)
export default async function PosEstimatePage({ searchParams }: { searchParams: Promise<{ id?: string; voucherId?: string }> }) {
    const sp = await searchParams;
    const raw = sp.voucherId ?? sp.id;
    const editId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
    return <PosQuoteScreen mode="estimate" editId={editId} />;
}
