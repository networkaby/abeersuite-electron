"use client";

import { useState } from "react";
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
import { PartySearchAndCreate, type PickedParty } from "@/shared/components/PartySearchAndCreate";
import type { EscalatedTo } from "@/modules/repairing/lib/serviceCentre";

interface Props { ticket: { id: number }; onClose: () => void; }
type EscalationFormData = { externalRef: string; escalatedAt: string; expectedReturn: string };

export default function TicketEscalation({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    // The service centre is a Sundry-Creditor party — same picker as the shipping slip.
    const [centre, setCentre] = useState<EscalatedTo | null>(null);
    const { register, handleSubmit, setValue, control, formState: { isSubmitting } } = useForm({
        defaultValues: { externalRef: "", escalatedAt: toIsoDate(new Date()), expectedReturn: "" },
    });
    const escalatedAt = useWatch({ control, name: "escalatedAt" });
    const expectedReturn = useWatch({ control, name: "expectedReturn" });

    const onPicked = (p: PickedParty) => {
        if (p.accountId == null) {
            toast.error(`${p.name} has no ledger account yet`);
            return;
        }
        setCentre({ accountId: p.accountId, name: p.name });
    };

    const onSubmit = async (data: EscalationFormData) => {
        try {
            await axios.put(`/api/tickets/${ticket.id}`, {
                status: "S4", escalated: true,
                escalatedAt: data.escalatedAt,
                expectedReturn: data.expectedReturn || null,
                externalRef: data.externalRef || null,
                escalatedTo: centre,
                changedBy: session?.user?.id,
                logNote: `Escalated to ${centre?.name || "external service center"}`,
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
                    <div>
                        <Label className="mb-1 block">
                            Service Center <span className="text-muted-foreground font-normal">(Sundry Creditor)</span>
                        </Label>
                        {centre ? (
                            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                <span className="font-medium">{centre.name}</span>
                                <Button type="button" variant="ghost" size="xs" onClick={() => setCentre(null)}>Change</Button>
                            </div>
                        ) : (
                            <PartySearchAndCreate
                                partyGroup="Sundry Creditors"
                                allowIncludeOther
                                defaultToCompany
                                onPicked={onPicked}
                                placeholder="Search service centre by name / phone · ↵ on no-result to create"
                            />
                        )}
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
                                value={escalatedAt ?? ""}
                                onValueChange={(iso) => setValue("escalatedAt", iso, { shouldValidate: true })}
                            />
                        </div>
                        <div>
                            <Label className="mb-1 block">
                                Expected Return <span className="text-muted-foreground">(optional)</span>
                            </Label>
                            <TallyDateInput
                                value={expectedReturn ?? ""}
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
