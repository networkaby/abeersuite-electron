import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";

// Standalone full-page Sale Return shell — same pattern as /sale.
export default async function SaleReturnLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fsale-return");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fsale-return");

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
            <Toaster position="top-center" richColors />
            {children}
        </div>
    );
}
