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
import { Textarea } from "@/components/ui/textarea";

const schema = z.object({
    name: z.string().min(1, "Name is required"),
    phone: z.string().min(1, "Phone is required"),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    address: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Props {
    serviceCenter?: {
        id: number;
        name: string;
        phone: string;
        email?: string;
        address?: string;
    };
    onClose: () => void;
}

function FieldError({ message }: { message?: string }) {
    if (!message) return null;
    return <p className="text-xs text-destructive">{message}</p>;
}

export default function ServiceCenterForm({ serviceCenter, onClose }: Props) {
    const {
        register,
        handleSubmit,
        reset,
        formState: { errors, isSubmitting },
    } = useForm<FormData>({ resolver: zodResolver(schema) });

    useEffect(() => {
        if (serviceCenter) {
            reset({
                name: serviceCenter.name,
                phone: serviceCenter.phone,
                email: serviceCenter.email || "",
                address: serviceCenter.address || "",
            });
        }
    }, [serviceCenter, reset]);

    const onSubmit = async (data: FormData) => {
        try {
            if (serviceCenter) {
                await axios.put(`/api/service-centers/${serviceCenter.id}`, data);
                toast.success("Service center updated");
            } else {
                await axios.post("/api/service-centers", data);
                toast.success("Service center added");
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
                    <DialogTitle>{serviceCenter ? "Edit Service Center" : "Add Service Center"}</DialogTitle>
                    <DialogDescription>
                        External repair facility for escalated tickets.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div className="space-y-2">
                        <Label>Name</Label>
                        <Input {...register("name")} placeholder="Service center name" />
                        <FieldError message={errors.name?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Phone</Label>
                        <Input {...register("phone")} placeholder="Phone number" />
                        <FieldError message={errors.phone?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Input {...register("email")} placeholder="email@example.com" />
                        <FieldError message={errors.email?.message} />
                    </div>

                    <div className="space-y-2">
                        <Label>Address <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea {...register("address")} rows={2} placeholder="Full address" />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Saving..." : serviceCenter ? "Update" : "Add"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
