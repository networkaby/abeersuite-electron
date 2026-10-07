import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getMockCoupons } from "@/shared/lib/portal/mockAdapters";
import PortalSectionHeader from "@/modules/external/portal/PortalSectionHeader";
import { Percent } from "lucide-react";

export default async function PortalCouponsPage() {
    const session = await auth();
    const kind = (session?.user as { kind?: string } | undefined)?.kind;
    if (!session?.user || kind !== "customer") {
        redirect("/login?callbackUrl=/portal/coupons");
    }

    // Phase 2 contract: replace with customer coupon entitlement API.
    const coupons = await getMockCoupons();

    return (
        <main className="px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
            <div className="mx-auto max-w-5xl space-y-5">
                <PortalSectionHeader
                    title="My Coupons"
                    description="Available offers across purchases and repairs."
                    icon={Percent}
                />
                <div className="grid gap-4 md:grid-cols-2">
                    {coupons.map((coupon) => (
                        <Card key={coupon.id} className="border-border/70">
                            <CardHeader>
                                <div className="flex items-center justify-between gap-3">
                                    <CardTitle className="text-lg">{coupon.code}</CardTitle>
                                    <Badge variant={coupon.state === "active" ? "secondary" : "outline"}>
                                        {coupon.state}
                                    </Badge>
                                </div>
                                <CardDescription>{coupon.title}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-1.5 text-sm">
                                <p>{coupon.description}</p>
                                <p className="text-xs text-muted-foreground">Expires: {coupon.expiresAt}</p>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </div>
        </main>
    );
}

