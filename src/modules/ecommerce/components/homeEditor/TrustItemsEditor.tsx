"use client";

import { Plus, Trash2, ArrowUp, ArrowDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TRUST_ICON_MAP, TRUST_ICON_LABELS } from "@/modules/external/store/trustIcons";
import { TRUST_ICON_KEYS, type TrustContentItem } from "@/shared/lib/shop/homeLayout";

function newItem(): TrustContentItem {
    return { icon: "shield", title: "", desc: "" };
}

export default function TrustItemsEditor({
    items,
    defaultItems,
    onChange,
}: {
    items: TrustContentItem[] | undefined;
    defaultItems: TrustContentItem[];
    onChange: (next: TrustContentItem[] | undefined) => void;
}) {
    if (items === undefined) {
        return (
            <div className="space-y-2 rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                <p>Using the default {defaultItems.length} items from code.</p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onChange(defaultItems.map((d) => ({ ...d })))}
                >
                    Customize
                </Button>
            </div>
        );
    }

    const rows = items;
    const update = (i: number, patch: Partial<TrustContentItem>) =>
        onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
    const move = (i: number, dir: -1 | 1) => {
        const target = i + dir;
        if (target < 0 || target >= rows.length) return;
        const next = [...rows];
        [next[i], next[target]] = [next[target], next[i]];
        onChange(next);
    };

    return (
        <div className="space-y-3">
            {rows.map((item, i) => {
                const Icon = TRUST_ICON_MAP[item.icon];
                return (
                    <div key={i} className="space-y-2 rounded-md border border-border p-3">
                        <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                <Icon className="size-3.5" /> Item {i + 1}
                            </span>
                            <div className="flex items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={i === 0}
                                    onClick={() => move(i, -1)}
                                    aria-label="Move up"
                                >
                                    <ArrowUp className="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={i === rows.length - 1}
                                    onClick={() => move(i, 1)}
                                    aria-label="Move down"
                                >
                                    <ArrowDown className="size-3.5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="size-6 text-destructive"
                                    onClick={() => remove(i)}
                                    aria-label="Remove item"
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Icon</Label>
                                <Select value={item.icon} onValueChange={(v) => update(i, { icon: v as TrustContentItem["icon"] })}>
                                    <SelectTrigger className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TRUST_ICON_KEYS.map((k) => (
                                            <SelectItem key={k} value={k}>
                                                {TRUST_ICON_LABELS[k]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Title</Label>
                                <Input value={item.title} onChange={(e) => update(i, { title: e.target.value })} />
                            </div>
                            <div className="grid gap-1">
                                <Label className="text-xs font-normal">Description</Label>
                                <Input value={item.desc} onChange={(e) => update(i, { desc: e.target.value })} />
                            </div>
                        </div>
                    </div>
                );
            })}
            <div className="flex items-center justify-between">
                <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, newItem()])}>
                    <Plus className="mr-1.5 size-3.5" /> Add item
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => onChange(undefined)}>
                    <RotateCcw className="mr-1.5 size-3.5" /> Reset to default
                </Button>
            </div>
        </div>
    );
}
