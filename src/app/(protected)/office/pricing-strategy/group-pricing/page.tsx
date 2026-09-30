import { GroupPricingManager } from "@/modules/pricing-strategy/components/GroupPricingManager";

export const metadata = { title: "Group pricing" };

// Pricing Strategy → Group pricing — each customer group's price type per
// product group (MRP / print price / profit sharing / revenue discount) and
// which automatic benefits it gets. POS only.
export default function GroupPricingPage() {
    return <GroupPricingManager />;
}
