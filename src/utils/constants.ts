// Keys match the Priority enum: LOW | MEDIUM | HIGH | URGENT
export const PRIORITY_META: Record<string, { label: string; color: string }> = {
    LOW:    { label: "Low",    color: "bg-gray-100 text-gray-500" },
    MEDIUM: { label: "Normal", color: "bg-blue-50 text-blue-500" },
    HIGH:   { label: "High",   color: "bg-orange-100 text-orange-500" },
    URGENT: { label: "Urgent", color: "bg-red-100 text-red-600" },
};

// SubStatusGroup
