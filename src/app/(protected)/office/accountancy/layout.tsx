import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasModuleNavAccess } from "@/shared/lib/auth/permissionScope";

export default async function AccountancyLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const perms = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    // New model: having any Accountancy sidebar nav grant lets the user open the
    // module (they were given the UI). The capability check stays as an alternative
    // for capability-only users. Finer limits live inside each tool, not here.
    if (!hasModuleNavAccess(perms, "accountancy")) {
        redirect("/office");
    }
    return <>{children}</>;
}
