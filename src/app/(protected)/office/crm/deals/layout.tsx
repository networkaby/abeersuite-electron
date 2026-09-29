import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/deals — a breadcrumb strip rooted at the Deals index and
// Esc → back. Who may open it is the page lock's call (pageAccess.ts, run in proxy.ts).
export default function DealsModuleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/crm/deals", label: "CRM" }}
                basePath="/office/crm"
                escapeBack
                labels={{ deals: "Deals" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
