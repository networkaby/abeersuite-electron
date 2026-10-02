import { notFound } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/mobileAccess";
import MobilePartyBills from "@/modules/mobile/MobilePartyBills";

export default async function MobilePartyPage({ params, searchParams }: {
    params: Promise<{ accountId: string }>;
    searchParams: Promise<{ name?: string }>;
}) {
    const user = await mobileUser(PERMISSIONS.MOBILE_PARTIES_VIEW);
    const accountId = Number((await params).accountId);
    if (!Number.isInteger(accountId)) notFound();
    const { name } = await searchParams;
    return <MobilePartyBills accountId={accountId} userId={user.id} name={name ?? null} />;
}
