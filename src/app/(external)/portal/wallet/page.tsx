import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMockWallet } from "@/shared/lib/portal/mockAdapters";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { Wallet } from "lucide-react";

function formatInr(value: number) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

export default async function PortalWalletPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/wallet");
    }

    // Phase 2 contract: replace with wallet ledger API and live balance.
    const wallet = await getMockWallet();

    return (
        <main className="px-4 py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Wallet"
                    description="Track credits, refunds, and balance usage."
                    icon={Wallet}
                />
                <Card className="border-border/70">
                    <CardHeader>
                        <CardDescription>Available balance</CardDescription>
                        <CardTitle className="text-3xl tracking-tight">{formatInr(wallet.balanceInr)}</CardTitle>
                    </CardHeader>
                </Card>

                <Card className="border-border/70">
                    <CardHeader>
                        <CardTitle className="text-base">Recent transactions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {wallet.txns.map((txn) => (
                            <div key={txn.id} className="flex items-center justify-between rounded-md border border-border/70 p-3">
                                <div>
                                    <p className="text-sm font-medium">{txn.label}</p>
                                    <p className="text-xs text-muted-foreground">{txn.date}</p>
                                </div>
                                <div className="text-right">
                                    <p className={`text-sm font-semibold ${txn.type === "credit" ? "text-emerald-600" : "text-foreground"}`}>
                                        {txn.type === "credit" ? "+" : "-"}{formatInr(txn.amountInr)}
                                    </p>
                                    <Badge variant="outline" className="text-[10px]">{txn.type}</Badge>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}

