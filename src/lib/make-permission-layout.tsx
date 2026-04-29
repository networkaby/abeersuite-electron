import { auth } from "@/auth";
import { redirect } from "next/navigation";

export function makePermissionLayout(permission: string) {
    return async function PermissionLayout({ children }: { children: React.ReactNode }) {
        const session = await auth();
        const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
        if (!permissions.includes("admin:bypass") && !permissions.includes(permission)) {
            redirect("/assignments");
        }
        return <>{children}</>;
    };
}
