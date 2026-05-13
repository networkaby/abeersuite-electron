import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";

// Standalone full-page Sale Voucher shell — same pattern as /pos. No office
// sidebar / chrome so the form gets the entire canvas (matches the reference
// Indian-SMB Sale screen). Reuses the staff session; customer sessions blocked.
export default async function SaleLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fsale");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fsale");

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
            <Toaster position="top-center" richColors />
            {children}
        </div>
    );
}
