import { RadioTower } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.broadcast;
export const metadata = { title: page.title };

export default function CampaignsBroadcastPage() {
    return <PlannedPage icon={RadioTower} {...page} />;
}
