import { notFound } from "next/navigation";
import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileMoneyForm from "@/modules/mobile/components/MobileMoneyForm";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";

/** Quick Pay straight to an expense ledger (rent, electricity, tea…). The form
 *  checks the ledger is under Direct / Indirect Expenses; the voucher API checks
 *  the Payment ticks. */
export default async function QuickExpensePayPage({ params, searchParams }: {
    params: Promise<{ accountId: string }>;
    searchParams: Promise<{ from?: string }>;
}) {
    const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) notFound();
    // Back to whichever picker it came from — the Expense list or Make payment.
    const { from } = await searchParams;
    const back = from === `${PHONE_APP_HOME}/quick/expense` ? from : `${PHONE_APP_HOME}/quick/pay`;
    return <MobileMoneyForm kind="PAYMENT" accountId={accountId} userId={user.id} back={back} expense />;
}
