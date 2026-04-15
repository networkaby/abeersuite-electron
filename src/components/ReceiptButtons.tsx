"use client";

export default function ReceiptButtons() {
    return (
        <div style={{ marginBottom: "12px", display: "flex", gap: "8px" }} className="no-print">
            <button
                onClick={() => window.print()}
                style={{
                    padding: "6px 16px",
                    background: "#2563eb",
                    color: "white",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                }}
            >
                🖨️ Print
            </button>
            <button
                onClick={() => window.history.back()}
                style={{
                    padding: "6px 16px",
                    background: "#f3f4f6",
                    color: "#374151",
                    border: "1px solid #d1d5db",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontSize: "13px",
                }}
            >
                ← Back
            </button>
        </div>
    );
}