import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/reconnect — breadcrumb strip; the page lock
// (pageAccess.ts) decides who may open it. Mirrors the Deals area layout.
export default function ReconnectModuleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/crm/deals", label: "CRM" }}
                basePath="/office/crm"
                escapeBack
                labels={{ reconnect: "Reconnect" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
