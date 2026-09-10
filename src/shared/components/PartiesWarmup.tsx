"use client";

import { useEffect } from "react";
import { partyCatalogEnabled, syncPartyList } from "@/shared/lib/parties/partyFullCatalog";

/**
 * Loads the customer list into memory at app start on a replica-served counter,
 * so the first `F2` of the day answers from memory instead of waiting on a
 * round trip while a customer stands at the till.
 *
 * A no-op everywhere else — see partyFullCatalog for why holding the whole list
 * is the right trade on a counter and the wrong one in a browser.
 */
export default function PartiesWarmup() {
    useEffect(() => {
        if (partyCatalogEnabled()) void syncPartyList();
    }, []);
    return null;
}
