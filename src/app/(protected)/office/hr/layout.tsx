import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/hr — HR & People page gate + breadcrumb strip.
// Mirrors the CRM area layouts: the sidebar link (ui:sidebar:hr:*) is the view
// gate; what a person may DO on a page is decided by the page itself.
export default async function HrModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/hr/staff", label: "HR & People" }}
                basePath="/office/hr"
                escapeBack
                labels={{ staff: "Staff Directory", payroll: "Payroll" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
