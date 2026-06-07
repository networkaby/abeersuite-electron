import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Standalone POS Estimate shell — NO office sidebar / chrome / nav.
// Mirrors the POS register shell (full-screen fixed layout). Estimate mode is a
// SEPARATE page so the protected POS Sale voucher is never touched.

export default async function PosEstimateLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Festimate");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Festimate");

    return (
        <SessionWrapper>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
                <Toaster position="top-center" richColors />
                {children}
            </div>
        </SessionWrapper>
    );
}
