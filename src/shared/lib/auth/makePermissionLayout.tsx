import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export function makePermissionLayout(permission: string) {
    return async function PermissionLayout({ children }: { children: React.ReactNode }) {
        const session = await auth();
        const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
        if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(permission)) {
            redirect("/office/core/assignments");
        }
        return <>{children}</>;
    };
}
