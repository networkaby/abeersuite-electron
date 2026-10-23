import { Cable } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.channels;
export const metadata = { title: page.title };

export default function CampaignsChannelsPage() {
    return <PlannedPage icon={Cable} {...page} />;
}
