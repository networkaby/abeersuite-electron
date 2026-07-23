import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/help — permission gate + breadcrumb strip. Mirrors the
// Deals / Administration work-board layouts.
export default async function HelpModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "help")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb root={{ href: "/office/help", label: "Help Desk" }} escapeBack labels={{ help: "Help Desk" }} />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
