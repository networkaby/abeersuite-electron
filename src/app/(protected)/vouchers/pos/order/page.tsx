import PosQuoteScreen from "@/modules/pos/components/PosQuoteScreen";

// /vouchers/pos/order            → new order
// /vouchers/pos/order?id=123     → reopen order #123 in edit mode (New / Under-Review only)
export default async function PosOrderPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
    const sp = await searchParams;
    const editId = sp.id && /^\d+$/.test(sp.id) ? Number(sp.id) : undefined;
    return <PosQuoteScreen mode="order" editId={editId} />;
}
