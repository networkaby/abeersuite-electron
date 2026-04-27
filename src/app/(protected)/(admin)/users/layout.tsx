import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function UsersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes("users:manage") && !permissions.includes("admin:bypass")) {
        redirect("/assignments");
    }
    return <>{children}</>;
}
