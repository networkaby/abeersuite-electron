"use client";

import { useEffect, useState } from "react";
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

    const load = async () => {
        try {
            const { data } = await axios.get<Forwarding>(`/api/users/${userId}/forward-email`);
            setState(data); setUnavailable("");
            setForwardTo(f => f || data.forwardTo || "");
            setHandle(h => h || data.address.split("@")[0]);
        } catch (e) {
            setUnavailable(axios.isAxiosError(e) ? e.response?.data?.error ?? "Could not reach the office" : "Could not read the forwarding");
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the person or their login changes
    useEffect(() => { void load(); }, [userId, reloadKey]);

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
