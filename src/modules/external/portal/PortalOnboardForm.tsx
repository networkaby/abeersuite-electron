"use client";

import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OtpChannel } from "@/shared/lib/auth/portalPasswordless";

/**
 * Minimal on-the-go create form, shown only after the customer's mobile/email
 * is already verified. Name is the one thing we cannot derive; the second
 * contact is offered because it is one field and saves a support call later.
 */
export default function PortalOnboardForm({
    channel,
    identity,
    busy,
    error,
    onSubmit,
    onCancel,
}: {
    channel: OtpChannel;
    identity: string;
    busy: boolean;
    error: string;
    onSubmit: (name: string, extraContact: string) => void;
    onCancel: () => void;
}) {
    const [name, setName] = useState("");
    const [extraContact, setExtraContact] = useState("");

    // They verified one channel — ask for the other one, optionally.
    const extraLabel = channel === "mobile" ? "Email" : "Mobile";

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit(name.trim(), extraContact.trim());
            }}
            className="space-y-4"
        >
            <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                <BadgeCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>
                    <span className="font-medium">{identity}</span> is verified. Just your name and
                    you are in.
                </span>
            </div>

            <div className="space-y-2">
                <Label htmlFor="onboard-name">Your name</Label>
                <Input
                    id="onboard-name"
                    autoComplete="name"
                    placeholder="e.g. Rahul Sharma"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="onboard-extra" className="flex items-center gap-2">
                    {extraLabel}
                    <span className="text-xs font-normal text-muted-foreground">optional</span>
                </Label>
                <Input
                    id="onboard-extra"
                    type={channel === "mobile" ? "email" : "tel"}
                    inputMode={channel === "mobile" ? "email" : "numeric"}
                    autoComplete={channel === "mobile" ? "email" : "tel"}
                    placeholder={channel === "mobile" ? "you@example.com" : "98765 43210"}
                    value={extraContact}
                    onChange={(e) => setExtraContact(e.target.value)}
                />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={busy || name.trim().length === 0}>
                {busy ? "Creating your account…" : "Create account & continue"}
            </Button>
            <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
                onClick={onCancel}
            >
                Use a different mobile or email
            </button>
        </form>
    );
}
