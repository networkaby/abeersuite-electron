"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { BadgeCheck, KeyRound, Mail, Phone, Plus, ShieldAlert, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { extractApiError } from "@/shared/lib/api";
import PortalOtpLoginForm from "@/modules/external/portal/PortalOtpLoginForm";
import type { PortalContact, PortalProfile } from "@/shared/lib/portal/portalProfileTypes";
import { usePortalAccountStore } from "@/store/external/portalAccountStore";

/**
 * Mobiles & emails — one list, every row with its badges, and the actions the
 * rules allow:
 *   Add     → saved unverified (the shop can still find you by it).
 *   Verify  → OTP to that contact; once proved it can be primary / sign in.
 *             A contact on an older shop profile merges that profile in.
 *   Primary → verified rows only.
 *   Remove  → not the login contact, not the last verified one.
 * Every mutation route returns the whole profile, so one `setProfile` keeps
 * the page in step.
 */

type Kind = "phone" | "email";

function ContactRow({
    kind,
    contact,
    busy,
    onVerify,
    onPrimary,
    onRemove,
}: {
    kind: Kind;
    contact: PortalContact;
    busy: boolean;
    onVerify: () => void;
    onPrimary: () => void;
    onRemove: () => void;
}) {
    const Icon = kind === "phone" ? Phone : Mail;
    return (
        <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{contact.value}</span>
            <span className="flex flex-wrap items-center gap-1.5">
                {contact.isPrimary ? (
                    <Badge variant="secondary" className="gap-1"><Star className="size-3 fill-current text-amber-500" /> Primary</Badge>
                ) : null}
                {contact.verified ? (
                    <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"><BadgeCheck className="size-3" /> Verified</Badge>
                ) : (
                    <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-400"><ShieldAlert className="size-3" /> Not verified</Badge>
                )}
                {contact.isLogin ? (
                    <Badge variant="outline" className="gap-1"><KeyRound className="size-3" /> Login</Badge>
                ) : null}
            </span>
            <span className="flex items-center gap-1">
                {!contact.verified ? (
                    <Button size="xs" variant="outline" disabled={busy} onClick={onVerify}>Verify</Button>
                ) : null}
                {contact.verified && !contact.isPrimary ? (
                    <Button size="xs" variant="ghost" disabled={busy} onClick={onPrimary}>Make primary</Button>
                ) : null}
                {!contact.isLogin ? (
                    <Button size="icon-xs" variant="ghost" aria-label="Remove" className="text-muted-foreground hover:text-destructive" disabled={busy} onClick={onRemove}>
                        <Trash2 className="size-3.5" />
                    </Button>
                ) : null}
            </span>
        </li>
    );
}

