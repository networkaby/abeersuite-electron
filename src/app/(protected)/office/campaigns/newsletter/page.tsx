import { Newspaper } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.newsletter;
export const metadata = { title: page.title };

export default function CampaignsNewsletterPage() {
    return <PlannedPage icon={Newspaper} {...page} />;
}
