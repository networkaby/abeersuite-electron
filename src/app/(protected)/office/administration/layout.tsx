import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/administration — a breadcrumb strip rooted at the module
// index and Esc → back; the page lock (pageAccess.ts) decides who may open it. The board's dialogs handle Esc themselves (Radix), and
// `useEscapeBack` skips while a dialog is open, so there's no double-binding.
export default function AdministrationLayout({ children }: { children: React.ReactNode }) {
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
