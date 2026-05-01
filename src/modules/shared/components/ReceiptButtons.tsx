"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ReceiptButtons() {
    useEffect(() => {
        window.print();
    }, []);

    return (
        <div className="no-print mb-3 flex gap-2">
            <Button onClick={() => window.print()} size="sm">
                🖨️ Print
            </Button>
            <Button onClick={() => window.close()} size="sm" variant="outline">
                ✕ Close
            </Button>
        </div>
    );
}