import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PERMISSIONS } from "@/shared/lib/constants/permissions";

export default async function ServiceCentersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];
    if (!permissions.includes(PERMISSIONS.WARRANTY_CONVERT) && !permissions.includes(PERMISSIONS.ADMIN_BYPASS)) {
        redirect("/office/assignments");
    }
    return <>{children}</>;
}
