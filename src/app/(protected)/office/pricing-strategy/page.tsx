import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PricingStrategyOverviewPage() {
    return (
        <div className="px-6 pb-6">
        <Card className="border-2 border-border">
            <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>
                    Pricing-strategy module — define how sale prices are computed from cost.
                </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                    <strong>Strategies</strong> use an additive-margin model: you assign margin
                    POINTS to each dimension, and a product&apos;s margin% is their{" "}
                    <strong>sum</strong> — <code>base + brand + category + group</code>. The sell
                    price is a markup on cost, GST-inclusive and MRP-capped:{" "}
                    <code>price = cost × (1 + margin/100)</code>.
                </p>
                <p>
                    Each <strong>InvProduct</strong> picks a cost-basis method — Weighted Average
                    (default), FIFO, Simple Average, Monthly Average, or Last Inward — or inherits
                    the org default. A product&apos;s <strong>sale-price source</strong>
                    (Strategy / Computed / Saved) decides which price materializes into the live{" "}
                    <code>effectiveSalePricePaise</code> that POS and the shop charge.
                </p>
                <p className="text-xs">
                    Discounts and coupons are tracked as a separate future module.
                </p>
            </CardContent>
        </Card>
        </div>
    );
}
