import { notFound } from "next/navigation";
import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "../lib/mobileAccess";
import MobileMoneyForm, { type MoneyKind } from "./MobileMoneyForm";
import { PHONE_APP_HOME, appBack } from "@/shared/lib/device/phone";

type PageProps = {
    params: Promise<{ accountId: string }>;
    searchParams: Promise<{ from?: string; bills?: string }>;
};

/** The Pay and Receive pages are the same page in two directions. The Role page's
 *  Payment / Receipt ticks are enforced by the voucher API the form saves through;
 *  the form also reads them to say so up front. */
export function moneyFormPage(kind: MoneyKind) {
    return async function MoneyFormPage({ params, searchParams }: PageProps) {
        const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
        const accountId = Number((await params).accountId);
        if (!Number.isInteger(accountId)) notFound();
        const { from, bills } = await searchParams;
        // Bills ticked on the party screen (`?bills=12,34`); junk is dropped.
        const pickedBills = (bills ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
        // From quick entry: back to its picker. Otherwise back to the party, which
        // itself goes back to the list it came from.
        const ok = appBack(from);
        const quick = ok?.startsWith(`${PHONE_APP_HOME}/quick/`) ? ok : null;
        const listFrom = ok && !quick ? `?from=${ok}` : "";
        const back = quick ?? `${PHONE_APP_HOME}/parties/${accountId}${listFrom}`;
        return <MobileMoneyForm kind={kind} accountId={accountId} userId={user.id} back={back} pickedBills={pickedBills} />;
    };
}
