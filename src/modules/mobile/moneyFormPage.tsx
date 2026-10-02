import { notFound } from "next/navigation";
import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "./mobileAccess";
import MobileMoneyForm, { type MoneyKind } from "./MobileMoneyForm";

type PageProps = {
    params: Promise<{ accountId: string }>;
    searchParams: Promise<{ from?: string }>;
};

/** The Pay and Receive pages are the same page in two directions. The Role page's
 *  Payment / Receipt ticks are enforced by the voucher API the form saves through;
 *  the form also reads them to say so up front. */
export function moneyFormPage(kind: MoneyKind) {
    return async function MoneyFormPage({ params, searchParams }: PageProps) {
        const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
        const accountId = Number((await params).accountId);
        if (!Number.isInteger(accountId)) notFound();
        const { from } = await searchParams;
        // From quick entry: back to its picker. Otherwise back to the party, which
        // itself goes back to the list it came from.
        const quick = from && /^\/m\/quick\/(pay|receive)$/.test(from) ? from : null;
        const listFrom = from && /^\/m\/[a-z-]+$/.test(from) ? `?from=${from}` : "";
        const back = quick ?? `/m/parties/${accountId}${listFrom}`;
        return <MobileMoneyForm kind={kind} accountId={accountId} userId={user.id} back={back} />;
    };
}
