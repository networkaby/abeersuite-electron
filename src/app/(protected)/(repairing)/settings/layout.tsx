import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    
    const canManageStatuses = permissions.includes("settings:statuses");
    const canManageSettings = permissions.includes("settings:manage");
    const canManagePipelines = permissions.includes("settings:pipelines");
    const isAdmin = permissions.includes("admin:bypass");

    if (!canManageStatuses && !canManageSettings && !canManagePipelines && !isAdmin) {
        redirect("/assignments");
    }
    return <>{children}</>;
}
