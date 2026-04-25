"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
import { X, User, Building2 } from "lucide-react";

const schema = z.object({
    type: z.enum(["individual", "company"]),
    name: z.string().min(1, "Name is required"),
    phone: z.string().optional().or(z.literal("")),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().optional().or(z.literal("")),
    companyReg: z.string().optional().or(z.literal("")),
    taxId: z.string().optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface Props {
    account?: {
        id: number;
        type: string;
        name: string;
        phone?: string | null;
        email?: string | null;
        address?: string | null;
        companyReg?: string | null;
        taxId?: string | null;
    };
    defaultType?: "individual" | "company";
    onClose: (created?: { id: number; name: string; type: string }) => void;
}

export default function AccountForm({ account, defaultType = "individual", onClose }: Props) {
    const {
        register,
        handleSubmit,
        control,
        reset,
        setValue,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
        defaultValues: { type: defaultType },
    });

    const type = useWatch({ control, name: "type" });

    useEffect(() => {
        if (account) {
            reset({
                type: account.type as "individual" | "company",
                name: account.name,
                phone: account.phone ?? "",
                email: account.email ?? "",
                address: account.address ?? "",
                companyReg: account.companyReg ?? "",
                taxId: account.taxId ?? "",
            });
        }
    }, [account, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            if (account) {
                const res = await axios.put(`/api/accounts/${account.id}`, data);
                toast.success("Account updated");
                onClose(res.data);
            } else {
                const res = await axios.post("/api/accounts", data);
                toast.success(data.type === "company" ? "Company created" : "Account created");
                onClose(res.data);
            }
        } catch {
            toast.error("Something went wrong");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-5">
                    <h2 className="text-lg font-semibold">
                        {account ? "Edit Account" : "New Account"}
                    </h2>
                    <button onClick={() => onClose()} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {/* Type toggle */}
                    {!account && (
                        <div>
                            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Account Type</label>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setValue("type", "individual")}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                                        type === "individual"
                                            ? "bg-blue-600 text-white border-blue-600"
                                            : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                    }`}
                                >
                                    <User size={15} /> Individual
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setValue("type", "company")}
                                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                                        type === "company"
                                            ? "bg-purple-600 text-white border-purple-600"
                                            : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                    }`}
                                >
                                    <Building2 size={15} /> Company
                                </button>
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-1">
                            {type === "company" ? "Company Name" : "Full Name"}
                        </label>
                        <input
                            {...register("name")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder={type === "company" ? "ABC Pvt Ltd" : "Full name"}
                        />
                        {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium mb-1">Phone <span className="text-gray-400">(optional)</span></label>
                            <input
                                {...register("phone")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="+880..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Email <span className="text-gray-400">(optional)</span></label>
                            <input
                                {...register("email")}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="email@example.com"
                            />
                            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Address <span className="text-gray-400">(optional)</span></label>
                        <input
                            {...register("address")}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Street, City"
                        />
                    </div>

                    {type === "company" && (
                        <div className="grid grid-cols-2 gap-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
                            <div>
                                <label className="block text-sm font-medium mb-1">Company Reg # <span className="text-gray-400">(optional)</span></label>
                                <input
                                    {...register("companyReg")}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                                    placeholder="Trade licence / Reg no."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Tax / VAT ID <span className="text-gray-400">(optional)</span></label>
                                <input
                                    {...register("taxId")}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                                    placeholder="GST / VAT number"
                                />
                            </div>
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => onClose()}
                            className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className={`flex-1 text-white rounded-lg py-2 text-sm disabled:opacity-50 ${
                                type === "company" ? "bg-purple-600 hover:bg-purple-700" : "bg-blue-600 hover:bg-blue-700"
                            }`}
                        >
                            {isSubmitting ? "Saving..." : account ? "Update" : type === "company" ? "Create Company" : "Create Account"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
