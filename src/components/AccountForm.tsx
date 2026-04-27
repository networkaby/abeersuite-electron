"use client";

import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
import { User, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function FieldError({ message }: { message?: string }) {
    if (!message) return null;

    return <p className="text-xs text-destructive">{message}</p>;
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
                const response = await axios.put(`/api/accounts/${account.id}`, data);
                toast.success("Account updated");
                onClose(response.data);
            } else {
                const response = await axios.post("/api/accounts", data);
                toast.success(data.type === "company" ? "Company created" : "Account created");
                onClose(response.data);
            }
        } catch {
            toast.error("Something went wrong");
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{account ? "Edit Account" : "New Account"}</DialogTitle>
                    <DialogDescription>
                        Create or update the billing identity used across customers, companies, and tickets.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    {!account && (
                        <div className="space-y-2">
                            <Label>Account Type</Label>
                            <div className="grid grid-cols-2 gap-2">
                                <Button
                                    type="button"
                                    variant={type === "individual" ? "default" : "outline"}
                                    className="justify-center"
                                    onClick={() => setValue("type", "individual")}
                                >
                                    <User size={15} /> Individual
                                </Button>
                                <Button
                                    type="button"
                                    variant={type === "company" ? "default" : "outline"}
                                    className="justify-center"
                                    onClick={() => setValue("type", "company")}
                                >
                                    <Building2 size={15} /> Company
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <Label>{type === "company" ? "Company Name" : "Full Name"}</Label>
                        <Input
                            {...register("name")}
                            placeholder={type === "company" ? "ABC Pvt Ltd" : "Full name"}
                        />
                        <FieldError message={errors.name?.message} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label>Phone</Label>
                            <Input {...register("phone")} placeholder="+880..." />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input {...register("email")} placeholder="email@example.com" />
                            <FieldError message={errors.email?.message} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Address</Label>
                        <Input {...register("address")} placeholder="Street, City" />
                    </div>

                    {type === "company" && (
                        <div className="grid grid-cols-2 gap-3 border-2 border-border bg-muted p-4">
                            <div className="space-y-2">
                                <Label>Company Reg #</Label>
                                <Input {...register("companyReg")} placeholder="Trade licence / Reg no." />
                            </div>
                            <div className="space-y-2">
                                <Label>Tax / VAT ID</Label>
                                <Input {...register("taxId")} placeholder="GST / VAT number" />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onClose()}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : account ? "Update" : type === "company" ? "Create Company" : "Create Account"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
