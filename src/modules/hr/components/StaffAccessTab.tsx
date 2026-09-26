"use client";

// Access tab — a staff member's login, laid open on the page (no popup): name
// and sign-in email, where their company mail forwards, and a new password.
// Every write goes through the same `/api/users/[id]` routes as Admin → Users,
// so the two pages can never disagree, and a change on either shows on both
// (`settings`). Role and Reports to live on the Job tab (StaffRoleFields).

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { AtSign, KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForwardEmail } from "@/shared/hooks";
import { extractApiError } from "@/shared/lib/api/extractApiError";
import { COMPANY_DETAILS } from "@/shared/lib/constants/companyDetails";
import type { StaffDetail } from "../lib/staffTypes";

const STAFF_DOMAIN = COMPANY_DETAILS.staffMailDomain;
const isStaffMail = (email: string) => email.toLowerCase().endsWith(`@${STAFF_DOMAIN}`);

type LoginUser = StaffDetail["user"];

export default function StaffAccessTab({ detail, canEdit, onChanged }: {
    detail: StaffDetail;
    /** users:edit — without it the tab is read-only, never hidden. */
    canEdit: boolean;
    onChanged: () => void;
}) {
    const { user } = detail;
    return (
        <div className="max-w-2xl space-y-4">
            <p className="text-xs text-muted-foreground">
                How they sign in. The same login shows on Admin → Users — a change on either page shows on both.
            </p>
            {/* Keyed on the saved values: a fresh read resets the boxes, typing does not. */}
            <LoginSection key={`${user.id}:${user.name}:${user.email}`} user={user} canEdit={canEdit} onChanged={onChanged} />
            {isStaffMail(user.email) && (
                <Section
                    icon={<Mail size={14} />}
                    title="Mail forward"
                    note="Their company address has no mailbox — its mail, Forgot password codes included, goes here."
                >
                    <ForwardRow userId={user.id} email={user.email} canEdit={canEdit} />
                </Section>
            )}
            <PasswordSection user={user} canEdit={canEdit} onChanged={onChanged} />
        </div>
    );
}

function Section({ icon, title, note, children }: {
    icon: React.ReactNode; title: string; note: string; children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium">{icon} {title}</h3>
            <p className="mb-3 text-xs text-muted-foreground">{note}</p>
            {children}
        </section>
    );
}

/** Name + sign-in email. A company address is typed as the name part only; an older
 *  login on another domain keeps its full box until "Give company email", which also
 *  forwards the new address to the inbox it used before. */
