import Link from "next/link";
import {
    Calculator,
    Boxes,
    Users,
    Wrench,
    ShieldCheck,
    Map as MapIcon,
    ShoppingBag,
    MessageSquare,
} from "lucide-react";

interface BackOfficeCard {
    title: string;
    description: string;
    href: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    accent: string;
}

/**
 * Back Office cards link back into the existing /office sub-pages. The
 * goal of this experimental page is just to prove the split — clicking a
 * card hands the user off to the existing rich /office layout.
 */
const CARDS: BackOfficeCard[] = [
    {
        title: "Accountancy",
        description: "Vouchers, ledgers, day book, balance sheet, GST",
        href: "/office/accountancy",
        icon: Calculator,
        accent: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    },
    {
        title: "Inventory",
        description: "Products, stock, masters, GRN, transfers",
        href: "/office/inventory",
        icon: Boxes,
        accent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    {
        title: "Customers (CRM)",
        description: "Persons, companies, leads, follow-ups",
        href: "/office/crm/deals",
        icon: Users,
        accent: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
    },
    {
        title: "Repair workshop",
        description: "Tickets, devices, technicians, service centres",
        href: "/office/repairing",
        icon: Wrench,
        accent: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
    },
    {
        title: "Online shop",
        description: "Ecommerce orders, listings, coupons",
        href: "/office/ecommerce",
        icon: ShoppingBag,
        accent: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
    },
    {
        title: "Messaging",
        description: "Internal chat, notifications, social wall",
        href: "/office/message",
        icon: MessageSquare,
        accent: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
    },
    {
        title: "Admin",
        description: "Branches, departments, posts, roles, users",
        href: "/office/admin",
        icon: ShieldCheck,
        accent: "bg-red-500/10 text-red-700 dark:text-red-400",
    },
    {
        title: "Roadmap",
        description: "Build plan + completed phases",
        href: "/office/roadmap",
        icon: MapIcon,
        accent: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    },
];

export default function LabBackOfficePage() {
    return (
        <div className="mx-auto max-w-6xl p-6 md:p-10">
            <div className="mb-8">
                <h1 className="text-2xl font-semibold text-foreground">
                    Back Office
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Internal modules. Each card opens the existing /office page in
                    its current layout.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {CARDS.map((card) => {
                    const Icon = card.icon;
                    return (
                        <Link
                            key={card.href}
                            href={card.href}
                            className="group flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-all hover:border-foreground/30 hover:shadow-sm"
                        >
                            <div
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${card.accent}`}
                            >
                                <Icon size={20} />
                            </div>
                            <div>
                                <div className="font-medium text-foreground group-hover:text-foreground">
                                    {card.title}
                                </div>
                                <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                    {card.description}
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div className="mt-10 rounded-md border border-dashed border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Note —</span>{" "}
                this Back Office page is intentionally minimal for the experiment.
                Clicking any card jumps back to the existing /office layout
                (sidebar, top bar, the works). A real Back Office redesign is a
                follow-up task once the Front Office concept is approved.
            </div>
        </div>
    );
}
