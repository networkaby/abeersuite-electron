import Link from "next/link";
import { notFound } from "next/navigation";
import { MODULE_SECTIONS } from "@/utils/constants";
import { isRoadmapModuleKey, roadmapModuleLinks } from "@/utils/roadmap-modules";

export default async function RoadmapModuleLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ moduleKey: string }>;
}) {
    const { moduleKey } = await params;
    if (!isRoadmapModuleKey(moduleKey)) notFound();

    const mod = MODULE_SECTIONS.find((m) => m.key === moduleKey);
    if (!mod) notFound();

    const links = roadmapModuleLinks(moduleKey);

    return (
        <div className="container max-w-7xl py-6 space-y-6">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{mod.label}</h1>
                <p className="text-muted-foreground text-sm">
                    Roadmap module — navigation and shells are live; business logic will land in
                    future milestones.
                </p>
            </div>
            <nav
                className="flex flex-wrap gap-2 border-b-2 border-border pb-4"
                aria-label={`${mod.label} sections`}
            >
                {links.map(({ href, label, icon: Icon }) => (
                    <Link
                        key={href}
                        href={href}
                        className="inline-flex items-center gap-2 border-2 border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                    >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        {label}
                    </Link>
                ))}
            </nav>
            {children}
        </div>
    );
}
