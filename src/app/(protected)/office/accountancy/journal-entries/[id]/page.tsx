import { redirect, notFound } from "next/navigation";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const jeId = Number(id);
    if (!jeId || isNaN(jeId)) {
        notFound();
    }

    redirect(`/vouchers/journal-entries/${jeId}`);
}
