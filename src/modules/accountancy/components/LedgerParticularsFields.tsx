"use client";

// Renders whichever particulars blocks apply to the currently chosen group —
// bank, loan, credit card, BNPL, wallet, payment gateway. Driven entirely by
// PARTICULARS_SPECS, so both the create and the edit dialog get the same
// fields from one place. Nothing renders when the group matches no kind.
// A block with an IFSC field (bank) fills a blank Bank Name / Branch from
// RBI's list as the code is typed — useIfscLookup, same as the party Bank tab.

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { IfscLookupHint } from "@/shared/components/IfscLookupHint";
import { useIfscLookup } from "@/shared/hooks";
import {
    PARTICULARS_SPECS, type ParticularsSpec, type ParticularsState, type ParticularsValue,
} from "@/modules/accountancy/lib/ledgerParticulars";

export function LedgerParticularsFields({
    groupName,
    value,
    onChange,
}: {
    /** Name of the group the ledger is being filed under. */
    groupName: string | undefined | null;
    value: ParticularsState;
    onChange: (payloadKey: string, next: ParticularsValue) => void;
}) {
    return (
        <>
            {PARTICULARS_SPECS.filter((spec) => spec.matches(groupName)).map((spec) => (
                <ParticularsBlock
                    key={spec.payloadKey}
                    spec={spec}
                    groupName={groupName}
                    fields={value[spec.payloadKey] ?? spec.empty}
                    onChange={(next) => onChange(spec.payloadKey, next)}
                />
            ))}
        </>
    );
}

/** One kind's block. Its own component so the IFSC lookup hook has a stable home
 *  per block — it idles for every kind without an `ifsc` field. */
function ParticularsBlock({ spec, groupName, fields, onChange }: {
    spec: ParticularsSpec;
    groupName: string | undefined | null;
    fields: ParticularsValue;
    onChange: (next: ParticularsValue) => void;
}) {
    const set = (key: string, v: string) => onChange({ ...fields, [key]: v });
    const ifsc = useIfscLookup(fields, (patch) => onChange({ ...fields, ...patch }));
    // Bank splits its extras behind a narrower gate (OD only); every
    // other kind shows them wherever the block itself shows.
    const showAdvanced = spec.advancedWhen ? spec.advancedWhen(groupName) : true;

    return (
        <div className="col-span-2 space-y-3 rounded-md border border-border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">
                {spec.title}{" "}
                <span className="font-normal text-muted-foreground">— {spec.hint}</span>
            </p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {spec.fields.map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1.5">
                        <Label>{label}</Label>
                        <Input
                            value={fields[key] ?? ""}
                            onChange={(e) => (key === "ifsc" ? ifsc.typeIfsc(e.target.value) : set(key, e.target.value))}
                            placeholder={placeholder}
                        />
                    </div>
                ))}

                {showAdvanced && spec.advancedFields?.map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1.5">
                        <Label>
                            {label}{" "}
                            <span className="font-normal text-muted-foreground">— optional</span>
                        </Label>
                        <Input
                            value={fields[key] ?? ""}
                            onChange={(e) => set(key, e.target.value)}
                            placeholder={placeholder}
                        />
                    </div>
                ))}

                {showAdvanced && spec.fundTierDefault && (
                    <div className="space-y-1.5">
                        <Label>Usable Fund Tier</Label>
                        <Select
                            // Stored blank means "the kind's default tier", so the
                            // default option writes back "" rather than its own name.
                            value={fields.fundTier || spec.fundTierDefault}
                            onValueChange={(v) => set("fundTier", v === spec.fundTierDefault ? "" : v)}
                        >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="INSTANT">Instant</SelectItem>
                                <SelectItem value="OTHER">Other</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>
            <IfscLookupHint state={ifsc.state} onUse={ifsc.use} />
        </div>
    );
}
