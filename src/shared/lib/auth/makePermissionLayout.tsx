import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { NO_ACCESS_HOME, NO_ACCESS_PARAM } from "@/shared/lib/auth/pageAccess";

export function makePermissionLayout(permission: string | string[]) {
    const required = Array.isArray(permission) ? permission : [permission];
    return async function PermissionLayout({ children }: { children: React.ReactNode }) {
        const session = await auth();
        const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
        if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !required.some((p) => permissions.includes(p))) {
            redirect(`${NO_ACCESS_HOME}?${NO_ACCESS_PARAM}=1`);
        }
        return <>{children}</>;
    };
}
