import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Slug → human label for breadcrumb segments. Keeps multi-word and acronym
// slugs (workers, qr-display-settings, …) from being naively title-cased.
// Mirrors the labels in SETTINGS_NAV (utils/constants.ts).
const SETTINGS_CRUMB_LABELS: Record<string, string> = {
    "org-defaults": "Org Defaults",
    ecommerce: "E-Commerce",
    statuses: "Statuses",
    "workers": "Workers",
    works: "Works",
    pipelines: "Pipelines",
    workflow: "Workflow",
    "naming-convention": "Naming Convention",
    "year-ending": "Year Ending",
    "printer-settings": "Thermal Printer",
    "qr-display-settings": "QR Display",
    "pos-services": "POS Services",
    "voucher-templates": "Print Templates",
    preview: "Preview",
    "backup-restore": "Backup & Restore",
    "item-import": "Item Import",
    "customer-import": "Customer Import",
    "customer-tools": "Customer Tools",
    "offline-policies": "Offline Policies",
};

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/settings", label: "Settings" }}
                escapeBack
                labels={SETTINGS_CRUMB_LABELS}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
                {children}
            </div>
        </div>
    );
}
