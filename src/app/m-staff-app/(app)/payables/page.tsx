import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import { seesSuppliers } from "@/modules/mobile/lib/mobileScreens";
import { PHONE_APP_HOME } from "@/shared/lib/device/phone";
import MobileOutstanding from "@/modules/mobile/components/MobileOutstanding";

export default async function MobilePayablesPage() {
    const user = await mobileUser(PERMISSIONS.MOBILE_PAYABLES_VIEW);
    // Every row is a supplier — needs "Show suppliers" too, as the tile does.
    if (!seesSuppliers(user.permissions)) redirect(PHONE_APP_HOME);
    return <MobileOutstanding side="payables" userId={user.id} />;
}
