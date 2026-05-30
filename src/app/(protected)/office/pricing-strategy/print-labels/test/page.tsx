"use client";

/**
 * Barcode-label TEST route — a throwaway sandbox to prototype the label design.
 *
 * The whole UI lives in <LabelDesigner/> (shared with the Generate page's Print
 * tab). This route just mounts it seeded with sample items.
 */

import { LabelDesigner } from "@/modules/inventory/components/LabelDesigner";

export default function LabelTestPage() {
    return <LabelDesigner />;
}
