import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";

// Standalone full-page GL-voucher shell (Payment, Receipt, Contra,
// Credit Note, Debit Note, Journal, Estimate). No office sidebar —
// the form gets the full canvas. Opens in a new tab via button bar.
export default async function GlVoucherLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login");
    if (user.kind === "customer") redirect("/staff/login");

    return (
        <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
            <Toaster position="top-center" richColors />
            {children}
        </div>
    );
}
