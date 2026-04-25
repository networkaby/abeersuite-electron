"use client";

import { useState, useEffect } from "react";
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

type Priority = { id: string; label: string };
type PipelineOption = { id: string; label: string; color: string; isDefault: boolean };
type LinkedCompany = { id: number; name: string; accountId: number | null };

const accountSchema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
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

export default function QuickTicketButton() {
    const router = useRouter();
    const { data: session } = useSession();
    const {
        open, step, phone, identity, billingAccountId,
        initialPipelineId,
        setOpen: _setOpen, setStep, setPhone, setIdentity, setBillingAccountId,
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

    const accountForm = useForm<AccountFormData>({
        resolver: zodResolver(accountSchema) as Resolver<AccountFormData>,
    });

    const ticketForm = useForm<TicketFormData>({
        resolver: zodResolver(ticketSchema) as Resolver<TicketFormData>,
        defaultValues: { priority: "P2" },
    });

    useEffect(() => {
        if (!open) return;
        setIsWarranty(false);
        accountForm.reset();
        ticketForm.reset({ priority: "P2" });
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
                    const def = fetched.find(p => p.isDefault) ?? fetched[0];
                    if (def) setSelectedPipelineId(def.id);
                }
            } else if (!pendingPipelineId) {
                const def = pipelines.find(p => p.isDefault) ?? pipelines[0];
                if (def) setSelectedPipelineId(def.id);
            }
        };
        load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // When identity is found, set billing defaults and linked companies
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

    const searchByPhone = async () => {
        if (!phone.trim()) return;
        setSearching(true);
        try {
            const res = await axios.get(`/api/customers?phone=${phone.trim()}`);
            if (res.data && res.data.length > 0) {
                const found = res.data[0] as BasicIdentity;
                setIdentity(found);
                setStep("ticket");
                toast.success(`Found: ${found.name}`);
            } else {
                accountForm.setValue("phone", phone.trim());
                setStep("account");
            }
        } catch {
            accountForm.setValue("phone", phone.trim());
            setStep("account");
        } finally {
            setSearching(false);
        }
    };

    const createAccount = async (data: AccountFormData) => {
        try {
            const res = await axios.post("/api/customers", data);
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
        if (!identity) { toast.error("Customer or company is required"); return; }
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
        <>
            {open && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b shrink-0">
                            <div>
                                <h2 className="text-lg font-semibold">New Ticket</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    {stepLabels.map((s, i) => (
                                        <div key={s.key} className="flex items-center gap-1">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                                                step === s.key
                                                    ? "bg-blue-600 text-white"
                                                    : stepLabels.findIndex(x => x.key === step) > i
                                                        ? "bg-green-500 text-white"
                                                        : "bg-gray-200 text-gray-500"
                                            }`}>
                                                {i + 1}
                                            </div>
                                            <span className="text-xs text-gray-500">{s.label}</span>
                                            {i < stepLabels.length - 1 && <ArrowRight size={10} className="text-gray-300" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                        </div>

                        <div className="p-5 overflow-y-auto flex-1">

                            {/* Step 1: Phone Search */}
                            {step === "phone" && (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500">Search account by phone number to get started.</p>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                value={phone}
                                                onChange={e => setPhone(e.target.value)}
                                                onKeyDown={e => e.key === "Enter" && searchByPhone()}
                                                placeholder="Enter phone number..."
                                                className="w-full pl-9 pr-4 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                autoFocus
                                            />
                                        </div>
                                        <button
                                            onClick={searchByPhone}
                                            disabled={searching || !phone.trim()}
                                            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {searching ? "Searching..." : "Search"}
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-400">If not found, you&apos;ll create a new account.</p>
                                </div>
                            )}

                            {/* Step 2: Create Account */}
                            {step === "account" && (
                                <form onSubmit={accountForm.handleSubmit(createAccount)} className="space-y-4">
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
                                        No account found for <strong>{phone}</strong>. Fill in details to create one.
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Name</label>
                                        <input
                                            {...accountForm.register("name")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Full name"
                                            autoFocus
                                        />
                                        {accountForm.formState.errors.name && (
                                            <p className="text-red-500 text-xs mt-1">{accountForm.formState.errors.name.message}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Phone</label>
                                        <input
                                            {...accountForm.register("phone")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        {accountForm.formState.errors.phone && (
                                            <p className="text-red-500 text-xs mt-1">{accountForm.formState.errors.phone.message}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Email <span className="text-gray-400">(optional)</span></label>
                                        <input
                                            {...accountForm.register("email")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="email@example.com"
                                        />
                                    </div>
                                    <div className="flex gap-3 pt-1">
                                        <button type="button" onClick={() => setStep("phone")} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Back</button>
                                        <button type="submit" disabled={accountForm.formState.isSubmitting} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
                                            {accountForm.formState.isSubmitting ? "Creating..." : "Create & Continue →"}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {/* Step 3: Ticket Form */}
                            {step === "ticket" && (
                                <form onSubmit={ticketForm.handleSubmit(createTicket)} className="space-y-4">

                                    {/* Identity badge */}
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
                                        <UserPlus size={15} />
                                        <span><strong>{identity?.name}</strong> {identity?.phone && `— ${identity.phone}`}</span>
                                        <button type="button" onClick={() => setStep("phone")} className="ml-auto text-xs text-green-600 underline hover:text-green-800">Change</button>
                                    </div>

                                    {/* Billing Account selector — shown only when customer has linked companies */}
                                    {identity && linkedCompanies.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-medium mb-1.5">Bill To <span className="text-gray-400 font-normal">(select account)</span></label>
                                            <div className="space-y-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setBillingAccountId(identity.accountId)}
                                                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                                                        billingAccountId === identity.accountId
                                                            ? "border-blue-500 bg-blue-50 text-blue-700"
                                                            : "border-gray-200 hover:border-gray-300"
                                                    }`}
                                                >
                                                    <User size={14} className="shrink-0" />
                                                    <span>{identity.name} <span className="text-xs text-gray-400">(personal)</span></span>
                                                </button>
                                                {linkedCompanies.map(lc => (
                                                    <button
                                                        key={lc.id}
                                                        type="button"
                                                        onClick={() => setBillingAccountId(lc.accountId)}
                                                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                                                            billingAccountId === lc.accountId
                                                                ? "border-purple-500 bg-purple-50 text-purple-700"
                                                                : "border-gray-200 hover:border-gray-300"
                                                        }`}
                                                    >
                                                        <Building2 size={14} className="shrink-0" />
                                                        <span>{lc.name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Pipeline selector */}
                                    {pipelines.length > 1 && (
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Pipeline</label>
                                            <div className="flex gap-2 flex-wrap">
                                                {pipelines.map(p => (
                                                    <button
                                                        key={p.id}
                                                        type="button"
                                                        onClick={() => setSelectedPipelineId(p.id)}
                                                        className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                                                            selectedPipelineId === p.id
                                                                ? "bg-blue-600 text-white border-blue-600"
                                                                : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                                        }`}
                                                    >
                                                        <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${p.color.split(" ")[0]}`} />
                                                        {p.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Device Info */}
                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Device Type</label>
                                            <input {...ticketForm.register("deviceType")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Laptop, Printer..." autoFocus />
                                            {ticketForm.formState.errors.deviceType && <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.deviceType.message}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Brand</label>
                                            <input {...ticketForm.register("brand")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="HP, Dell..." />
                                            {ticketForm.formState.errors.brand && <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.brand.message}</p>}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Model</label>
                                            <input {...ticketForm.register("model")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Model number" />
                                            {ticketForm.formState.errors.model && <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.model.message}</p>}
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-1">Problem Description</label>
                                        <textarea {...ticketForm.register("problem")} rows={3} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Describe the issue..." />
                                        {ticketForm.formState.errors.problem && <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.problem.message}</p>}
                                    </div>

                                    {/* Job Type */}
                                    <div>
                                        <label className="block text-sm font-medium mb-2">Job Type</label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => { setIsWarranty(false); ticketForm.setValue("warrantyRef", ""); ticketForm.setValue("purchaseDate", ""); }}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${!isWarranty ? "bg-blue-600 border-blue-600 text-white" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                                                <Wrench size={14} /> Paid Repair
                                            </button>
                                            <button type="button" onClick={() => setIsWarranty(true)}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${isWarranty ? "bg-amber-500 border-amber-500 text-white" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                                                <ShieldCheck size={14} /> Warranty Claim
                                            </button>
                                        </div>
                                    </div>

                                    {isWarranty && (
                                        <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                            <div>
                                                <label className="block text-sm font-medium mb-1">Serial / Purchase Ref <span className="text-gray-400">(optional)</span></label>
                                                <input {...ticketForm.register("warrantyRef")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" placeholder="Serial or receipt ref" />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-1">Purchase Date <span className="text-gray-400">(optional)</span></label>
                                                <input {...ticketForm.register("purchaseDate")} type="date" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Priority</label>
                                            <select {...ticketForm.register("priority")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                {priorities.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Primary Owner <span className="text-gray-400">(optional)</span></label>
                                            <select {...ticketForm.register("primaryOwnerId")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                <option value="">Unassigned</option>
                                                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Access Info <span className="text-gray-400">(PIN/Password)</span></label>
                                            <input {...ticketForm.register("accessInfo")} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Device PIN or password" />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Estimated Cost <span className="text-gray-400">(optional)</span></label>
                                            <input {...ticketForm.register("estimatedCost")} type="number" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="0.00" />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-1">Notes <span className="text-gray-400">(optional)</span></label>
                                        <textarea {...ticketForm.register("notes")} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Internal notes..." />
                                    </div>

                                    <div className="flex gap-3 pt-1">
                                        <button type="button" onClick={closeModal} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">Cancel</button>
                                        <button type="submit" disabled={ticketForm.formState.isSubmitting} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50">
                                            {ticketForm.formState.isSubmitting ? "Creating..." : "Create Ticket"}
                                        </button>
                                    </div>
                                </form>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
