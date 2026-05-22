"use client";
import DaybookPage from "./reports/day-book/page";
// import { useJournalVoucherStore } from "@/store/journalVoucherStore";
// useJournalVoucherStore.getState().setOpen(true);

export default function AccountancyPage() {
    return (

        <>
            {/* <Button onClick={() => useJournalVoucherStore.getState().setOpen(true)}>Open Journal Voucher</Button> */}
            <DaybookPage />
        </>
    );
}
