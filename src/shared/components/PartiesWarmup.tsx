"use client";

import { useEffect } from "react";
import { warmPartyList } from "@/shared/lib/parties/partyCatalog";

/**
 * Loads the customer list at app start, so the first F2 of the day answers from
 * memory instead of waiting on a round trip while a customer stands at the till.
 *
 * Runs everywhere. On a counter the list comes from that machine's own replica;
 * on the web it is one request, then deltas. Either way the search box needs the
 * whole list to be honest about what it found — see `parties/partyCatalog`.
 */
export default function PartiesWarmup() {
    useEffect(() => { warmPartyList(); }, []);
    return null;
}
