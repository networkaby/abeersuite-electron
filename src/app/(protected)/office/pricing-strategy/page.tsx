import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function PricingStrategyOverviewPage() {
    return (
        <Card className="border-2 border-border">
            <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>
                    Pricing-strategy module — define how sale prices are computed from cost.
                </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
                <p>
                    <strong>Strategies</strong> set margin rules at four scopes (ORG, CATEGORY,
                    GROUP, BRAND). Resolution walks BRAND → GROUP → CATEGORY → ORG; the most
                    specific match wins, with priority as a tiebreaker.
                </p>
                <p>
                    Each <strong>InvProduct</strong> picks one of five cost-basis methods —
                    Weighted Average (default), FIFO, Last Purchase, Monthly Average, or Standard
                    Cost. The matched strategy applies a percent + flat markup, then rounds.
                </p>
                <p className="text-xs">
                    Discounts and coupons are tracked as a separate future module.
                </p>
            </CardContent>
        </Card>
    );
}
