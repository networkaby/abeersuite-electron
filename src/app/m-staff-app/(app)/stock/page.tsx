import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobileStock from "@/modules/mobile/components/MobileStock";

export default async function MobileStockPage() {
    await mobileUser(PERMISSIONS.MOBILE_STOCK_VIEW);
    return <MobileStock />;
}
