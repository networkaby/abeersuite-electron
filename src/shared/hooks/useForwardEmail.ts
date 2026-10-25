"use client";

import { useEffect, useState, useEffectEvent } from "react";
import axios from "axios";
import { toast } from "sonner";

export type Forwarding = { address: string; forwardTo: string | null; verified: boolean; enabled: boolean; catchAll: string | null };

/**
 * Where a staff address forwards — Cloudflare Email Routing, through
 * `/api/users/[id]/forward-email`. One read/save path for the profile's Forward
 * Email card and the Staff Directory's Login card, so both say the same thing.
 * `unavailable` holds the route's refusal (not a company address, no Cloudflare…).
 * `reloadKey` re-reads when the login changes under it (e.g. a new sign-in email).
 */
export function useForwardEmail(userId: number, reloadKey?: string) {
    const [state, setState] = useState<Forwarding | null>(null);
    const [unavailable, setUnavailable] = useState("");
    const [forwardTo, setForwardTo] = useState("");
    const [handle, setHandle] = useState("");
    const [busy, setBusy] = useState(false);

    const read = (isCurrent: () => boolean) =>
        axios.get<Forwarding>(`/api/users/${userId}/forward-email`).then(
            ({ data }) => {
                if (!isCurrent()) return;
                setState(data); setUnavailable("");
                setForwardTo(f => f || data.forwardTo || "");
                setHandle(h => h || data.address.split("@")[0]);
            },
            (e) => {
                if (!isCurrent()) return;
                setUnavailable(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not read the forwarding");
            },
        );
    const load = () => read(() => true);
    // A reply for the previous person (or login) must not land on this one.
    const readFor = useEffectEvent((isCurrent: () => boolean) => { void read(isCurrent); });
    useEffect(() => {
        let current = true;
        readFor(() => current);
        return () => { current = false; };
    }, [userId, reloadKey]);

    /** `withHandle` — the caller shows a handle box, so a changed one renames the login. */
    const save = async (withHandle = false) => {
        setBusy(true);
        try {
            const renaming = withHandle && state && handle.trim().toLowerCase() !== state.address.split("@")[0];
            const { data } = await axios.put<Forwarding>(`/api/users/${userId}/forward-email`, { forwardTo, ...(renaming && { handle }) });
            setState(data);
            if (renaming) toast.success(`Sign in with ${data.address} from now on`);
            toast.success(data.verified ? "Forwarding saved" : "Saved — open Cloudflare's email in that inbox and click Verify");
        } catch (e) {
            toast.error(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not save the forwarding");
        } finally { setBusy(false); }
    };

    const status = !state?.forwardTo
        ? (state?.catchAll ? `Not set — going to catch-all (${state.catchAll})` : "Not set")
        : !state.verified ? "Waiting for verify"
        : state.enabled ? "Active" : "Turned off";

    return { state, unavailable, forwardTo, setForwardTo, handle, setHandle, busy, load, save, status };
}
