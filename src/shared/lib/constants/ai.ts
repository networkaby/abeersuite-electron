// AI product descriptions (E-Commerce → Products). Provider + model live here so
// a later comparison run (GPT / Claude / Perplexity) is a one-line change.
// Key: GOOGLE_GENERATIVE_AI_API_KEY in .env / Vercel.

/** Gemini model used for product copy. Flash-Lite is the cheaper fallback. */
export const AI_PRODUCT_COPY_MODEL = "gemini-3.5-flash";

/** Products sent to the AI per bulk step — small so the free tier's rate limit holds. */
export const AI_BULK_BATCH_SIZE = 5;

/** How many highlight bullets the Flipkart-style copy carries. */
export const AI_HIGHLIGHT_COUNT = { min: 4, max: 7 } as const;
