import { Badge } from "@/components/ui/badge";
import { Globe, Store, Phone, MessageCircle, Package } from "lucide-react";
import type { OrderSource } from "@/generated/prisma/enums";

const SOURCE_CONFIG: Record<
    OrderSource,
    { label: string; icon: React.ElementType; className: string }
> = {
    ONLINE: { label: "Online", icon: Globe, className: "bg-blue-50 text-blue-700 border-blue-200" },
    IN_STORE: { label: "In Store", icon: Store, className: "bg-green-50 text-green-700 border-green-200" },
    PHONE: { label: "Phone", icon: Phone, className: "bg-amber-50 text-amber-700 border-amber-200" },
    WHATSAPP: { label: "WhatsApp", icon: MessageCircle, className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    OTHER: { label: "Other", icon: Package, className: "bg-gray-50 text-gray-600 border-gray-200" },
};

type Props = {
    source: OrderSource;
    size?: "sm" | "default";
};

export function OrderSourceBadge({ source, size = "default" }: Props) {
    const cfg = SOURCE_CONFIG[source] ?? SOURCE_CONFIG.OTHER;
    const Icon = cfg.icon;
    return (
        <Badge
            variant="outline"
            className={`${cfg.className} ${size === "sm" ? "text-[10px] px-1.5 py-0 gap-0.5" : "gap-1"}`}
        >
            <Icon className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
            {cfg.label}
        </Badge>
    );
}
