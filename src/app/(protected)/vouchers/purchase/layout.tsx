import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";

// Standalone full-page Purchase Invoice shell — same pattern as /sale.
export default async function PurchaseLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpurchase");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpurchase");

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
            <Toaster position="top-center" richColors />
            {children}
        </div>
    );
}
