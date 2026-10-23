import { GalleryVerticalEnd } from "lucide-react";
import PlannedPage from "@/modules/campaigns/components/PlannedPage";
import { PLANNED_PAGES } from "@/modules/campaigns/lib/plannedPages";

const page = PLANNED_PAGES.media;
export const metadata = { title: page.title };

export default function CampaignsMediaPage() {
    return <PlannedPage icon={GalleryVerticalEnd} {...page} />;
}
