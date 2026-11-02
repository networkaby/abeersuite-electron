"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import type { AddressDraft } from "./AddressForm";

/** Change the address from its latest value — an answer that lands after more typing
 *  must not put the old boxes back. */
export type AddressUpdate = (fn: (a: AddressDraft) => AddressDraft) => void;

type PinAnswer = { pin: string; ok: boolean; city: string; state: string; localities: string[] };
type Coverage = { pin: string; localities: Record<string, string[]> };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * What a 6-digit PIN tells the address form — India Post's city, state and post
 * office areas (`/api/shop/pincode`) and our own local-delivery neighbourhoods
 * (`/api/shop/local-coverage`). One copy for every address form: office profile,
 * POS, portal and both checkouts.
 *
 * The answer fills only EMPTY boxes. A city or state the customer already typed is
 * never changed: when the PIN says otherwise, `suggestion` carries the PIN's answer
 * and `applySuggestion` puts it in — only on the customer's tap.
 */
export function usePincodeLookup(value: AddressDraft, update: AddressUpdate) {
    const pin = (value.pincode ?? "").replace(/\D/gu, "").slice(0, 6);
    const pinValid = /^\d{6}$/u.test(pin);

    const [answer, setAnswer] = useState<PinAnswer | null>(null);
    const [coverageAnswer, setCoverageAnswer] = useState<Coverage | null>(null);

    useEffect(() => {
        if (!pinValid) return;
        let live = true;
        axios
            .get<{ ok: boolean; city?: string; state?: string; localities?: string[] }>(`/api/shop/pincode/${pin}`)
            .then(({ data }) => {
                if (!live) return;
                const localities = data.ok && Array.isArray(data.localities) ? data.localities : [];
                setAnswer({ pin, ok: data.ok, city: data.city ?? "", state: data.state ?? "", localities });
                if (!data.ok) return;
                update((a) => ({
                    ...a,
                    city: a.city || data.city || "",
                    state: a.state || data.state || "",
                    locality: a.locality || (localities.length === 1 ? localities[0] : ""),
                }));
            })
            .catch(() => live && setAnswer({ pin, ok: false, city: "", state: "", localities: [] }));
        axios
            .get<{ localities: Record<string, string[]> }>(`/api/shop/local-coverage/${pin}`)
            .then(({ data }) => {
                if (!live) return;
                const localities = data.localities ?? {};
                setCoverageAnswer({ pin, localities });
                // A neighbourhood from our own list that this PIN does not cover is dropped.
                const all = Object.values(localities).flat();
                update((a) => (a.neighbourhood && !all.includes(a.neighbourhood) ? { ...a, neighbourhood: "" } : a));
            })
            .catch(() => live && setCoverageAnswer({ pin, localities: {} }));
        return () => {
            live = false;
        };
        // Only a new PIN asks again; `update` reads the latest address itself.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pin, pinValid]);

    // Answers for an older PIN are simply not used — nothing to clear.
    const found = pinValid && answer?.pin === pin ? answer : null;
    const coverage = pinValid && coverageAnswer?.pin === pin ? coverageAnswer.localities : {};

    const hasCoverage = Object.keys(coverage).length > 0;
    // India Post areas ∪ the localities we cover (so a neighbourhood's parent is always listed).
    const localityOptions = [...new Set([...(found?.localities ?? []), ...Object.keys(coverage)])];
    const neighbourhoodOptions = [
        ...new Set(value.locality && coverage[value.locality] ? coverage[value.locality] : Object.values(coverage).flat()),
    ];

    const suggestion =
        found?.ok &&
        ((found.city && value.city && !same(value.city, found.city)) || (found.state && value.state && !same(value.state, found.state)))
            ? { city: found.city, state: found.state }
            : null;
    const applySuggestion = () => {
        if (!found?.ok) return;
        update((a) => ({
            ...a,
            city: found.city || a.city,
            state: found.state || a.state,
            locality: localityOptions.includes(a.locality) ? a.locality : localityOptions.length === 1 ? localityOptions[0] : "",
        }));
    };

    const pincodeInfo = !pinValid
        ? ""
        : !found
          ? "Detecting location…"
          : found.ok
            ? [found.city, found.state].filter(Boolean).join(", ")
            : "Pincode not found — type city and state";

    /** Pick a locality → keep the neighbourhood only if it is still under it. */
    const onLocalityChange = (loc: string) =>
        update((a) => {
            const valid = loc ? coverage[loc] ?? [] : Object.values(coverage).flat();
            return { ...a, locality: loc, neighbourhood: a.neighbourhood && valid.includes(a.neighbourhood) ? a.neighbourhood : "" };
        });
    /** Pick a neighbourhood → its parent locality fills in. */
    const onNeighbourhoodChange = (nb: string) =>
        update((a) => ({
            ...a,
            neighbourhood: nb,
            locality: nb ? Object.keys(coverage).find((l) => (coverage[l] ?? []).includes(nb)) ?? a.locality : a.locality,
        }));

    return {
        pincodeInfo,
        suggestion,
        applySuggestion,
        localityOptions,
        neighbourhoodOptions,
        hasCoverage,
        onLocalityChange,
        onNeighbourhoodChange,
    };
}
