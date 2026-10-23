import { Blend } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.segments;
export const metadata = { title: page.title };

export default function CampaignsSegmentsPage() {
    return <PlannedPage icon={Blend} {...page} />;
}
