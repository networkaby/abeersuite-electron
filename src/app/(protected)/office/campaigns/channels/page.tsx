import { Cable } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import GoogleChannelCard from "@/modules/campaigns/components/GoogleChannelCard";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.channels;
export const metadata = { title: page.title };

export default function CampaignsChannelsPage() {
    return (
        <PlannedPage icon={Cable} {...page}>
            <GoogleChannelCard />
        </PlannedPage>
    );
}
