import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/administration — permission gate (same as
// makePermissionLayout) plus a breadcrumb strip rooted at the module index and
// Esc → back. The board's dialogs handle Esc themselves (Radix), and
// `useEscapeBack` skips while a dialog is open, so there's no double-binding.
export default async function AdministrationLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "administration")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/administration", label: "Administration" }}
                escapeBack
                labels={{ "administration": "Administration" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
