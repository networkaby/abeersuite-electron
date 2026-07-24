import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/reconnect — CRM page gate + breadcrumb strip.
// Mirrors the Deals area layout.
export default async function ReconnectModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb root={{ href: "/office/crm/reconnect", label: "Reconnect" }} escapeBack labels={{ reconnect: "Reconnect" }} />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
