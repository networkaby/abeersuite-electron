import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    
    const canManageStatuses = permissions.includes("settings:statuses");
    const canManageRoles = permissions.includes("roles:manage");
    const canManageUsers = permissions.includes("users:manage");
    const isAdmin = permissions.includes("admin:bypass");

    if (!canManageStatuses && !canManageRoles && !canManageUsers && !isAdmin) {
        redirect("/assignments");
    }
    return <>{children}</>;
}
