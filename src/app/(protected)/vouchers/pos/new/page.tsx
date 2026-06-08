import PosScreen from "@/modules/pos/components/PosScreen";

// /vouchers/pos/new                  → ring up a new counter sale
// /vouchers/pos/new?voucherId=12     → reopen posted POS sale #12 in edit mode
//                                      (via editFormUrl — Day Book / registers)
export default async function PosRegisterPage({ searchParams }: { searchParams: Promise<{ voucherId?: string; id?: string }> }) {
    const sp = await searchParams;
    const raw = sp.voucherId ?? sp.id;
    const editId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
    return <PosScreen editId={editId} />;
}
