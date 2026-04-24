"use client";

import { useState } from "react";
import { Plus, Search, UserPlus, ArrowRight, ShieldCheck, Wrench } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuickTicketStore, type Step } from "@/store/quickTicketStore";
import { useReferenceStore } from "@/store/referenceStore";

type Priority = { id: string; label: string };
type PipelineOption = { id: string; label: string; color: string; isDefault: boolean };

const customerSchema = z.object({
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

type CustomerFormData = z.infer<typeof customerSchema>;
type TicketFormData = z.infer<typeof ticketSchema>;

export default function QuickTicketButton() {
    const router = useRouter();
    const { data: session } = useSession();
    const { open, step, phone, customer, setOpen, setStep, setPhone, setCustomer, reset } = useQuickTicketStore();
    const { technicians, fetchTechnicians } = useReferenceStore();
    const [searching, setSearching] = useState(false);
    const [priorities, setPriorities] = useState<Priority[]>([]);
    const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
    const [selectedPipelineId, setSelectedPipelineId] = useState<string>("P1");
    const [isWarranty, setIsWarranty] = useState(false);

    const customerForm = useForm<CustomerFormData>({
        resolver: zodResolver(customerSchema) as Resolver<CustomerFormData>,
    });

    const ticketForm = useForm<TicketFormData>({
        resolver: zodResolver(ticketSchema) as Resolver<TicketFormData>,
        defaultValues: { priority: "P2" },
    });

    const openModal = async () => {
        reset();
        setOpen(true);
        setIsWarranty(false);
        customerForm.reset();
        ticketForm.reset({ priority: "P2" });
        await fetchTechnicians();
        const [prioRes, pipeRes] = await Promise.all([
            priorities.length === 0 ? axios.get<Priority[]>("/api/priorities") : Promise.resolve(null),
            pipelines.length === 0 ? axios.get<PipelineOption[]>("/api/pipelines") : Promise.resolve(null),
        ]);
        if (prioRes) setPriorities(prioRes.data);
        if (pipeRes) {
            setPipelines(pipeRes.data);
            const def = pipeRes.data.find((p: PipelineOption) => p.isDefault);
            if (def) setSelectedPipelineId(def.id);
        }
    };

    const closeModal = () => {
        reset();
    };

    const searchByPhone = async () => {
        if (!phone.trim()) return;
        setSearching(true);
        try {
            const res = await axios.get(`/api/customers?phone=${phone.trim()}`);
            if (res.data && res.data.length > 0) {
                setCustomer(res.data[0]);
                setStep("ticket");
                toast.success(`Customer found: ${res.data[0].name}`);
            } else {
                customerForm.setValue("phone", phone.trim());
                setStep("customer");
            }
        } catch {
            customerForm.setValue("phone", phone.trim());
            setStep("customer");
        } finally {
            setSearching(false);
        }
    };

    const createCustomer = async (data: CustomerFormData) => {
        try {
            const res = await axios.post("/api/customers", data);
            setCustomer(res.data);
            setStep("ticket");
            toast.success("Customer created!");
        } catch {
            toast.error("Failed to create customer");
        }
    };

    const createTicket = async (data: TicketFormData) => {
        if (!customer) {
            toast.error("Customer is required");
            return;
        }

        try {
            const res = await axios.post("/api/tickets", {
                ...data,
                isWarranty,
                customerId: customer.id,
                createdBy: session?.user?.id,
                pipelineId: selectedPipelineId,
            });
            toast.success(`Ticket #${res.data.id} created!`);
            closeModal();
            // Open receipt in new tab immediately
            window.open(`/receipt/${res.data.id}`, "_blank");
            // Also navigate to ticket detail
            router.push(`/tickets/${res.data.id}`);
        } catch {
            toast.error("Failed to create ticket");
        }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={openModal}
                className="fixed bottom-8 right-8 bg-blue-600 text-white rounded-full shadow-lg px-5 py-3 flex items-center gap-2 hover:bg-blue-700 transition-all z-40 text-sm font-medium"
            >
                <Plus size={18} />
                New Ticket
            </button>

            {/* Modal */}
            {open && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b shrink-0">
                            <div>
                                <h2 className="text-lg font-semibold">New Ticket</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    {(["phone", "customer", "ticket"] as Step[]).map((s, i) => (
                                        <div key={s} className="flex items-center gap-1">
                                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${step === s
                                                ? "bg-blue-600 text-white"
                                                : (["phone", "customer", "ticket"] as Step[]).indexOf(step) > i
                                                    ? "bg-green-500 text-white"
                                                    : "bg-gray-200 text-gray-500"
                                                }`}>
                                                {i + 1}
                                            </div>
                                            <span className="text-xs text-gray-500 capitalize">
                                                {s === "phone" ? "Search" : s}
                                            </span>
                                            {i < 2 && <ArrowRight size={10} className="text-gray-300" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                        </div>

                        {/* Body — scrollable */}
                        <div className="p-5 overflow-y-auto flex-1">

                            {/* Step 1: Phone Search */}
                            {step === "phone" && (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500">Search customer by phone number to get started.</p>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                            <input
                                                type="text"
                                                value={phone}
                                                onChange={(e) => setPhone(e.target.value)}
                                                onKeyDown={(e) => e.key === "Enter" && searchByPhone()}
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
                                    <p className="text-xs text-gray-400">
                                        If not found, you&apos;ll be prompted to create a new customer.
                                    </p>
                                </div>
                            )}

                            {/* Step 2: Create Customer */}
                            {step === "customer" && (
                                <form onSubmit={customerForm.handleSubmit(createCustomer)} className="space-y-4">
                                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700">
                                        No customer found for <strong>{phone}</strong>. Fill in details to create one.
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Name</label>
                                        <input
                                            {...customerForm.register("name")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Full name"
                                            autoFocus
                                        />
                                        {customerForm.formState.errors.name && (
                                            <p className="text-red-500 text-xs mt-1">{customerForm.formState.errors.name.message}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Phone</label>
                                        <input
                                            {...customerForm.register("phone")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        {customerForm.formState.errors.phone && (
                                            <p className="text-red-500 text-xs mt-1">{customerForm.formState.errors.phone.message}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            Email <span className="text-gray-400">(optional)</span>
                                        </label>
                                        <input
                                            {...customerForm.register("email")}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="email@example.com"
                                        />
                                    </div>
                                    <div className="flex gap-3 pt-1">
                                        <button
                                            type="button"
                                            onClick={() => setStep("phone")}
                                            className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                                        >
                                            Back
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={customerForm.formState.isSubmitting}
                                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                                        >
                                            {customerForm.formState.isSubmitting ? "Creating..." : "Create & Continue →"}
                                        </button>
                                    </div>
                                </form>
                            )}

                            {/* Step 3: Full Ticket Form */}
                            {step === "ticket" && (
                                <form onSubmit={ticketForm.handleSubmit(createTicket)} className="space-y-4">
                                    {/* Customer Badge */}
                                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
                                        <UserPlus size={15} />
                                        <span><strong>{customer?.name}</strong> — {customer?.phone}</span>
                                        <button
                                            type="button"
                                            onClick={() => setStep("phone")}
                                            className="ml-auto text-xs text-green-600 underline hover:text-green-800"
                                        >
                                            Change
                                        </button>
                                    </div>

                                    {/* Pipeline selector */}
                                    {pipelines.length > 1 && (
                                        <div>
                                            <label className="block text-sm font-medium mb-2">Pipeline</label>
                                            <div className="flex gap-2 flex-wrap">
                                                {pipelines.filter((p) => p.isDefault || p.id !== "P1").map((p) => (
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
                                            <input
                                                {...ticketForm.register("deviceType")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="Laptop, Printer..."
                                                autoFocus
                                            />
                                            {ticketForm.formState.errors.deviceType && (
                                                <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.deviceType.message}</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Brand</label>
                                            <input
                                                {...ticketForm.register("brand")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="HP, Dell..."
                                            />
                                            {ticketForm.formState.errors.brand && (
                                                <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.brand.message}</p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Model</label>
                                            <input
                                                {...ticketForm.register("model")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="Model number"
                                            />
                                            {ticketForm.formState.errors.model && (
                                                <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.model.message}</p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Problem */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Problem Description</label>
                                        <textarea
                                            {...ticketForm.register("problem")}
                                            rows={3}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Describe the issue..."
                                        />
                                        {ticketForm.formState.errors.problem && (
                                            <p className="text-red-500 text-xs mt-1">{ticketForm.formState.errors.problem.message}</p>
                                        )}
                                    </div>

                                    {/* Job Type — Warranty Toggle */}
                                    <div>
                                        <label className="block text-sm font-medium mb-2">Job Type</label>
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => { setIsWarranty(false); ticketForm.setValue("warrantyRef", ""); ticketForm.setValue("purchaseDate", ""); }}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                                    !isWarranty
                                                        ? "bg-blue-600 border-blue-600 text-white"
                                                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                                }`}
                                            >
                                                <Wrench size={14} />
                                                Paid Repair
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsWarranty(true)}
                                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                                    isWarranty
                                                        ? "bg-amber-500 border-amber-500 text-white"
                                                        : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                                }`}
                                            >
                                                <ShieldCheck size={14} />
                                                Warranty Claim
                                            </button>
                                        </div>
                                    </div>

                                    {/* Warranty Details */}
                                    {isWarranty && (
                                        <div className="grid grid-cols-2 gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                            <div>
                                                <label className="block text-sm font-medium mb-1">Serial / Purchase Ref <span className="text-gray-400">(optional)</span></label>
                                                <input
                                                    {...ticketForm.register("warrantyRef")}
                                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                                    placeholder="Serial number or receipt ref"
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-1">Purchase Date <span className="text-gray-400">(optional)</span></label>
                                                <input
                                                    {...ticketForm.register("purchaseDate")}
                                                    type="date"
                                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Priority + Technician */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">Priority</label>
                                            <select
                                                {...ticketForm.register("priority")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                {priorities.map((p) => (
                                                    <option key={p.id} value={p.id}>{p.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">
                                                Primary Owner <span className="text-gray-400">(optional)</span>
                                            </label>
                                            <select
                                                {...ticketForm.register("primaryOwnerId")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            >
                                                <option value="">Unassigned</option>
                                                {technicians.map((t) => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Access Info + Estimated Cost */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium mb-1">
                                                Access Info <span className="text-gray-400">(PIN/Password)</span>
                                            </label>
                                            <input
                                                {...ticketForm.register("accessInfo")}
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="Device PIN or password"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1">
                                                Estimated Cost <span className="text-gray-400">(optional)</span>
                                            </label>
                                            <input
                                                {...ticketForm.register("estimatedCost")}
                                                type="number"
                                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div>
                                        <label className="block text-sm font-medium mb-1">
                                            Notes <span className="text-gray-400">(optional)</span>
                                        </label>
                                        <textarea
                                            {...ticketForm.register("notes")}
                                            rows={2}
                                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                            placeholder="Internal notes..."
                                        />
                                    </div>

                                    <div className="flex gap-3 pt-1">
                                        <button
                                            type="button"
                                            onClick={closeModal}
                                            className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={ticketForm.formState.isSubmitting}
                                            className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm hover:bg-blue-700 disabled:opacity-50"
                                        >
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