export default function ProfileContactsCard({ profile }: { profile: PortalProfile }) {
    const setProfile = usePortalAccountStore((s) => s.setProfile);
    const [busy, setBusy] = useState(false);
    const [adding, setAdding] = useState(false);
    const [newValue, setNewValue] = useState("");
    /** The contact being OTP-verified — null when the dialog is closed. */
    const [verifying, setVerifying] = useState<string | null>(null);
    const [removing, setRemoving] = useState<{ kind: Kind; contact: PortalContact } | null>(null);

    async function run(action: () => Promise<{ data: PortalProfile }>, ok: string) {
        setBusy(true);
        try {
            const res = await action();
            setProfile(res.data);
            toast.success(ok);
            return true;
        } catch (e) {
            // The contact sits on an older shop profile: proving it by OTP
            // links that profile here, so go straight to the code.
            if (axios.isAxiosError(e) && e.response?.data?.code === "VERIFY_TO_MERGE") {
                toast.info(extractApiError(e, "Verify this contact to link it"));
                setVerifying(newValue.trim());
                return false;
            }
            toast.error(extractApiError(e, "Something went wrong"));
            return false;
        } finally {
            setBusy(false);
        }
    }

    async function addPlain() {
        const value = newValue.trim();
        if (!value) return;
        const ok = await run(() => axios.post("/api/portal/me/contacts", { value }), "Contact added — verify it when you like");
        if (ok) { setNewValue(""); setAdding(false); }
    }

    /** Add + verify in one go: the OTP form sends the code, we save on the ticket. */
    async function onVerified(token: string) {
        const ok = await run(() => axios.post("/api/portal/me/contacts", { token }), "Verified");
        if (ok) { setVerifying(null); setAdding(false); setNewValue(""); }
    }

    const makePrimary = (kind: Kind, c: PortalContact) =>
        run(() => axios.patch(`/api/portal/me/contacts/${kind}/${c.id}`, { isPrimary: true }), `${c.value} is now primary`);

    const remove = async () => {
        if (!removing) return;
        const { kind, contact } = removing;
        const ok = await run(() => axios.delete(`/api/portal/me/contacts/${kind}/${contact.id}`), "Removed");
        if (ok) setRemoving(null);
    };

    const empty = profile.phones.length === 0 && profile.emails.length === 0;

    return (
        <Card className="border-border/70 shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                <div>
                    <CardTitle className="text-base">Mobiles &amp; emails</CardTitle>
                    <CardDescription>
                        Verified contacts can sign in and be primary. An unverified one still helps the shop find you at the counter.
                    </CardDescription>
                </div>
                <Button size="sm" onClick={() => setAdding(true)} disabled={busy}>
                    <Plus className="size-3.5" /> Add
                </Button>
            </CardHeader>
            <CardContent>
                {empty ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No contacts yet. Add a mobile or email.</p>
                ) : (
                    <ul className="divide-y divide-border/70">
                        {profile.phones.map((c) => (
                            <ContactRow key={`p${c.id}`} kind="phone" contact={c} busy={busy}
                                onVerify={() => setVerifying(c.value)}
                                onPrimary={() => void makePrimary("phone", c)}
                                onRemove={() => setRemoving({ kind: "phone", contact: c })} />
                        ))}
                        {profile.emails.map((c) => (
                            <ContactRow key={`e${c.id}`} kind="email" contact={c} busy={busy}
                                onVerify={() => setVerifying(c.value)}
                                onPrimary={() => void makePrimary("email", c)}
                                onRemove={() => setRemoving({ kind: "email", contact: c })} />
                        ))}
                    </ul>
                )}
            </CardContent>

            {/* Add */}
            <Dialog open={adding} onOpenChange={(o) => { if (!busy) { setAdding(o); if (!o) setNewValue(""); } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Add a mobile or email</DialogTitle>
                        <DialogDescription>
                            Verify it now with a one-time code, or just save it and verify later.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1.5">
                        <Label htmlFor="new-contact">Mobile or email</Label>
                        <Input
                            id="new-contact"
                            value={newValue}
                            onChange={(e) => setNewValue(e.target.value)}
                            placeholder="98765 43210 or you@example.com"
                            autoFocus
                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addPlain(); } }}
                        />
                    </div>
                    <DialogFooter className="gap-2 sm:justify-between">
                        <Button variant="ghost" disabled={busy || !newValue.trim()} onClick={() => void addPlain()}>
                            Save without verifying
                        </Button>
                        <Button disabled={busy || !newValue.trim()} onClick={() => setVerifying(newValue.trim())}>
                            <BadgeCheck className="size-4" /> Verify &amp; save
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Verify (OTP) */}
            <Dialog open={verifying !== null} onOpenChange={(o) => { if (!busy && !o) setVerifying(null); }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Verify {verifying}</DialogTitle>
                        <DialogDescription>We will send a 6-digit code to this contact. Type it here to prove it is yours.</DialogDescription>
                    </DialogHeader>
                    {verifying ? (
                        <PortalOtpLoginForm
                            key={verifying}
                            lockedIdentifier={verifying}
                            verifyLabel="Verify"
                            busy={busy}
                            submitError=""
                            onVerified={(token) => void onVerified(token)}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>

            {/* Remove */}
            <Dialog open={removing !== null} onOpenChange={(o) => { if (!busy && !o) setRemoving(null); }}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>Remove {removing?.contact.value}?</DialogTitle>
                        <DialogDescription>
                            The shop will no longer find you by this {removing?.kind === "phone" ? "number" : "email"}.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" disabled={busy} onClick={() => setRemoving(null)}>Keep it</Button>
                        <Button variant="destructive" disabled={busy} onClick={() => void remove()}>
                            <Trash2 className="size-4" /> Remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
