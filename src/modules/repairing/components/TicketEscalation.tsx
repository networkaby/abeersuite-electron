"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { toIsoDate } from "@/shared/hooks/useTallyDate";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props { ticket: { id: number }; onClose: () => void; }
type ServiceCenterOption = { id: number; name: string };
type EscalationFormData = { serviceCenterId: string; externalRef: string; escalatedAt: string; expectedReturn: string };

export default function TicketEscalation({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const [serviceCenters, setServiceCenters] = useState<ServiceCenterOption[]>([]);
    const { register, handleSubmit, setValue, watch, control, formState: { isSubmitting } } = useForm({
        defaultValues: { serviceCenterId: "", externalRef: "", escalatedAt: toIsoDate(new Date()), expectedReturn: "" },
    });
    const serviceCenterId = useWatch({ control, name: "serviceCenterId" });

    useEffect(() => { axios.get("/api/service-centers").then((r) => setServiceCenters(r.data)); }, []);

    const onSubmit = async (data: EscalationFormData) => {
        try {
            await axios.put(`/api/tickets/${ticket.id}`, {
                status: "S4", escalated: true,
                escalatedAt: data.escalatedAt,
                expectedReturn: data.expectedReturn || null,
                externalRef: data.externalRef || null,
                serviceCenterId: data.serviceCenterId || null,
                changedBy: session?.user?.id,
                logNote: `Escalated to ${serviceCenters.find(s => s.id === Number(data.serviceCenterId))?.name || "external service center"}`,
            });
            toast.success("Ticket escalated");
            onClose();
        } catch { toast.error("Failed to escalate ticket"); }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader className="flex-row items-center justify-between space-y-0">
                    <DialogTitle>Escalate to Service Center</DialogTitle>
                    <Button onClick={onClose} variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
                        <X size={20} />
                    </Button>
                </DialogHeader>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <input type="hidden" {...register("serviceCenterId")} />
                    <div>
                        <Label className="mb-1 block">Service Center</Label>
                        <Select value={serviceCenterId} onValueChange={(v) => setValue("serviceCenterId", v)}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select service center..." />
                            </SelectTrigger>
                            <SelectContent>
                                {serviceCenters.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="mb-1 block">
                            External Ref # <span className="text-muted-foreground">(optional)</span>
                        </Label>
                        <Input {...register("externalRef")} placeholder="Job number from service center" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <Label className="mb-1 block">Escalated Date</Label>
                            <TallyDateInput
                                value={watch("escalatedAt") ?? ""}
                                onValueChange={(iso) => setValue("escalatedAt", iso, { shouldValidate: true })}
                            />
                        </div>
                        <div>
                            <Label className="mb-1 block">
                                Expected Return <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <TallyDateInput
                                value={watch("expectedReturn") ?? ""}
                                onValueChange={(iso) => setValue("expectedReturn", iso, { shouldValidate: true })}
                            />
                        </div>
                    </div>
                    <DialogFooter className="pt-2">
                        <Button type="button" onClick={onClose} variant="outline" className="flex-1">Cancel</Button>
                        <Button type="submit" disabled={isSubmitting} className="flex-1">
                            {isSubmitting ? "Escalating..." : "Escalate"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
