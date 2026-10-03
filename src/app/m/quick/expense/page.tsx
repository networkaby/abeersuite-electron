import { PARTY_DETAIL_PERMISSIONS, mobileUser } from "@/modules/mobile/mobileAccess";
import MobileQuickPick from "@/modules/mobile/MobileQuickPick";

export default async function QuickExpensePage() {
    const user = await mobileUser(PARTY_DETAIL_PERMISSIONS);
    return <MobileQuickPick kind="expense" userId={user.id} />;
}
