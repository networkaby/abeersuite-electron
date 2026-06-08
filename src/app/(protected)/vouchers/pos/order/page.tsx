import PosQuoteScreen from "@/modules/pos/components/PosQuoteScreen";

// /vouchers/pos/order                  → new order
// /vouchers/pos/order?id=123           → reopen order #123 in edit mode (board link)
// /vouchers/pos/order?voucherId=123    → same, via the app-wide voucher-edit convention
//                                        (Day Book / voucher registers → editFormUrl)
// Edit mode loads New / Under-Review orders; others bounce back with a toast.
export default async function PosOrderPage({ searchParams }: { searchParams: Promise<{ id?: string; voucherId?: string }> }) {
    const sp = await searchParams;
    const raw = sp.voucherId ?? sp.id;
    const editId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
    return <PosQuoteScreen mode="order" editId={editId} />;
}
