import { notFound } from "next/navigation";
import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobilePartyBills from "@/modules/mobile/components/MobilePartyBills";
import { PHONE_APP_HOME, appBack } from "@/shared/lib/device/phone";

export default async function MobilePartyPage({ params, searchParams }: {
    params: Promise<{ accountId: string }>;
    searchParams: Promise<{ name?: string; from?: string }>;
}) {
    const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) notFound();
    const { name, from } = await searchParams;
    // Back to the list it was opened from — only ever a phone screen.
    const back = appBack(from) ?? `${PHONE_APP_HOME}/parties`;
    return <MobilePartyBills accountId={accountId} userId={user.id} name={name ?? null} back={back} />;
}
