import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export function makePermissionLayout(permission: string | string[]) {
    const required = Array.isArray(permission) ? permission : [permission];
    return async function PermissionLayout({ children }: { children: React.ReactNode }) {
        const session = await auth();
        const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
        if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !required.some((p) => permissions.includes(p))) {
            redirect("/office/core/assignments");
        }
        return <>{children}</>;
    };
}
