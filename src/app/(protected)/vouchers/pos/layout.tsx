import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Standalone POS shell — NO office sidebar / chrome / nav.
// Lives at /pos so it can be served from a subdomain in the future
// (e.g. pos.example.com → rewrite to /pos/* via middleware later).
//
// Auth: reuses staff session (same NextAuth provider). Customer sessions
// are blocked. No specific permission gate — any signed-in staff can
// generate an invoice from the POS.

export default async function PosLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");

    return (
        <SessionWrapper>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
                <Toaster position="top-center" richColors />
                {children}
            </div>
        </SessionWrapper>
    );
}
