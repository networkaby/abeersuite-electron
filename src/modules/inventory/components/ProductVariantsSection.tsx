"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { extractApiError } from "@/shared/lib/api";
import { InvProductCombobox } from "@/modules/inventory/components/InvProductCombobox";
import type { VariantMember } from "@/modules/inventory/lib/variants";

type Family = { label: string | null; members: VariantMember[] };

/**
 * "Variants" on a saved product (owner, 2026-11-10): the products that are the
 * same item in another option (XYZ Black / XYZ Blue), each still its own
 * product. "Add variant" picks any product — both join one family, either way
 * round — and the label is the text on this product's shop option button.
 * Saves straight away, separate from the form's Save. See lib/variants.ts.
 */
export default function ProductVariantsSection({ productId }: { productId: number }) {
    const [family, setFamily] = useState<Family | null>(null);
    const [label, setLabel] = useState("");
    const [busy, setBusy] = useState(false);
    const [pickNonce, setPickNonce] = useState(0);
    const url = `/api/inventory/products/${productId}/variants`;

    useEffect(() => {
        let live = true;
        axios
            .get<Family>(url)
            .then(({ data }) => {
                if (!live) return;
                setFamily(data);
                setLabel(data.label ?? "");
            })
            .catch((e) => toast.error(extractApiError(e, "Could not load variants")));
        return () => {
            live = false;
        };
    }, [url]);

    const run = async (call: () => Promise<{ data: Family }>, fail: string) => {
        setBusy(true);
        try {
            const { data } = await call();
            setFamily(data);
        } catch (e) {
            toast.error(extractApiError(e, fail));
        } finally {
            setBusy(false);
        }
    };

    const saveLabel = () => {
        if ((family?.label ?? "") === label.trim()) return;
        void run(() => axios.patch<Family>(url, { label }), "Could not save the label");
    };

    // Optimistic: the row goes at once and comes back if the server says no.
    const remove = async (memberId: number) => {
        const before = family;
        if (!before) return;
        const left = before.members.filter((m) => m.id !== memberId);
        const self = memberId === productId;
        setFamily({ ...before, members: self || left.length <= 1 ? [] : left });
        try {
            const { data } = await axios.delete<Family>(url, { params: { memberId } });
            setFamily(data);
        } catch (e) {
            setFamily(before);
            toast.error(extractApiError(e, "Could not remove"));
        }
    };

    const members = family?.members ?? [];

    return (
        <section className="mt-4 space-y-3 rounded-lg border p-4">
            <div>
                <h3 className="text-sm font-semibold">Variants</h3>
                <p className="text-xs text-muted-foreground">
                    Same item in another option (colour, size, storage). Each stays its own product; the shop shows
                    them as option buttons.
                </p>
            </div>

            <div className="grid gap-1.5 sm:max-w-xs">
                <Label htmlFor={`variant-label-${productId}`}>Option label (shop button)</Label>
                <Input
                    id={`variant-label-${productId}`}
                    value={label}
                    maxLength={40}
                    placeholder="e.g. Black, 6GB/128GB"
                    onChange={(e) => setLabel(e.target.value)}
                    onBlur={saveLabel}
                    onKeyDown={(e) => e.key === "Enter" && saveLabel()}
                    disabled={family == null}
                />
            </div>

            {members.length > 0 ? (
                <ul className="divide-y rounded-md border text-sm">
                    {members.map((m) => (
                        <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                            <span className="min-w-0 flex-1 truncate">
                                {m.name}
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {m.sku}
                                    {m.variantLabel ? ` · ${m.variantLabel}` : " · no label"}
                                    {m.id === productId ? " · this product" : ""}
                                    {!m.isActive ? " · inactive" : ""}
                                </span>
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                disabled={busy}
                                onClick={() => void remove(m.id)}
                                aria-label={m.id === productId ? "Leave this family" : `Remove ${m.name}`}
                                title={m.id === productId ? "Leave this family" : "Remove from family"}
                            >
                                <X className="size-4" />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs text-muted-foreground">No variants yet.</p>
            )}

            <div className="grid gap-1.5">
                <Label>Add variant</Label>
                <InvProductCombobox
                    value={null}
                    allowCreate={false}
                    clearNonce={pickNonce}
                    placeholder="Search product by name or SKU…"
                    onChange={(p) => {
                        if (!p) return;
                        setPickNonce((n) => n + 1);
                        if (members.some((m) => m.id === p.id) || p.id === productId) {
                            toast.info("Already in this family.");
                            return;
                        }
                        void run(() => axios.post<Family>(url, { otherId: p.id }), "Could not add variant");
                    }}
                />
            </div>
        </section>
    );
}
