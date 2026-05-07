"use client";
import { VoucherForm } from "@/modules/accountancy/components/VoucherForm";

export default function NewContraPage() {
    return <VoucherForm type="CONTRA" redirectTo="/office/accountancy/contras" />;
}
