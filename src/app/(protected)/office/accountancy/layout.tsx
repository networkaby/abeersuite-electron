import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasPermissionWithScope } from "@/shared/lib/auth/permissionScope";

export default async function AccountancyLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasPermissionWithScope(perms, "accountancy:view:org")) {
        redirect("/office");
    }
    return <>{children}</>;
}
