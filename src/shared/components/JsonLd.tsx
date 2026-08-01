/**
 * Renders a JSON-LD structured-data block.
 *
 * A plain <script> rather than next/script: structured data must be present in
 * the server-rendered HTML, because Google's parser reads the raw response and
 * will not wait for a deferred script to inject it.
 *
 * The `<` escape stops a stray "</script>" inside product text from closing the
 * tag early — the one real injection route for user-editable strings in a JSON
 * island. Build the object with the helpers in shared/lib/seo/jsonLd.ts.
 */
export default function JsonLd({ data }: { data: object }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
                __html: JSON.stringify(data).replace(/</g, "\\u003c"),
            }}
        />
    );
}
