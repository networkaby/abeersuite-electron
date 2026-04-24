"use client";

import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X } from "lucide-react";

interface Props {
    ticketId: number;
    isWarranty: boolean;
    warrantyStatus: string;
    warrantyRef?: string | null;
    purchaseDate?: string | null;
    onClose: () => void;
}

const VOID_REASONS = [
    { value: "physical_damage",    label: "Physical damage" },
    { value: "water_damage",       label: "Water / liquid damage" },
    { value: "tampered",           label: "Tampered / seals broken" },
    { value: "expired",            label: "Warranty expired" },
    { value: "third_party_repair", label: "Prior third-party repair" },
    { value: "misuse",             label: "Misuse / user error" },
    { value: "other",              label: "Other" },
];

export default function WarrantyConvertModal({ ticketId, isWarranty, warrantyStatus, warrantyRef: initRef, purchaseDate: initDate, onClose }: Props) {
    const [voiding, setVoiding] = useState(false);
    const [voidReason, setVoidReason] = useState("");
    const [note, setNote] = useState("");
    const [warrantyRef, setWarrantyRef] = useState(initRef ?? "");
    const [purchaseDate, setPurchaseDate] = useState(initDate ? initDate.slice(0, 10) : "");
    const [saving, setSaving] = useState(false);

    const toWarranty = !isWarranty || (isWarranty && warrantyStatus === "VOID");
    const isVoidAction = isWarranty && warrantyStatus !== "VOID" && voiding;

    const handleSubmit = async () => {
        if (isVoidAction && !voidReason) {
            toast.error("Select a void reason");
            return;
        }
        setSaving(true);
        try {
            await axios.post(`/api/tickets/${ticketId}/warranty`, {
                isWarranty: isVoidAction ? true : toWarranty,
                warrantyStatus: isVoidAction ? "VOID" : (toWarranty ? "CLAIMED" : "NONE"),
                voidReason: isVoidAction ? voidReason : null,
                note: note || null,
                warrantyRef: warrantyRef || null,
                purchaseDate: purchaseDate || null,
            });
            toast.success(isVoidAction ? "Warranty voided" : toWarranty ? "Converted to warranty" : "Converted to non-warranty");
            onClose();
        } catch {
            toast.error("Failed to update warranty status");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Warranty Conversion</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                </div>

                <div className="space-y-4">
                    {/* Action selector — only shown if currently in warranty and not voided */}
                    {isWarranty && warrantyStatus !== "voided" && (
                        <div className="flex rounded-lg border overflow-hidden text-sm">
                            <button
                                type="button"
                                onClick={() => setVoiding(false)}
                                className={`flex-1 py-2 font-medium transition-colors ${!voiding ? "bg-red-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                            >
                                Remove from warranty
                            </button>
                            <button
                                type="button"
                                onClick={() => setVoiding(true)}
                                className={`flex-1 py-2 font-medium transition-colors border-l ${voiding ? "bg-red-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                            >
                                Void warranty
                            </button>
                        </div>
                    )}

                    {/* Summary of what will happen */}
                    <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600">
                        {isVoidAction
                            ? "Warranty will be voided. Sub-status will switch to SS36 — customer approval required."
                            : toWarranty
                            ? "Ticket will be flagged as warranty claim. Sub-status will switch to SS37 — notify customer no charge."
                            : "Warranty flag will be removed. Any warranty-only sub-status steps will be cleared."}
                    </div>

                    {/* Void reason */}
                    {isVoidAction && (
                        <div>
                            <label className="block text-sm font-medium mb-1">Void reason</label>
                            <select
                                value={voidReason}
                                onChange={(e) => setVoidReason(e.target.value)}
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                            >
                                <option value="">— Select reason —</option>
                                {VOID_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Warranty ref + purchase date (shown when converting TO warranty) */}
                    {toWarranty && !isVoidAction && (
                        <>
                            <div>
                                <label className="block text-sm font-medium mb-1">Warranty ref / serial <span className="text-gray-400">(optional)</span></label>
                                <input
                                    value={warrantyRef}
                                    onChange={(e) => setWarrantyRef(e.target.value)}
                                    placeholder="e.g. SN-12345 or receipt number"
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Purchase date <span className="text-gray-400">(optional)</span></label>
                                <input
                                    type="date"
                                    value={purchaseDate}
                                    onChange={(e) => setPurchaseDate(e.target.value)}
                                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </>
                    )}

                    {/* Note */}
                    <div>
                        <label className="block text-sm font-medium mb-1">Note <span className="text-gray-400">(optional)</span></label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            placeholder="Add context for the log..."
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button onClick={onClose} className="flex-1 border rounded-lg py-2 text-sm hover:bg-gray-50">
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={saving}
                            className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm hover:bg-red-700 disabled:opacity-50"
                        >
                            {saving ? "Saving..." : "Confirm"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
