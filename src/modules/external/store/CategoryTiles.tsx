import { Laptop, Monitor, Printer, Camera, Cpu, Wifi, HardDrive, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type Tile = {
    name: string;
    count: number;
    icon: LucideIcon;
    gradient: string;
};

const ICON_MAP: { match: RegExp; icon: LucideIcon; gradient: string }[] = [
    { match: /laptop/i, icon: Laptop, gradient: "from-sky-500/20 via-sky-500/5 to-transparent" },
    { match: /desktop|pc/i, icon: HardDrive, gradient: "from-violet-500/20 via-violet-500/5 to-transparent" },
    { match: /monitor|display/i, icon: Monitor, gradient: "from-emerald-500/20 via-emerald-500/5 to-transparent" },
    { match: /printer|ink|laser/i, icon: Printer, gradient: "from-amber-500/20 via-amber-500/5 to-transparent" },
    { match: /cctv|camera|security/i, icon: Camera, gradient: "from-rose-500/20 via-rose-500/5 to-transparent" },
    { match: /component|cpu|ram|ssd|psu/i, icon: Cpu, gradient: "from-indigo-500/20 via-indigo-500/5 to-transparent" },
    { match: /network|wifi|router/i, icon: Wifi, gradient: "from-teal-500/20 via-teal-500/5 to-transparent" },
];

function tileFor(name: string, count: number): Tile {
    const found = ICON_MAP.find((m) => m.match.test(name));
    return {
        name,
        count,
        icon: found?.icon ?? Package,
        gradient: found?.gradient ?? "from-primary/20 via-primary/5 to-transparent",
    };
}

export default function CategoryTiles({
    categoryCounts,
}: {
    categoryCounts: { name: string; count: number }[];
}) {
    if (categoryCounts.length === 0) return null;
    const tiles = categoryCounts.map((c) => tileFor(c.name, c.count));

    return (
        <section className="border-b border-border/60 bg-muted/20">
            <div className="mx-auto max-w-6xl px-4 py-12">
                <div className="mb-6 flex items-end justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Shop by category</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Pick a department — every tile jumps to that section in the catalog below.
                        </p>
                    </div>
                </div>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {tiles.map(({ name, count, icon: Icon, gradient }) => (
                        <li key={name}>
                            <a
                                href={`#cat-${encodeURIComponent(name)}`}
                                className={`group flex h-full flex-col gap-3 rounded-2xl border border-border/70 bg-linear-to-br ${gradient} bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md`}
                            >
                                <span className="flex size-12 items-center justify-center rounded-xl bg-background/70 text-primary shadow-sm backdrop-blur-sm">
                                    <Icon className="size-6" />
                                </span>
                                <div>
                                    <p className="font-semibold leading-tight text-foreground group-hover:text-primary">
                                        {name}
                                    </p>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        {count} item{count === 1 ? "" : "s"}
                                    </p>
                                </div>
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
