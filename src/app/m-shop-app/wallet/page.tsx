import MobileHeader from "@/modules/mobile/components/MobileHeader";
import { requireAppCustomer } from "@/modules/external/shopApp/appSession";
import { APP } from "@/modules/external/shopApp/appPaths";
import { getMockWallet } from "@/shared/lib/portal/mockAdapters";
import { formatRupees } from "@/shared/lib/format/moneyInr";

/** My Wallet — the same figures as the portal's (still its sample data; see PROJECT_BRAIN). */
export default async function CustomerAppWalletPage() {
    await requireAppCustomer(`${APP}/wallet`);
    const wallet = await getMockWallet();
    return (
        <>
            <MobileHeader title="My wallet" back={`${APP}/account`} />
            <section className="m-3 rounded-2xl bg-primary p-5 text-primary-foreground">
                <p className="text-xs opacity-80">Available balance</p>
                <p className="text-3xl font-bold tabular-nums">{formatRupees(wallet.balanceInr)}</p>
            </section>
            <h2 className="px-4 pb-1 pt-2 text-sm font-semibold">Recent activity</h2>
            <ul className="divide-y bg-background">
                {wallet.txns.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <span className="min-w-0">
                            <span className="block truncate text-sm">{t.label}</span>
                            <span className="block text-xs text-muted-foreground">{t.date}</span>
                        </span>
                        <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.type === "credit" ? "text-emerald-700" : ""}`}>
                            {t.type === "credit" ? "+" : "−"}
                            {formatRupees(t.amountInr)}
                        </span>
                    </li>
                ))}
            </ul>
        </>
    );
}
