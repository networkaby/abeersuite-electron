import PostComposer from "@/modules/campaigns/components/PostComposer";

export const metadata = { title: "New post" };

export default function NewPostPage() {
    return <PostComposer postId={null} />;
}