function LoginSection({ user, canEdit, onChanged }: { user: LoginUser; canEdit: boolean; onChanged: () => void }) {
    const startLocal = isStaffMail(user.email) ? user.email.split("@")[0] : user.email;
    const [name, setName] = useState(user.name);
    const [company, setCompany] = useState(isStaffMail(user.email));
    const [local, setLocal] = useState(startLocal);
    const [forwardTo, setForwardTo] = useState("");
    const [busy, setBusy] = useState(false);

    const email = company ? `${local.trim().toLowerCase()}@${STAFF_DOMAIN}` : local.trim();
    const dirty = name.trim() !== user.name || email !== user.email;

    const giveCompanyEmail = () => {
        setCompany(true);
        setLocal(user.email.split("@")[0].toLowerCase());
        setForwardTo(user.email.toLowerCase());
    };
    const undo = () => {
        setName(user.name); setCompany(isStaffMail(user.email)); setLocal(startLocal); setForwardTo("");
    };

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { toast.error("Name is required"); return; }
        setBusy(true);
        try {
            // Only what changed — an untouched email must not be re-sent over a rename
            // the person made on their own Security tab since this page opened.
            const { data } = await axios.put<{ forwardingError?: string | null }>(`/api/users/${user.id}`, {
                ...(name.trim() !== user.name && { name: name.trim() }),
                ...(email !== user.email && { email }),
                ...(company && forwardTo ? { forwardTo } : {}),
            });
            toast.success("Login saved");
            if (data.forwardingError) toast.warning(`Saved, but the mail forward was not: ${data.forwardingError}`);
            onChanged();
        } catch (err) {
            toast.error(extractApiError(err, "Could not save the login"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section icon={<AtSign size={14} />} title="Login details" note="Name and the address they sign in with.">
            <form onSubmit={save}>
                <fieldset disabled={!canEdit || busy} className="grid gap-3 border-0 p-0 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <Label htmlFor={`name-${user.id}`}>Full name</Label>
                        <Input id={`name-${user.id}`} value={name} onChange={e => setName(e.target.value)} autoComplete="off" className="h-9" />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor={`email-${user.id}`}>Sign-in email</Label>
                        {company ? (
                            <div className="flex h-9 items-center rounded-md border border-input focus-within:ring-2 focus-within:ring-ring">
                                <Input
                                    id={`email-${user.id}`}
                                    value={local}
                                    onChange={e => setLocal(e.target.value.replace(/@.*$/, ""))}
                                    autoComplete="off"
                                    className="h-8 border-0 shadow-none focus-visible:ring-0"
                                />
                                <span className="pr-3 text-sm text-muted-foreground">@{STAFF_DOMAIN}</span>
                            </div>
                        ) : (
                            <>
                                <Input id={`email-${user.id}`} value={local} onChange={e => setLocal(e.target.value)} autoComplete="off" className="h-9" />
                                {canEdit && (
                                    <button type="button" className="text-xs text-primary underline" onClick={giveCompanyEmail}>
                                        Give company email (@{STAFF_DOMAIN})
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                </fieldset>
                {canEdit && (
                    <div className="mt-3 flex gap-2">
                        <Button type="submit" size="sm" disabled={busy || !dirty}>{busy ? "Saving…" : "Save"}</Button>
                        {dirty && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={undo}>Undo</Button>}
                    </div>
                )}
            </form>
        </Section>
    );
}

/** Where their company mail goes (Gmail etc.). Same read/save as the profile's
 *  Forward Email card; a refusal (Cloudflare, not configured) shows as the note. */
function ForwardRow({ userId, email, canEdit }: { userId: number; email: string; canEdit: boolean }) {
    const { state, unavailable, forwardTo, setForwardTo, busy, load, save, status } = useForwardEmail(userId, email);
    return (
        <form
            onSubmit={e => { e.preventDefault(); void save(); }}
            className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]"
        >
            <label htmlFor={`fwd-${userId}`} className="flex items-center text-muted-foreground">Forward to</label>
            <div className="space-y-1">
                <div className="flex gap-2">
                    <Input
                        id={`fwd-${userId}`}
                        type="email"
                        autoComplete="off"
                        value={forwardTo}
                        onChange={e => setForwardTo(e.target.value)}
                        placeholder="someone@gmail.com"
                        disabled={!canEdit}
                        className="h-8"
                    />
                    {canEdit && (
                        <Button type="submit" size="sm" disabled={busy || !state || !forwardTo.trim()}>
                            {busy ? "Saving…" : "Save"}
                        </Button>
                    )}
                </div>
                <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void load()}>
                    {unavailable || (state ? `${status}${state.forwardTo ? ` · now ${state.forwardTo}` : ""}` : "Loading…")}
                </button>
            </div>
        </form>
    );
}

/** A new password, set by the admin. The route signs them out on every device. */
function PasswordSection({ user, canEdit, onChanged }: { user: LoginUser; canEdit: boolean; onChanged: () => void }) {
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
        setBusy(true);
        try {
            await axios.put(`/api/users/${user.id}`, { password });
            setPassword("");
            toast.success("Password set — they are signed out everywhere");
            onChanged();
        } catch (err) {
            toast.error(extractApiError(err, "Could not set the password"));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Section
            icon={<KeyRound size={14} />}
            title="Password"
            note="Setting a new one signs them out on every device. They can also use Forgot password on the sign-in page."
        >
            {canEdit ? (
                <form onSubmit={save} className="flex max-w-md gap-2">
                    {/* new-password: stops the browser dropping YOUR saved password in here. */}
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="New password (min 6)"
                        className="h-9"
                        disabled={busy}
                    />
                    <Button type="submit" size="sm" className="h-9" disabled={busy || !password}>
                        {busy ? "Saving…" : "Set password"}
                    </Button>
                </form>
            ) : (
                <p className="text-sm text-muted-foreground">Only someone who may edit users can set it.</p>
            )}
        </Section>
    );
}
