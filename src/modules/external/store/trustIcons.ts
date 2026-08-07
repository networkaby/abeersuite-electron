import { Truck, RotateCcw, Headphones, ShieldCheck, MapPin, Wrench, Clock, PhoneCall, Award, CheckCircle, type LucideIcon } from "lucide-react";
import type { TrustIconKey } from "@/shared/lib/shop/homeLayout";

// Client-safe (icons only, no prisma) — shared by TrustStrip's render and the
// Customize Home icon picker, so the two never drift out of sync.

export const TRUST_ICON_MAP: Record<TrustIconKey, LucideIcon> = {
    truck: Truck,
    returns: RotateCcw,
    support: Headphones,
    shield: ShieldCheck,
    location: MapPin,
    wrench: Wrench,
    clock: Clock,
    phone: PhoneCall,
    award: Award,
    check: CheckCircle,
};

export const TRUST_ICON_LABELS: Record<TrustIconKey, string> = {
    truck: "Delivery",
    returns: "Returns",
    support: "Support",
    shield: "Security",
    location: "Location",
    wrench: "Service",
    clock: "Hours",
    phone: "Phone",
    award: "Warranty",
    check: "Checkmark",
};
