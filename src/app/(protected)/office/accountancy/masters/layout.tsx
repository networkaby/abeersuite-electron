import { auth } from "@/auth";
import { VouchersRegistersNav } from "@/modules/accountancy/components/VouchersRegistersNav";

export default async function VouchersRegistersLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    const permissions = (session?.user as { permissions?: string[] } | undefined)?.permissions ?? [];

    return (
        // <div className="container max-w-7xl py-6 space-y-6">
        <div className="container max-w-7xl py-0 space-y-0">
            <div>
                {/* <h1 className="text-2xl font-semibold tracking-tight">Vouchers Register</h1> */}
                {/* <p className="text-muted-foreground text-sm">
                    Browse and filter vouchers by kind — trading, money flow, orders, and stock movement.
                </p> */}
            </div>
            <VouchersRegistersNav permissions={permissions} />
            {children}
        </div>
    );
}
