import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function DepartmentsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes("settings:manage") && !permissions.includes("admin:bypass")) {
        redirect("/assignments");
    }
    return <>{children}</>;
}
