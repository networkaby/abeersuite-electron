import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export type OfficeModuleHubCard = {
    title: string;
    href: string;
    description: string;
    icon: LucideIcon;
};

export default function OfficeModuleHub({
    heading,
    intro,
    cards,
}: {
    heading: string;
    intro: string;
    cards: OfficeModuleHubCard[];
}) {
    return (
        <div className="space-y-4">
            <div>
                <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
                <p className="text-muted-foreground text-sm">{intro}</p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map(({ title, href, description, icon: Icon }) => (
                    <li key={href}>
                        <Link
                            href={href}
                            className="flex h-full flex-col gap-2 border-2 border-border bg-card p-4 transition-colors hover:bg-muted"
                        >
                            <span className="flex items-center gap-2 font-semibold">
                                <Icon className="size-5 shrink-0" aria-hidden />
                                {title}
                            </span>
                            <span className="text-muted-foreground text-sm">{description}</span>
                        </Link>
                    </li>
                ))}
            </ul>
        </div>
    );
}
