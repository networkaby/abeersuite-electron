import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { mobileUser } from "@/modules/mobile/lib/mobileAccess";
import MobilePosts from "@/modules/mobile/components/MobilePosts";

export default async function MobilePostsPage() {
    await mobileUser(PERMISSIONS.MOBILE_POSTS_SHARE);
    return <MobilePosts />;
}
