import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Standalone full-page GL-voucher shell (Payment, Receipt, Contra,
// Credit Note, Debit Note, Journal, Estimate). No office sidebar —
// the form gets the full canvas. Opens in a new tab via button bar.
//
// `SessionWrapper` is required because the edit-mode forms (e.g.
// GlVoucherPage at /vouchers/payments/[id]) read permissions via
// `useSession()` to decide which LifecycleActions buttons to render.
export default async function GlVoucherLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login");
    if (user.kind === "customer") redirect("/staff/login");

    return (
        <SessionWrapper session={session}>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
                <Toaster position="top-center" richColors />
                {children}
            </div>
        </SessionWrapper>
    );
}
