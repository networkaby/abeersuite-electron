import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

// Customer Tools requires BOTH customers:edit AND companies:manage —
// every action on the page (Convert today, Merge next) creates or destroys
// records of one party type while affecting the other.
export default async function CustomerToolsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    const bypass = permissions.includes(PERMISSIONS.ADMIN_BYPASS);
    if (!bypass) {
        const hasBoth =
            permissions.includes(PERMISSIONS.CUSTOMERS_EDIT) &&
            permissions.includes(PERMISSIONS.COMPANIES_MANAGE);
        if (!hasBoth) redirect("/office/work-flow-inbox");
    }
    return <>{children}</>;
}
