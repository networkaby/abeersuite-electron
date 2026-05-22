import { Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { CustomerDevice } from "@/modules/customer/lib/customerTypes";

interface Props {
    devices: CustomerDevice[];
}

/**
 * Compact 2-column grid of device cards shown inside profile tabs.
 * Returns null when the devices array is empty.
 */
export default function DevicesMiniGrid({ devices }: Props) {
    if (devices.length === 0) return null;
    return (
        <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                <Smartphone size={11} /> Devices
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {devices.map((d) => (
                    <Card key={d.id}>
                        <CardContent className="py-3">
                            <p className="text-sm font-medium">{d.brand} {d.model}</p>
                            <p className="text-xs text-muted-foreground">
                                {d.type} · {d.tickets.length} ticket{d.tickets.length !== 1 ? "s" : ""}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
