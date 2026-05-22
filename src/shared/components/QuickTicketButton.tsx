"use client";

import { useEffect, useState } from "react";
import { UserPlus, ArrowRight, ShieldCheck, Wrench, Building2, User } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuickTicketStore, type Step, type BasicIdentity } from "@/store/quickTicketStore";
import { useReferenceStore } from "@/store/referenceStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TallyDateInput } from "@/shared/components/TallyDateInput";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    PartySearchAndCreate,
    type PickedParty,
} from "@/shared/components/PartySearchAndCreate";

type Priority = { id: string; label: string };
type PipelineOption = { id: string; label: string; color: string; isDefault: boolean };
type LinkedCompany = { id: number; name: string; accountId: number | null };

const ticketSchema = z.object({
    deviceType: z.string().min(1, "Device type is required"),
    brand: z.string().min(1, "Brand is required"),
    model: z.string().min(1, "Model is required"),
    problem: z.string().min(1, "Problem is required"),
    priority: z.string(),
    notes: z.string().optional(),
    accessInfo: z.string().optional(),
    estimatedCost: z.string().optional(),
    primaryOwnerId: z.string().optional(),
    warrantyRef: z.string().optional(),
    purchaseDate: z.string().optional(),
});

type TicketFormData = z.infer<typeof ticketSchema>;

function FieldError({ message }: { message?: string }) {
    if (!message) return null;

    return <p className="text-xs text-destructive">{message}</p>;
}

function FieldLabel({ children, required = false }: { children: string; required?: boolean }) {
    return (
        <Label className="flex items-center gap-1.5">
            <span>{children}</span>
            {required && <span className="text-sm font-semibold text-destructive">*</span>}
        </Label>
    );
}

function invalidFieldClass(hasError?: boolean) {
    return hasError ? "border-destructive focus-visible:ring-destructive/20" : "";
}

function colorDot(color: string) {
    return color.split(" ")[0];
}

