import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AdminTabsNav from "@/modules/ecommerce/components/AdminTabsNav";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function EcommerceModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.ECOMMERCE_MANAGE)) {
        redirect("/office/core/assignments");
    }

    return (
        <div className="container max-w-7xl py-6 space-y-6">
            <AdminTabsNav />
            {children}
        </div>
    );
}
