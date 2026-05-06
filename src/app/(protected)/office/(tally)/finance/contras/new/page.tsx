"use client";
import { VoucherForm } from "@/modules/tally/components/VoucherForm";

export default function NewContraPage() {
    return <VoucherForm type="CONTRA" redirectTo="/office/finance/contras" />;
}
