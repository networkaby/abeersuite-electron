import { Zap } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.automations;
export const metadata = { title: page.title };

export default function CampaignsAutomationsPage() {
    return <PlannedPage icon={Zap} {...page} />;
}
