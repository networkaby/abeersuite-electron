import { redirect } from "next/navigation";
import { auth } from "@/auth";
import SessionWrapper from "@/shared/components/SessionWrapper";

// Shared auth wrapper for /vouchers/pos/* routes.
// The list page (/vouchers/pos) renders inside the normal office chrome via
// the parent layout. The register (/vouchers/pos/new) has its own nested
// layout that adds the fixed-inset-0 standalone shell.

export default async function PosLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers%2Fpos");

    return <SessionWrapper session={session}>{children}</SessionWrapper>;
}
