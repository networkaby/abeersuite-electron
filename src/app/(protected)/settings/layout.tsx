import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if ((session?.user as { role?: string } | undefined)?.role !== "R1") redirect("/dashboard");
    return <>{children}</>;
}
