import axios from "axios";
import { putToSignedUrl } from "@/shared/lib/storage/signedUpload";
import type { PhotoCrop, PostRow } from "@/modules/campaigns/lib/post";

/**
 * Put one file on a saved post from the browser: a signed URL, the bytes
 * straight to R2, then attach it — as the main photo, or `extra` beside it;
 * `channel` (a platform card's own upload) also makes it that channel's photo.
 * Master, the platform cards and the save flow all use it. Throws like axios;
 * callers show extractApiError.
 */
export async function uploadPostFile(postId: number, file: File, extra = false, channel?: string): Promise<PostRow> {
    const { data } = await axios.post<{ key: string; putUrl: string }>(`/api/campaigns/posts/${postId}/media/upload-url`, {
        name: file.name, type: file.type, size: file.size,
    });
    await putToSignedUrl(data.putUrl, file, file.type);
    const saved = await axios.put<PostRow>(`/api/campaigns/posts/${postId}/media`, {
        key: data.key, type: file.type, name: file.name, size: file.size, extra, channel,
    });
    return saved.data;
}

/**
 * Cut a post's photo (`key`, default the main one) to each channel's shape —
 * every ticked channel, or just `channels`; with `crop` (the Adjust frame),
 * exactly that part for one channel; with `keys`, several photos for one channel.
 */
export async function fitPostPhoto(
    postId: number,
    opts: { channels?: string[]; key?: string; keys?: string[]; crop?: PhotoCrop | null } = {},
): Promise<{ post: PostRow; fitted: Record<string, string> }> {
    return (await axios.post<{ post: PostRow; fitted: Record<string, string> }>(`/api/campaigns/posts/${postId}/media/fit`, opts)).data;
}
