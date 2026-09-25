import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";
import { PathBreadcrumb } from "@/shared/components/PathBreadcrumb";

// Area layout for /office/hr — the OUTER door plus the breadcrumb strip.
//
// Two levels, because HR is ticked page by page in the Role matrix and one tick
// must never open the rest: this layout only asks "do you belong in HR at all"
// (any ui:sidebar:hr:* link), and each page's own layout then demands ITS tick.
// What a person may DO once inside is still decided by the page itself.
export default async function HrModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!hasModuleNavAccess(permissions, "hr")) {
        redirect("/office/work-flow-inbox");
    }

    return (
        <div className="flex h-full flex-col">
            <PathBreadcrumb
                root={{ href: "/office/hr", label: "HR & People" }}
                basePath="/office/hr"
                escapeBack
                labels={{ me: "My Portal", staff: "Staff Directory", activity: "Employee Activity", payroll: "Payroll", "pay-rules": "Pay Rules", commission: "Targets & Commission" }}
            />
            <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
    );
}