export default function QuickTicketButton() {
    const router = useRouter();
    const { data: session } = useSession();
    const {
        open, step, identity, billingAccountId,
        setStep, setIdentity, setBillingAccountId,
        setInitialPipelineId, reset,
    } = useQuickTicketStore();
    const { technicians, fetchTechnicians } = useReferenceStore();
    const [priorities, setPriorities] = useState<Priority[]>([]);
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const [selectedPipelineId, setSelectedPipelineId] = useState<string>("P1");
    const [isWarranty, setIsWarranty] = useState(false);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [linkedCompanies, setLinkedCompanies] = useState<LinkedCompany[]>([]);

    const ticketForm = useForm<TicketFormData>({
        resolver: zodResolver(ticketSchema) as Resolver<TicketFormData>,
        defaultValues: { priority: "MEDIUM", primaryOwnerId: "" },
    });
    const selectedPriority = ticketForm.watch("priority") ?? "MEDIUM";
    const selectedOwnerId = ticketForm.watch("primaryOwnerId") ?? "";

    useEffect(() => {
        if (!open) return;
        setIsWarranty(false);
        ticketForm.reset({ priority: "MEDIUM", primaryOwnerId: "" });
        setLinkedCompanies([]);
        setBillingAccountId(null);

        const pendingPipelineId = useQuickTicketStore.getState().initialPipelineId;
        if (pendingPipelineId) {
            setSelectedPipelineId(pendingPipelineId);
            setInitialPipelineId(null);
        }

        const load = async () => {
            await fetchTechnicians();
            const [prioRes, pipeRes] = await Promise.all([
                !dataLoaded ? axios.get<Priority[]>("/api/priorities") : Promise.resolve(null),
                !dataLoaded ? axios.get<PipelineOption[]>("/api/pipelines") : Promise.resolve(null),
            ]);
            if (prioRes) setPriorities(prioRes.data);
            if (pipeRes) {
                const fetched = pipeRes.data as PipelineOption[];
                setPipelines(fetched);
                setDataLoaded(true);
                if (!pendingPipelineId) {
                    const def = fetched.find((p) => p.isDefault) ?? fetched[0];
                    if (def) setSelectedPipelineId(def.id);
                }
            } else if (!pendingPipelineId) {
                const def = pipelines.find((p) => p.isDefault) ?? pipelines[0];
                if (def) setSelectedPipelineId(def.id);
            }
        };
        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!identity) return;
        setBillingAccountId(identity.accountId);
        if (identity.type === "customer") {
            setLinkedCompanies(identity.linkedCompanies ?? []);
        } else {
            setLinkedCompanies([]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identity]);

    const closeModal = () => reset();

    const handlePartyPicked = (p: PickedParty) => {
        const picked: BasicIdentity = {
            id: p.id,
            name: p.name,
            phone: p.phone,
            type: p.kind,
            accountId: p.accountId,
            linkedCompanies: p.linkedCompanies,
        };
        setIdentity(picked);
        setStep("ticket");
        toast.success(`Picked: ${picked.name}`);
    };

    const createTicket = async (data: TicketFormData) => {
        if (!identity) {
            toast.error("Customer or company is required");
            return;
        }

        try {
            const res = await axios.post("/api/tickets", {
                ...data,
                isWarranty,
                ...(identity.type === "customer" ? { customerId: identity.id } : { companyId: identity.id }),
                billingAccountId: billingAccountId ?? identity.accountId,
                createdBy: session?.user?.id,
                pipelineId: selectedPipelineId,
            });
            toast.success(`Ticket #${res.data.id} created!`);
            closeModal();
            window.open(`/receipt/${res.data.id}`, "_blank");
            router.push(`/office/repairing/tickets/${res.data.id}`);
        } catch {
            toast.error("Failed to create ticket");
        }
    };

    const stepLabels: { key: Step; label: string }[] = [
        { key: "phone", label: "Party" },
        { key: "ticket", label: "Ticket" },
    ];

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) closeModal(); }}>
            <DialogContent className="max-w-3xl gap-0 p-0 sm:max-w-3xl">
                <DialogHeader className="border-b border-border px-6 py-5 pr-12">
                    <div className="space-y-3">
                        <div>
                            <DialogTitle>New Ticket</DialogTitle>
                            <DialogDescription>
                                Search for an account, create it if needed, then capture the ticket details.
                            </DialogDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {stepLabels.map((s, i) => (
                                <div key={s.key} className="flex items-center gap-2">
                                    <Badge
                                        variant={step === s.key ? "default" : stepLabels.findIndex((x) => x.key === step) > i ? "secondary" : "outline"}
                                        className="min-w-6 justify-center"
                                    >
                                        {i + 1}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">{s.label}</span>
                                    {i < stepLabels.length - 1 && <ArrowRight size={12} className="text-muted-foreground" />}
                                </div>
                            ))}
                        </div>
                    </div>
                </DialogHeader>

                {step !== "ticket" ? (
                    <div className="px-6 py-5">
                        <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                                Search a person or company by name / phone / email. If none matches, ↵ to create.
                            </p>
                            <PartySearchAndCreate
                                onPicked={handlePartyPicked}
                                autoFocus
                                // A repair ticket always bills to a customer.
                                partyGroup="Sundry Debtors"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
                        {step === "ticket" && (
                        <form onSubmit={ticketForm.handleSubmit(createTicket)} className="space-y-5">
                            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/60 px-4 py-3 text-sm text-foreground">
                                <UserPlus size={15} />
                                <span><strong>{identity?.name}</strong> {identity?.phone && `— ${identity.phone}`}</span>
                                <Button type="button" variant="link" className="ml-auto h-auto px-0 text-xs text-muted-foreground" onClick={() => setStep("phone")}>
                                    Change
                                </Button>
                            </div>

                            {identity && linkedCompanies.length > 0 && (
                                <div className="space-y-2">
                                    <FieldLabel>Bill To</FieldLabel>
                                    <div className="space-y-2">
                                        <Button
                                            type="button"
                                            variant={billingAccountId === identity.accountId ? "default" : "outline"}
                                            className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
                                            onClick={() => setBillingAccountId(identity.accountId)}
                                        >
                                            <User size={14} className="shrink-0" />
                                            <span>{identity.name} <span className="text-xs opacity-70">(personal)</span></span>
                                        </Button>
                                        {linkedCompanies.map((lc) => (
                                            <Button
                                                key={lc.id}
                                                type="button"
                                                variant={billingAccountId === lc.accountId ? "default" : "outline"}
                                                className="h-auto w-full justify-start gap-3 px-3 py-3 text-left"
                                                onClick={() => setBillingAccountId(lc.accountId)}
                                            >
                                                <Building2 size={14} className="shrink-0" />
                                                <span>{lc.name}</span>
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {pipelines.length > 1 && (
                                <div className="space-y-2">
                                    <FieldLabel>Pipeline</FieldLabel>
                                    <div className="flex flex-wrap gap-2">
                                        {pipelines.map((p) => (
                                            <Button
                                                key={p.id}
                                                type="button"
                                                variant={selectedPipelineId === p.id ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setSelectedPipelineId(p.id)}
                                            >
                                                <span className={`h-2 w-2 ${colorDot(p.color)}`} />
                                                {p.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <FieldLabel required>Device Type</FieldLabel>
                                    <Input
                                        {...ticketForm.register("deviceType")}
                                        placeholder="Laptop, Printer..."
                                        autoFocus
                                        className={invalidFieldClass(Boolean(ticketForm.formState.errors.deviceType))}
                                    />
                                    <FieldError message={ticketForm.formState.errors.deviceType?.message} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel required>Brand</FieldLabel>
                                    <Input
                                        {...ticketForm.register("brand")}
                                        placeholder="HP, Dell..."
                                        className={invalidFieldClass(Boolean(ticketForm.formState.errors.brand))}
                                    />
                                    <FieldError message={ticketForm.formState.errors.brand?.message} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel required>Model</FieldLabel>
                                    <Input
                                        {...ticketForm.register("model")}
                                        placeholder="Model number"
                                        className={invalidFieldClass(Boolean(ticketForm.formState.errors.model))}
                                    />
                                    <FieldError message={ticketForm.formState.errors.model?.message} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <FieldLabel required>Problem Description</FieldLabel>
                                <Textarea
                                    {...ticketForm.register("problem")}
                                    rows={3}
                                    placeholder="Describe the issue..."
                                    className={invalidFieldClass(Boolean(ticketForm.formState.errors.problem))}
                                />
                                <FieldError message={ticketForm.formState.errors.problem?.message} />
                            </div>

                            <div className="space-y-2">
                                <FieldLabel>Job Type</FieldLabel>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        type="button"
                                        variant={!isWarranty ? "default" : "outline"}
                                        className="justify-center"
                                        onClick={() => {
                                            setIsWarranty(false);
                                            ticketForm.setValue("warrantyRef", "");
                                            ticketForm.setValue("purchaseDate", "");
                                        }}
                                    >
                                        <Wrench size={14} /> Paid Repair
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={isWarranty ? "default" : "outline"}
                                        className="justify-center"
                                        onClick={() => setIsWarranty(true)}
                                    >
                                        <ShieldCheck size={14} /> Warranty Claim
                                    </Button>
                                </div>
                            </div>

                            {isWarranty && (
                                <div className="grid grid-cols-2 gap-3 border-2 border-secondary/50 bg-secondary/30 p-4">
                                    <div className="space-y-2">
                                        <FieldLabel>Serial / Purchase Ref</FieldLabel>
                                        <Input {...ticketForm.register("warrantyRef")} placeholder="Serial or receipt ref" />
                                    </div>
                                    <div className="space-y-2">
                                        <FieldLabel>Purchase Date</FieldLabel>
                                        <TallyDateInput
                                            value={ticketForm.watch("purchaseDate") ?? ""}
                                            onValueChange={(iso) => ticketForm.setValue("purchaseDate", iso, { shouldValidate: true })}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <FieldLabel>Priority</FieldLabel>
                                    <Select
                                        value={selectedPriority}
                                        onValueChange={(value) => ticketForm.setValue("priority", value, { shouldValidate: true })}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Select priority" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {priorities.map((priority) => (
                                                <SelectItem key={priority.id} value={priority.id}>
                                                    {priority.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel>Primary Owner</FieldLabel>
                                    <Select
                                        value={selectedOwnerId || "__unassigned__"}
                                        onValueChange={(value) => ticketForm.setValue("primaryOwnerId", value === "__unassigned__" ? "" : value)}
                                    >
                                        <SelectTrigger className="w-full">
                                            <SelectValue placeholder="Unassigned" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__unassigned__">Unassigned</SelectItem>
                                            {technicians.map((technician) => (
                                                <SelectItem key={technician.id} value={String(technician.id)}>
                                                    {technician.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <FieldLabel>Access Info</FieldLabel>
                                    <Input {...ticketForm.register("accessInfo")} placeholder="Device PIN or password" />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel>Estimated Cost</FieldLabel>
                                    <Input {...ticketForm.register("estimatedCost")} type="text" inputMode="decimal" placeholder="0.00" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <FieldLabel>Notes</FieldLabel>
                                <Textarea {...ticketForm.register("notes")} rows={2} placeholder="Internal notes..." />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <Button type="button" variant="outline" className="flex-1" onClick={closeModal}>
                                    Cancel
                                </Button>
                                <Button type="submit" className="flex-1" disabled={ticketForm.formState.isSubmitting}>
                                    {ticketForm.formState.isSubmitting ? "Creating..." : "Create Ticket"}
                                </Button>
                            </div>
                        </form>
                    )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
