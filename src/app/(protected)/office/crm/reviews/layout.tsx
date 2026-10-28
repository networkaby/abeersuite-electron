import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/crm/reviews — breadcrumb strip; the page lock
// (pageAccess.ts) decides who may open it. Mirrors the Messages area layout.
export default function ReviewsModuleLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/crm/deals", label: "CRM" }}
                basePath="/office/crm"
                escapeBack
                labels={{ reviews: "Reviews" }}
            />
            <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </div>
    );
}
