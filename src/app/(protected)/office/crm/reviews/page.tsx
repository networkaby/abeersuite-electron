import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess, hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { ReviewsWorkspace } from "@/modules/reviews/components/ReviewsWorkspace";

export const metadata = { title: "Reviews" };

// /office/crm/reviews — public reviews where we cannot tell who the person is
// (Google now). Known people write to Messages instead.
export default async function ReviewsPage() {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }
    const can = (id: string) => hasPermissionWithScope(permissions, id);

    return (
        <ReviewsWorkspace canReply={can(PERMISSIONS.REVIEWS_REPLY)} />
    );
}
