import type { LucideIcon } from "lucide-react";

type Props = {
    title: string;
    description: string;
    icon: LucideIcon;
    rightSlot?: React.ReactNode;
};

export default function PortalSectionHeader({ title, description, icon: Icon, rightSlot }: Props) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
            <div>
                <h1 className="text-xl font-semibold sm:text-2xl tracking-tight flex items-center gap-2">
                    <Icon className="size-5 text-primary" />
                    {title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </div>
            {rightSlot ?? null}
        </div>
    );
}

