import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm — permission gate + a breadcrumb strip rooted at
// the CRM index and Esc → back. Mirrors the Administration work board layout.
export default async function CrmModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.ADMIN_BYPASS) && !permissions.includes(PERMISSIONS.CRM_VIEW)) {
        redirect("/office/core/assignments");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb root={{ href: "/office/crm", label: "CRM" }} escapeBack labels={{ crm: "CRM" }} />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
