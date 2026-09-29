import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/call-log — breadcrumb strip; the page lock
// (pageAccess.ts) decides who may open it. Mirrors the Reconnect / Deals area layouts.
export default function CallLogModuleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/crm/deals", label: "CRM" }}
                basePath="/office/crm"
                escapeBack
                labels={{ "call-log": "Call Log" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
