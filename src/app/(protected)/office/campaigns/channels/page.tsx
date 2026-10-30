import { Cable } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import CampaignsHeader from "@/modules/campaigns/components/CampaignsHeader";
import GoogleChannelCard from "@/modules/campaigns/components/GoogleChannelCard";
import FacebookChannelCard from "@/modules/campaigns/components/FacebookChannelCard";
import WhatsAppChannelCard from "@/modules/campaigns/components/WhatsAppChannelCard";

export const metadata = { title: "Channels" };

export default function CampaignsChannelsPage() {
    return (
        <ScrollArea className="h-full" type="always">
            <div className="mx-auto max-w-5xl space-y-4 px-6 pt-4 pb-10">
                <CampaignsHeader
                    icon={Cable}
                    title="Channels"
                    description="Connect each account once. Connected channels post by themselves; the rest are shared by hand."
                />
                <GoogleChannelCard />
                <FacebookChannelCard />
                <WhatsAppChannelCard />
            </div>
        </ScrollArea>
    );
}
