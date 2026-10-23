import { notFound } from "next/navigation";
import PostComposer from "@/modules/campaigns/components/PostComposer";

export const metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
    const id = Number((await params).id);
    if (!Number.isInteger(id) || id <= 0) notFound();
    return <PostComposer postId={id} />;
}
