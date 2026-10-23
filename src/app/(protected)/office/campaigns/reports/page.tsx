import { ChartNoAxesCombined } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.reports;
export const metadata = { title: page.title };

export default function CampaignsReportsPage() {
    return <PlannedPage icon={ChartNoAxesCombined} {...page} />;
}
