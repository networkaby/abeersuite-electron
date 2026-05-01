"use client";

import { useForm } from "react-hook-form";
import axios from "axios";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface NextStatus { id: string; label: string; }

interface Props {
    ticket: {
        id: number;
        status: string;
        ticketStatus: {
            label: string;
            fromTransitions: { to: NextStatus }[];
        };
    };
    onClose: () => void;
}

type StatusUpdateFormData = { status: string; logNote: string };

export default function TicketStatusUpdate({ ticket, onClose }: Props) {
    const { data: session } = useSession();
    const nextStatuses: NextStatus[] = ticket.ticketStatus.fromTransitions.map((t) => t.to);

    const { register, handleSubmit, watch, setValue, formState: { isSubmitting } } = useForm({
        defaultValues: {
            status: nextStatuses[0]?.id || ticket.status,
            logNote: "",
        },
    });

    // eslint-disable-next-line react-hooks/incompatible-library
    const selectedStatus = watch("status");

    const onSubmit = async (data: StatusUpdateFormData) => {
        try {
            await axios.put(`/api/tickets/${ticket.id}`, {
                ...data,
                changedBy: session?.user?.id,
            });
            toast.success("Status updated");
            onClose();
        } catch {
            toast.error("Failed to update status");
        }
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Update Status</DialogTitle>
                    <DialogDescription>
                        Current: <span className="font-medium text-foreground">{ticket.ticketStatus.label}</span>
                    </DialogDescription>
                </DialogHeader>

                {nextStatuses.length === 0 ? (
                    <p className="text-muted-foreground text-sm py-4">No further status updates available.</p>
                ) : (
                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                        {ticket.status === "S7" && (
                            <div className="rounded-md border border-primary bg-primary/10 p-3 text-sm text-primary">
                                ↩ This will <strong>reopen</strong> the ticket and start a new repair cycle.
                            </div>
                        )}

                        <div className="space-y-1.5">
                            {nextStatuses.map((s) => (
                                <Button
                                    key={s.id}
                                    type="button"
                                    variant="outline"
                                    onClick={() => setValue("status", s.id)}
                                    className={`h-auto w-full justify-start rounded-md px-3 py-2.5 text-left ${
                                        selectedStatus === s.id ? "border-primary bg-primary/10 hover:bg-primary/10" : ""
                                    }`}
                                >
                                    <span className="text-sm text-foreground">{s.label}</span>
                                </Button>
                            ))}
                        </div>

                        <div className="space-y-2">
                            <Label>Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
                            <Textarea
                                {...register("logNote")}
                                rows={3}
                                placeholder={ticket.status === "S7" ? "Why is this being reopened?" : "Add a note about this status change..."}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting ? "Saving..." : ticket.status === "S7" ? "↩ Reopen Ticket" : "Update Status"}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
