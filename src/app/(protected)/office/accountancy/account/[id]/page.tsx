// Legacy single-page ledger view — superseded by the master-detail
// /office/accountancy/account-ledgers explorer on 2026-05-22. This route
// remains as a permanent redirect so old bookmarks, emails, and external
// links keep working. Preserves from / to / asOf query params.

import { redirect } from "next/navigation";
import { accountLedgerUrl } from "@/modules/accountancy/lib/accountLedgerUrl";

export default async function LegacyAccountRedirect({
    params,
    searchParams,
}: {
    params:        Promise<{ id: string }>;
    searchParams:  Promise<Record<string, string | string[] | undefined>>;
}) {
    const { id }   = await params;
    const sp       = await searchParams;
    const accountId = Number(id);

    if (!Number.isFinite(accountId)) redirect("/office/accountancy/account-ledgers");

    const pick = (k: string) => {
        const v = sp[k];
        return typeof v === "string" ? v : undefined;
    };

    redirect(accountLedgerUrl(accountId, {
        from: pick("from"),
        to:   pick("to"),
        asOf: pick("asOf"),
    }));
}
