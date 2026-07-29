import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Standalone POS register shell — NO office sidebar / chrome / nav.
// Full-screen fixed layout so the register gets the whole viewport.
// Auth: reuses staff session (same NextAuth provider). Customer sessions blocked.

export default async function PosRegisterLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Fnew");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos%2Fnew");

    return (
        <SessionWrapper session={session}>
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-background text-foreground">
                <Toaster position="top-center" richColors />
                {children}
            </div>
        </SessionWrapper>
    );
}
