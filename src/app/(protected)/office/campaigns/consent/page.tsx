import { BellOff } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.consent;
export const metadata = { title: page.title };

export default function CampaignsConsentPage() {
    return <PlannedPage icon={BellOff} {...page} />;
}
