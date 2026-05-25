import { notFound } from "next/navigation";
import { MODULE_SECTIONS } from "@/utils/constants";
import OfficeModuleHub from "@/shared/components/OfficeModuleHub";
import { isRoadmapModuleKey, roadmapHubCards, roadmapHubHref } from "@/utils/roadmap-modules";

export default async function RoadmapHubPage({ params }: { params: Promise<{ moduleKey: string }> }) {
    const { moduleKey } = await params;
    if (!isRoadmapModuleKey(moduleKey)) notFound();

    const mod = MODULE_SECTIONS.find((m) => m.key === moduleKey);
    if (!mod) notFound();

    const base = roadmapHubHref(moduleKey);
    const cards = roadmapHubCards(moduleKey).map((c) => ({
        title: c.label,
        href: c.href,
        description: `Open ${c.label.toLowerCase()} — UI shell; data integrations follow later.`,
        icon: c.icon,
    }));

    return (
        <OfficeModuleHub
            heading="Overview"
            intro={`Pick a ${mod.label} area from the cards below or from the tabs above. Overview stays at ${base}.`}
            cards={cards}
        />
    );
}
