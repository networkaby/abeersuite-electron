import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Standalone POS Order shell — NO office sidebar / chrome / nav.
// Mirrors the POS register shell (full-screen fixed layout). Order mode is a
// SEPARATE page so the protected POS Sale voucher is never touched.

export default async function PosOrderLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Forder");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Forder");

    return (
        <SessionWrapper>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-indigo-50 text-foreground dark:bg-indigo-950/20">
                <Toaster position="top-center" richColors />
                {children}
            </div>
        </SessionWrapper>
    );
}
