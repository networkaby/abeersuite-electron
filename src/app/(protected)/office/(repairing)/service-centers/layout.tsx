import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function ServiceCentersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes("warranty:convert") && !permissions.includes("admin:bypass")) {
        redirect("/office/assignments");
    }
    return <>{children}</>;
}
