import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";

// Standalone full-page Purchase Return shell — same pattern as /sale.
export default async function PurchaseReturnLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fpurchase-return");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fpurchase-return");

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
            <Toaster position="top-center" richColors />
            {children}
        </div>
    );
}
