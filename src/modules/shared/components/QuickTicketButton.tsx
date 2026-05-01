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
type CompanySuggestion = {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    companyReg: string | null;
    taxId: string | null;
    account?: { id: number } | null;
};

const accountSchema = z.object({
    name: z.string().trim().min(1, "Name is required"),
    companyName: z.string().trim().optional().or(z.literal("")),
    phone: z.string().trim().min(1, "Phone is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().optional().or(z.literal("")),
    companyPhone: z.string().trim().optional().or(z.literal("")),
    companyEmail: z.string().email("Invalid email").optional().or(z.literal("")),
    companyAddress: z.string().optional().or(z.literal("")),
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
    const [companySuggestions, setCompanySuggestions] = useState<CompanySuggestion[]>([]);
    const [showCompanySuggestions, setShowCompanySuggestions] = useState(false);
    const [companyLookupLoading, setCompanyLookupLoading] = useState(false);
    const [selectedCompany, setSelectedCompany] = useState<CompanySuggestion | null>(null);

    const accountForm = useForm<AccountFormData>({
        resolver: zodResolver(accountSchema) as Resolver<AccountFormData>,
        defaultValues: { companyName: "", companyPhone: "", companyEmail: "", companyAddress: "" },
    });
    const companyName = accountForm.watch("companyName") ?? "";
    const hasCompanyInput = companyName.trim().length > 0;
    const customerPhone = accountForm.watch("phone") ?? "";
    const customerEmail = accountForm.watch("email") ?? "";
    const customerAddress = accountForm.watch("address") ?? "";
    const companyPhone = accountForm.watch("companyPhone") ?? "";
    const companyEmail = accountForm.watch("companyEmail") ?? "";
    const companyAddress = accountForm.watch("companyAddress") ?? "";

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
        setCompanySuggestions([]);
        setShowCompanySuggestions(false);
        setCompanyLookupLoading(false);
        setSelectedCompany(null);

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

    useEffect(() => {
        if (!hasCompanyInput) {
            setSelectedCompany(null);
            setCompanySuggestions([]);
            setShowCompanySuggestions(false);
            accountForm.setValue("companyPhone", "");
            accountForm.setValue("companyEmail", "");
            accountForm.setValue("companyAddress", "");
            accountForm.setValue("companyReg", "");
            accountForm.setValue("taxId", "");
            return;
        }

        if (selectedCompany && companyName.trim() !== selectedCompany.name) {
            setSelectedCompany(null);
        }
    }, [accountForm, companyName, hasCompanyInput, selectedCompany]);

    useEffect(() => {
        if (!hasCompanyInput || selectedCompany) return;

        if (!companyPhone.trim() && customerPhone.trim()) {
            accountForm.setValue("companyPhone", customerPhone, { shouldDirty: false });
        }
        if (!companyEmail.trim() && customerEmail.trim()) {
            accountForm.setValue("companyEmail", customerEmail, { shouldDirty: false });
        }
        if (!companyAddress.trim() && customerAddress.trim()) {
            accountForm.setValue("companyAddress", customerAddress, { shouldDirty: false });
        }
    }, [
        accountForm,
        companyAddress,
        companyEmail,
        companyPhone,
        customerAddress,
        customerEmail,
        customerPhone,
        hasCompanyInput,
        selectedCompany,
    ]);

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

    useEffect(() => {
        if (!open || step !== "account") return;

        const query = companyName.trim();
        if (selectedCompany && query === selectedCompany.name) {
            setCompanySuggestions([]);
            setShowCompanySuggestions(false);
            setCompanyLookupLoading(false);
            return;
        }

        if (query.length < 2) {
            setCompanySuggestions([]);
            setShowCompanySuggestions(false);
            setCompanyLookupLoading(false);
            return;
        }

        const timer = window.setTimeout(async () => {
            setCompanyLookupLoading(true);
            try {
                const res = await axios.get<CompanySuggestion[]>(`/api/companies?q=${encodeURIComponent(query)}`);
                setCompanySuggestions(res.data);
                setShowCompanySuggestions(true);
            } catch {
                setCompanySuggestions([]);
                setShowCompanySuggestions(false);
            } finally {
                setCompanyLookupLoading(false);
            }
        }, 250);

        return () => window.clearTimeout(timer);
    }, [companyName, open, selectedCompany, step]);

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
            if (data.companyName?.trim()) {
                const companyRes = selectedCompany
                    ? { data: selectedCompany }
                    : await axios.post("/api/companies", {
                        name: data.companyName,
                        phone: data.companyPhone,
                        email: data.companyEmail,
                        address: data.companyAddress,
                        companyReg: data.companyReg,
                        taxId: data.taxId,
                    });
                const company = companyRes.data as CompanySuggestion;
                const customerRes = await axios.post("/api/customers", {
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    address: data.address,
                });
                const customer = customerRes.data;

                await axios.post(`/api/companies/${company.id}/links`, {
                    customerId: customer.id,
                });

                setIdentity({
                    id: customer.id,
                    name: customer.name,
                    phone: customer.phone ?? null,
                    type: "customer",
                    accountId: customer.account?.id ?? null,
                    linkedCompanies: [
                        {
                            id: company.id,
                            name: company.name,
                            accountId: company.account?.id ?? null,
                        },
                    ],
                });
                setBillingAccountId(company.account?.id ?? null);
                setStep("ticket");
                toast.success(selectedCompany ? "Contact linked to company!" : "Customer and company created!");
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
            toast.error("Failed to create customer");
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
                <DialogHeader className="border-b border-border px-6 py-5">
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
                                        <div className="absolute top-[calc(100%+0.5rem)] right-0 left-0 z-10 overflow-hidden rounded-md border border-border bg-popover shadow">
                                            {suggestions.length > 0 ? (
                                                suggestions.map((suggestion, index) => (
                                                    <Button
                                                        key={`${suggestion.type}-${suggestion.id}`}
                                                        type="button"
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => selectIdentity(suggestion)}
                                                        className={cn(
                                                            "h-auto w-full justify-between rounded-none px-4 py-3 text-left text-sm transition-colors",
                                                            highlightedIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                                                        )}
                                                        variant="ghost"
                                                    >
                                                        <span className="truncate font-medium">
                                                            {suggestion.name} - {suggestion.phone ?? "No mobile"}
                                                        </span>
                                                        <span className="ml-3 shrink-0 text-xs uppercase text-muted-foreground">
                                                            {suggestion.type}
                                                        </span>
                                                    </Button>
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
                            <div className="border-2 border-secondary/50 bg-secondary/30 px-4 py-3 text-sm text-foreground">
                                No account found for <strong>{phone}</strong>. Fill in the customer details, and add a company only if this customer belongs to one.
                            </div>

                            <p className="text-xs font-medium text-muted-foreground">
                                Fields marked <span className="font-semibold text-destructive">*</span> are required.
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <FieldLabel required>Mobile No</FieldLabel>
                                    <Input
                                        {...accountForm.register("phone")}
                                        className={invalidFieldClass(Boolean(accountForm.formState.errors.phone))}
                                    />
                                    <FieldError message={accountForm.formState.errors.phone?.message} />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel required>Full Name</FieldLabel>
                                    <Input
                                        {...accountForm.register("name")}
                                        placeholder="Full name"
                                        className={invalidFieldClass(Boolean(accountForm.formState.errors.name))}
                                        autoFocus
                                    />
                                    <FieldError message={accountForm.formState.errors.name?.message} />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <FieldLabel>Address</FieldLabel>
                                    <Input {...accountForm.register("address")} placeholder="Street, City" />
                                </div>
                                <div className="space-y-2">
                                    <FieldLabel>Email</FieldLabel>
                                    <Input
                                        {...accountForm.register("email")}
                                        placeholder="email@example.com"
                                        className={invalidFieldClass(Boolean(accountForm.formState.errors.email))}
                                    />
                                    <FieldError message={accountForm.formState.errors.email?.message} />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <FieldLabel>Company</FieldLabel>
                                <div className="relative">
                                    <Input
                                        {...accountForm.register("companyName")}
                                        placeholder="Optional: select existing or type a new company"
                                        onFocus={() => {
                                            if (companySuggestions.length > 0) setShowCompanySuggestions(true);
                                        }}
                                        onChange={(e) => {
                                            accountForm.setValue("companyName", e.target.value, { shouldValidate: true });
                                            setShowCompanySuggestions(true);
                                        }}
                                    />
                                    {showCompanySuggestions && companySuggestions.length > 0 && (
                                        <div className="absolute top-[calc(100%+0.5rem)] right-0 left-0 z-10 overflow-hidden rounded-md border border-border bg-popover shadow">
                                            {companySuggestions.map((company) => (
                                                <Button
                                                    key={company.id}
                                                    type="button"
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => {
                                                        setSelectedCompany(company);
                                                        accountForm.setValue("companyName", company.name, { shouldValidate: true });
                                                        accountForm.setValue("companyPhone", company.phone ?? "");
                                                        accountForm.setValue("companyEmail", company.email ?? "");
                                                        accountForm.setValue("companyAddress", company.address ?? "");
                                                        accountForm.setValue("companyReg", company.companyReg ?? "");
                                                        accountForm.setValue("taxId", company.taxId ?? "");
                                                        setShowCompanySuggestions(false);
                                                    }}
                                                    variant="ghost"
                                                    className="h-auto w-full justify-between rounded-none px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
                                                >
                                                    <span className="truncate font-medium">{company.name}</span>
                                                    <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                                                        Existing company
                                                    </span>
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {selectedCompany
                                        ? "Existing company selected. The customer will be linked automatically and the ticket will bill to the company."
                                        : companyLookupLoading
                                            ? "Searching existing companies..."
                                            : "Leave blank for an individual customer only."}
                                </p>
                            </div>

                            {hasCompanyInput && (
                                <div className="space-y-4 rounded-md border border-border bg-muted p-4">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <FieldLabel>Company Phone</FieldLabel>
                                            <Input {...accountForm.register("companyPhone")} placeholder="Company phone" />
                                        </div>
                                        <div className="space-y-2">
                                            <FieldLabel>Company Email</FieldLabel>
                                            <Input
                                                {...accountForm.register("companyEmail")}
                                                placeholder="company@example.com"
                                                className={invalidFieldClass(Boolean(accountForm.formState.errors.companyEmail))}
                                            />
                                            <FieldError message={accountForm.formState.errors.companyEmail?.message} />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <FieldLabel>Company Address</FieldLabel>
                                        <Input {...accountForm.register("companyAddress")} placeholder="Company address" />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <FieldLabel>Company Reg #</FieldLabel>
                                            <Input
                                                {...accountForm.register("companyReg")}
                                                placeholder="Trade licence / Reg no."
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <FieldLabel>Tax / VAT ID</FieldLabel>
                                            <Input
                                                {...accountForm.register("taxId")}
                                                placeholder="GST / VAT number"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {hasCompanyInput && (
                                <div className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                                    {selectedCompany
                                        ? "This customer will be linked to the selected company, and the ticket will go to the company account."
                                        : "A new company will be created, linked to this customer, and used as the ticket account."}
                                </div>
                            )}

                            <div className="flex gap-3 pt-1">
                                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep("phone")}>
                                    Back
                                </Button>
                                <Button type="submit" className="flex-1" disabled={accountForm.formState.isSubmitting}>
                                    {accountForm.formState.isSubmitting
                                        ? "Creating..."
                                        : hasCompanyInput
                                            ? "Create Customer + Company & Continue"
                                            : "Create Customer & Continue"}
                                </Button>
                            </div>
                        </form>
                    )}

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
                                        <Input {...ticketForm.register("purchaseDate")} type="date" />
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
                                    <Input {...ticketForm.register("estimatedCost")} type="number" placeholder="0.00" />
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
            </DialogContent>
        </Dialog>
    );
}
