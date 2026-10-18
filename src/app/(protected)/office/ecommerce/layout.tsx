import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Full-height area shell: breadcrumb (+ Esc → back) and the tab bar stay pinned
// while the page content scrolls inside `flex-1`. `<main>` upstream is
// overflow-hidden + bounded, so `h-full` here gives a real height to fill —
// list pages (Products) can then own their internal scroll and keep their
// pagination in view. Full width (no `container`) so wide tables use the space.
export default function EcommerceModuleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/ecommerce", label: "E-Commerce" }}
                escapeBack
                labels={{ ecommerce: "E-Commerce" }}
            />
            <div className="min-h-0 flex-1 overflow-auto px-4 py-4">{children}</div>
        </div>
    );
}
