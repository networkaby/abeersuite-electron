import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function ServiceCentersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role;
    if (role !== "R1" && role !== "R2") redirect("/dashboard");
    return <>{children}</>;
}
