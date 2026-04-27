"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import axios from "axios";
import { toast } from "sonner";
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
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

interface Props {
    customer?: {
        id: number;
        name: string;
        phone: string;
        email?: string;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;

    return <p className="text-xs text-destructive">{message}</p>;
}

export default function CustomerForm({ customer, onClose }: Props) {
    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({
        resolver: zodResolver(schema),
    });

    useEffect(() => {
        if (customer) {
            reset({
                name: customer.name,
                phone: customer.phone,
                email: customer.email || "",
            });
        }
    }, [customer, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            if (customer) {
                await axios.put(`/api/customers/${customer.id}`, data);
                toast.success("Customer updated");
            } else {
                await axios.post("/api/customers", data);
                toast.success("Customer added");
            }
            onClose();
        } catch {
            toast.error("Something went wrong");
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{customer ? "Edit Customer" : "Add Customer"}</DialogTitle>
                    <DialogDescription>
                        Capture the customer’s contact details for service intake and follow-up.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input {...register("name")} placeholder="Full name" />
                        <FieldError message={errors.name?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input {...register("phone")} placeholder="Phone number" />
                        <FieldError message={errors.phone?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Email</Label>
                        <Input {...register("email")} placeholder="email@example.com" />
                        <FieldError message={errors.email?.message} />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : customer ? "Update" : "Add Customer"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
