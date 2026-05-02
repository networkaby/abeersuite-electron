import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AdminTabsNav from "@/modules/ecommerce/components/AdminTabsNav";

export default async function EcommerceModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes("admin:bypass") && !permissions.includes("ecommerce:manage")) {
        redirect("/assignments");
    }

    return (
        <div className="container max-w-7xl py-6 space-y-6">
            <AdminTabsNav />
            {children}
        </div>
    );
}
