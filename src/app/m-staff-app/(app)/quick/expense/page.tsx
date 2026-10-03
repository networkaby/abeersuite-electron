import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileQuickPick from "@/modules/mobile/components/MobileQuickPick";

export default async function QuickExpensePage() {
    const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
    return <MobileQuickPick kind="expense" userId={user.id} />;
}
