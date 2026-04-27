"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props { ticketId: number; }

export default function TicketReopenButton({ ticketId }: Props) {
    const { data: session } = useSession();
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState("");
    const [loading, setLoading] = useState(false);

    const handleReopen = async () => {
        setLoading(true);
        try {
            const res = await axios.post(`/api/tickets/${ticketId}/reopen`, {
                reason,
                userId: session?.user?.id,
            });
            toast.success(`New Ticket #${res.data.id} created!`);
            setOpen(false);
            window.open(`/receipt/${res.data.id}`, "_blank");
            router.push(`/tickets/${res.data.id}`);
        } catch {
            toast.error("Failed to reopen ticket");
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setOpen(true)}
            >
                <RotateCcw size={15} />
                Reopen / Same Problem
            </Button>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Reopen Ticket</DialogTitle>
                        <DialogDescription>
                            This will create a <strong>new ticket</strong> for the same device, linked to this ticket&apos;s history.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="border-2 border-primary bg-primary/10 p-3 text-sm text-primary">
                        A new ticket will be opened and linked to this one.
                    </div>

                    <div className="space-y-2">
                        <Label>Reason <span className="text-muted-foreground font-normal">(optional)</span></Label>
                        <Textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="e.g. Problem still exists after repair..."
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="button" onClick={handleReopen} disabled={loading}>
                            {loading ? "Creating..." : "Create New Ticket"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
