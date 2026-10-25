import { redirect } from "next/navigation";
import { redirectIfPcWithoutCounter } from "@/shared/lib/auth/permissions";
import { auth } from "@/auth";
import { Toaster } from "sonner";
import SessionWrapper from "@/shared/components/SessionWrapper";
import CurrencySymbolInit from "@/shared/components/CurrencySymbolInit";
import { loadCurrencySymbol } from "@/shared/lib/format/currencySymbol.server";

// Shared auth wrapper + SessionProvider for ALL `/vouchers/*` routes.
//
// Most inventory detail pages (InvVoucherDetail) and the new GL/JE edit
// forms (GlVoucherPage, JournalVoucherPage) call `useSession()` to
// read user permissions for lifecycle action gating — that hook fails
// without a SessionProvider in the tree, hence this parent layout.
//
// Child layouts like `(gl)/layout.tsx` and `pos/layout.tsx` keep their own
// SessionWrapper for defence in depth; nested providers are harmless.

export default async function VouchersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const user = session?.user as { kind?: string } | undefined;
    if (!user) redirect("/staff/login?callbackUrl=%2Fvouchers");
    if (user.kind === "customer") redirect("/staff/login?callbackUrl=%2Fvouchers");
    redirectIfPcWithoutCounter();
    const symbol = await loadCurrencySymbol();

    return (
        <SessionWrapper session={session}>
            <CurrencySymbolInit symbol={symbol} />
            <Toaster position="top-center" richColors />
            {children}
        </SessionWrapper>
    );
}
