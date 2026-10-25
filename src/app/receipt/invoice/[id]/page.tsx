import { requireStaffPage } from "@/shared/lib/auth/permissions";
import { loadCurrencySymbol } from "@/shared/lib/format/currencySymbol.server";
import InvoiceReceipt from "@/shared/components/print/InvoiceReceipt";

// Resolves the id as an InvVoucher (the new shape, used by POS sales since
// the Invoice→InvVoucher consolidation on 2026-05-24). The URL path keeps
// `/receipt/invoice/...` for back-compat with bookmarked links and the
// thermal-print fallback in PosScreen.
//
// Staff-only print surface — full paper/kind/autoprint controls, any
// voucher id. Customers get their own bill at `/portal/orders/[id]/bill`,
// which is ownership-checked and renders the same body via InvoiceReceipt.
export default async function PosReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<{ kind?: string; paper?: string; placeOfSupply?: string; autoprint?: string; mode?: string }>;
}) {
    await requireStaffPage();
    await loadCurrencySymbol();

    const { id } = await params;
    const sp = (await searchParams) ?? {};

    return (
        <InvoiceReceipt
            id={id}
            kindParam={sp.kind ?? "SALE"}
            placeOfSupplyParam={(sp.placeOfSupply ?? "").trim()}
            paper={sp.paper}
            mode={sp.mode}
            autoprint={sp.autoprint}
        />
    );
}
