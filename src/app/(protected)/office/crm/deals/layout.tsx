import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/deals — permission gate + a breadcrumb strip rooted at
// the Deals index and Esc → back. Mirrors the Administration work board layout.
export default async function DealsModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "crm")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb root={{ href: "/office/crm/deals", label: "Deals" }} escapeBack labels={{ deals: "Deals" }} />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
