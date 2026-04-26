"use client";

import { useEffect, useState } from "react";
import { Search, UserPlus, ArrowRight, ShieldCheck, Wrench, Building2, User } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuickTicketStore, type Step, type BasicIdentity } from "@/store/quickTicketStore";
import { useReferenceStore } from "@/store/referenceStore";
import { cn } from "@/lib/utils";
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
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Priority = { id: string; label: string };
type PipelineOption = { id: string; label: string; color: string; isDefault: boolean };
type LinkedCompany = { id: number; name: string; accountId: number | null };
type SearchSuggestion = BasicIdentity;

const accountSchema = z.object({
    type: z.enum(["individual", "company"]),
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().optional().or(z.literal("")),
    companyReg: z.string().optional().or(z.literal("")),
    taxId: z.string().optional().or(z.literal("")),
});

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

type AccountFormData = z.infer<typeof accountSchema>;
type TicketFormData = z.infer<typeof ticketSchema>;

function FieldError({ message }: { message?: string }) {
    if (!message) return null;

    return <p className="text-xs text-destructive">{message}</p>;
}

function colorDot(color: string) {
    return color.split(" ")[0];
}

export default function QuickTicketButton() {
    const router = useRouter();
    const { data: session } = useSession();
    const {
        open, step, phone, identity, billingAccountId,
        setStep, setPhone, setIdentity, setBillingAccountId,
        setInitialPipelineId, reset,
    } = useQuickTicketStore();
    const { technicians, fetchTechnicians } = useReferenceStore();
    const [searching, setSearching] = useState(false);
    const [priorities, setPriorities] = useState<Priority[]>([]);
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const [selectedPipelineId, setSelectedPipelineId] = useState<string>("P1");
    const [isWarranty, setIsWarranty] = useState(false);
    const [dataLoaded, setDataLoaded] = useState(false);
    const [linkedCompanies, setLinkedCompanies] = useState<LinkedCompany[]>([]);
    const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);

    const accountForm = useForm<AccountFormData>({
        resolver: zodResolver(accountSchema) as Resolver<AccountFormData>,
        defaultValues: { type: "individual" },
    });
    const accountType = accountForm.watch("type") ?? "individual";

    const ticketForm = useForm<TicketFormData>({
        resolver: zodResolver(ticketSchema) as Resolver<TicketFormData>,
        defaultValues: { priority: "MEDIUM", primaryOwnerId: "" },
    });
    const selectedPriority = ticketForm.watch("priority") ?? "MEDIUM";
    const selectedOwnerId = ticketForm.watch("primaryOwnerId") ?? "";

    useEffect(() => {
        if (!open) return;
        setIsWarranty(false);
        accountForm.reset();
        ticketForm.reset({ priority: "MEDIUM", primaryOwnerId: "" });
        setLinkedCompanies([]);
        setBillingAccountId(null);
        setSuggestions([]);
        setShowSuggestions(false);
        setLookupLoading(false);
        setHighlightedIndex(-1);

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

    useEffect(() => {
        if (!open || step !== "phone") return;

        const query = phone.trim();
        if (query.length < 2) {
            setSuggestions([]);
            setShowSuggestions(false);
            setLookupLoading(false);
            setHighlightedIndex(-1);
            return;
        }

        const timer = window.setTimeout(async () => {
            setLookupLoading(true);
            try {
                const res = await axios.get<SearchSuggestion[]>(`/api/customers?lookup=${encodeURIComponent(query)}`);
                setSuggestions(res.data);
                setShowSuggestions(true);
                setHighlightedIndex(res.data.length > 0 ? 0 : -1);
            } catch {
                setSuggestions([]);
                setShowSuggestions(false);
                setHighlightedIndex(-1);
            } finally {
                setLookupLoading(false);
            }
        }, 250);

        return () => window.clearTimeout(timer);
    }, [open, phone, step]);

    const selectIdentity = (found: BasicIdentity) => {
        setPhone(found.phone ?? found.name);
        setIdentity(found);
        setSuggestions([]);
        setShowSuggestions(false);
        setHighlightedIndex(-1);
        setStep("ticket");
        toast.success(`Found: ${found.name}`);
    };

    const searchByPhone = async () => {
        if (!phone.trim()) return;
        setSearching(true);
        try {
            const res = await axios.get<BasicIdentity[]>(`/api/customers?lookup=${encodeURIComponent(phone.trim())}`);
            if (res.data && res.data.length > 0) {
                selectIdentity(res.data[0]);
            } else {
                accountForm.setValue("phone", phone.trim());
                setSuggestions([]);
                setShowSuggestions(false);
                setStep("account");
            }
        } catch {
            accountForm.setValue("phone", phone.trim());
            setSuggestions([]);
            setShowSuggestions(false);
            setStep("account");
        } finally {
            setSearching(false);
        }
    };

    const createAccount = async (data: AccountFormData) => {
        try {
            if (data.type === "company") {
                const res = await axios.post("/api/companies", {
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    address: data.address,
                    companyReg: data.companyReg,
                    taxId: data.taxId,
                });
                const raw = res.data;
                setIdentity({
                    id: raw.id,
                    name: raw.name,
                    phone: raw.phone ?? null,
                    type: "company",
                    accountId: raw.account?.id ?? null,
                    linkedCompanies: [],
                });
                setStep("ticket");
                toast.success("Company created!");
                return;
            }

            const res = await axios.post("/api/customers", {
                name: data.name,
                phone: data.phone,
                email: data.email,
                address: data.address,
            });
            const raw = res.data;
            setIdentity({
                id: raw.id,
                name: raw.name,
                phone: raw.phone ?? null,
                type: "customer",
                accountId: raw.account?.id ?? null,
                linkedCompanies: [],
            });
            setStep("ticket");
            toast.success("Customer created!");
        } catch {
            toast.error(data.type === "company" ? "Failed to create company" : "Failed to create customer");
        }
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
            router.push(`/tickets/${res.data.id}`);
        } catch {
            toast.error("Failed to create ticket");
        }
    };

    const stepLabels: { key: Step; label: string }[] = [
        { key: "phone", label: "Search" },
        { key: "account", label: "Account" },
        { key: "ticket", label: "Ticket" },
    ];

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) closeModal(); }}>
            <DialogContent showCloseButton={false} className="max-w-3xl gap-0 p-0 sm:max-w-3xl">
                <DialogHeader className="border-b px-6 py-5">
                    <div className="flex items-start justify-between gap-4">
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
                        <Button type="button" variant="ghost" size="icon-sm" onClick={closeModal}>
                            <span className="sr-only">Close</span>
                            <ArrowRight className="rotate-45" />
                        </Button>
                    </div>
                </DialogHeader>

                <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
                    {step === "phone" && (
                        <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Search account by mobile number or name to get started.
                            </p>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        type="text"
                                        value={phone}
                                        onChange={(e) => {
                                            setPhone(e.target.value);
                                            setShowSuggestions(true);
                                        }}
                                        onFocus={() => {
                                            if (suggestions.length > 0) setShowSuggestions(true);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "ArrowDown" && suggestions.length > 0) {
                                                e.preventDefault();
                                                setShowSuggestions(true);
                                                setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
                                                return;
                                            }

                                            if (e.key === "ArrowUp" && suggestions.length > 0) {
                                                e.preventDefault();
                                                setShowSuggestions(true);
                                                setHighlightedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
                                                return;
                                            }

                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                if (showSuggestions && highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                                                    selectIdentity(suggestions[highlightedIndex]);
                                                    return;
                                                }
                                                searchByPhone();
                                                return;
                                            }

                                            if (e.key === "Escape") {
                                                setShowSuggestions(false);
                                            }
                                        }}
                                        placeholder="Enter mobile or name..."
                                        className="pl-9"
                                        autoFocus
                                    />
                                    {showSuggestions && (suggestions.length > 0 || (phone.trim().length >= 2 && !lookupLoading)) && (
                                        <div className="absolute top-[calc(100%+0.5rem)] right-0 left-0 z-10 overflow-hidden rounded-xl border bg-popover shadow-md">
                                            {suggestions.length > 0 ? (
                                                suggestions.map((suggestion, index) => (
                                                    <button
                                                        key={`${suggestion.type}-${suggestion.id}`}
                                                        type="button"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => selectIdentity(suggestion)}
                                                        className={cn(
                                                            "flex w-full items-center justify-between px-4 py-3 text-left text-sm transition-colors",
                                                            highlightedIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                                                        )}
                                                    >
                                                        <span className="truncate font-medium">
                                                            {suggestion.name} - {suggestion.phone ?? "No mobile"}
                                                        </span>
                                                        <span className="ml-3 shrink-0 text-xs uppercase text-muted-foreground">
                                                            {suggestion.type}
                                                        </span>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="px-4 py-3 text-sm text-muted-foreground">
                                                    No matching account found.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <Button type="button" onClick={searchByPhone} disabled={searching || !phone.trim()}>
                                    {searching ? "Searching..." : "Search"}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {lookupLoading ? "Searching suggestions..." : "If not found, you’ll create a new account."}
                            </p>
                        </div>
                    )}

                    {step === "account" && (
                        <form onSubmit={accountForm.handleSubmit(createAccount)} className="space-y-4">
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                No account found for <strong>{phone}</strong>. Choose individual or company, then fill in the details.
                            </div>

                            <div className="space-y-2">
                                <Label>Account Type</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        type="button"
                                        variant={accountType === "individual" ? "default" : "outline"}
                                        className="justify-center"
                                        onClick={() => accountForm.setValue("type", "individual")}
                                    >
                                        <User size={15} /> Individual
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={accountType === "company" ? "default" : "outline"}
                                        className="justify-center"
                                        onClick={() => accountForm.setValue("type", "company")}
                                    >
                                        <Building2 size={15} /> Company
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>{accountType === "company" ? "Company Name" : "Full Name"}</Label>
                                <Input
                                    {...accountForm.register("name")}
                                    placeholder={accountType === "company" ? "ABC Pvt Ltd" : "Full name"}
                                    autoFocus
                                />
                                <FieldError message={accountForm.formState.errors.name?.message} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Phone</Label>
                                    <Input {...accountForm.register("phone")} />
                                    <FieldError message={accountForm.formState.errors.phone?.message} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input {...accountForm.register("email")} placeholder="email@example.com" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Address</Label>
                                <Input {...accountForm.register("address")} placeholder="Street, City" />
                            </div>

                            {accountType === "company" && (
                                <div className="grid grid-cols-2 gap-3 rounded-xl border border-primary/15 bg-muted/40 p-4">
                                    <div className="space-y-2">
                                        <Label>Company Reg #</Label>
                                        <Input {...accountForm.register("companyReg")} placeholder="Trade licence / Reg no." />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Tax / VAT ID</Label>
                                        <Input {...accountForm.register("taxId")} placeholder="GST / VAT number" />
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3 pt-1">
                                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("phone")}>
                                    Back
                                </Button>
                                <Button type="submit" className="flex-1" disabled={accountForm.formState.isSubmitting}>
                                    {accountForm.formState.isSubmitting
                                        ? "Creating..."
                                        : accountType === "company"
                                            ? "Create Company & Continue"
                                            : "Create Individual & Continue"}
                                </Button>
                            </div>
                        </form>
                    )}

                    {step === "ticket" && (
                        <form onSubmit={ticketForm.handleSubmit(createTicket)} className="space-y-5">
                            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                                <UserPlus size={15} />
                                <span><strong>{identity?.name}</strong> {identity?.phone && `— ${identity.phone}`}</span>
                                <Button type="button" variant="link" className="ml-auto h-auto px-0 text-xs text-emerald-700" onClick={() => setStep("phone")}>
                                    Change
                                </Button>
                            </div>

                            {identity && linkedCompanies.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Bill To</Label>
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
                                    <Label>Pipeline</Label>
                                    <div className="flex flex-wrap gap-2">
                                        {pipelines.map((p) => (
                                            <Button
                                                key={p.id}
                                                type="button"
                                                variant={selectedPipelineId === p.id ? "default" : "outline"}
                                                size="sm"
                                                onClick={() => setSelectedPipelineId(p.id)}
                                            >
                                                <span className={`h-2 w-2 rounded-full ${colorDot(p.color)}`} />
                                                {p.label}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-3 gap-3">
                                <div className="space-y-2">
                                    <Label>Device Type</Label>
                                    <Input {...ticketForm.register("deviceType")} placeholder="Laptop, Printer..." autoFocus />
                                    <FieldError message={ticketForm.formState.errors.deviceType?.message} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Brand</Label>
                                    <Input {...ticketForm.register("brand")} placeholder="HP, Dell..." />
                                    <FieldError message={ticketForm.formState.errors.brand?.message} />
                                </div>
                                <div className="space-y-2">
                                    <Label>Model</Label>
                                    <Input {...ticketForm.register("model")} placeholder="Model number" />
                                    <FieldError message={ticketForm.formState.errors.model?.message} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Problem Description</Label>
                                <Textarea {...ticketForm.register("problem")} rows={3} placeholder="Describe the issue..." />
                                <FieldError message={ticketForm.formState.errors.problem?.message} />
                            </div>

                            <div className="space-y-2">
                                <Label>Job Type</Label>
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
                                <div className="grid grid-cols-2 gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="space-y-2">
                                        <Label>Serial / Purchase Ref</Label>
                                        <Input {...ticketForm.register("warrantyRef")} placeholder="Serial or receipt ref" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Purchase Date</Label>
                                        <Input {...ticketForm.register("purchaseDate")} type="date" />
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Priority</Label>
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
                                    <Label>Primary Owner</Label>
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
                                                <SelectItem key={technician.id} value={technician.id}>
                                                    {technician.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label>Access Info</Label>
                                    <Input {...ticketForm.register("accessInfo")} placeholder="Device PIN or password" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Estimated Cost</Label>
                                    <Input {...ticketForm.register("estimatedCost")} type="number" placeholder="0.00" />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Notes</Label>
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
            </DialogContent>
        </Dialog>
    );
}
