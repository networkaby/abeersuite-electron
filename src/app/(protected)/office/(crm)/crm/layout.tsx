import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function CrmModuleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes("admin:bypass") && !permissions.includes("crm:view")) {
        redirect("/office/assignments");
    }

    return <div className="container max-w-5xl py-6 space-y-6">{children}</div>;
}
