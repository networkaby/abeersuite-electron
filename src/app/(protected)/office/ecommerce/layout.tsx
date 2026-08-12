import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Full-height area shell: breadcrumb (+ Esc → back) and the tab bar stay pinned
// while the page content scrolls inside `flex-1`. `<main>` upstream is
// overflow-hidden + bounded, so `h-full` here gives a real height to fill —
// list pages (Products) can then own their internal scroll and keep their
// pagination in view. Full width (no `container`) so wide tables use the space.
export default async function EcommerceModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "e-commerce")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/ecommerce", label: "E-Commerce" }}
                escapeBack
                labels={{ ecommerce: "E-Commerce" }}
            />
            {/* <div className="px-4 pt-3">
                <AdminTabsNav permissions={permissions} />
            </div> */}
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
        </div>
    );
}
