import { redirect } from "next/navigation";
import { requireStaffPage } from "@/shared/lib/auth/permissions";

// Old address of the Receipt / Payment print. The slip is now the generic
// voucher print (buildMoneySample in voucherReceiptSample.ts) like every other
// kind, so this only forwards — links already handed out, bookmarks and a
// counter still on an older build keep working, query string and all.
export default async function PaymentReceiptPage({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    await requireStaffPage();

    const { id } = await params;
    const qs = new URLSearchParams(
        Object.entries((await searchParams) ?? {}).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    redirect(`/receipt/voucher/gl/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`);
}
