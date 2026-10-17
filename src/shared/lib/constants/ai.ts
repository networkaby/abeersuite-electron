// AI product descriptions (E-Commerce → Products). Provider + model live here so
// a later comparison run (GPT / Claude / Perplexity) is a one-line change.
// Keys (.env / Vercel): GOOGLE_GENERATIVE_AI_API_KEY = free-tier project, writes
// every draft from name + photo. GOOGLE_AI_SEARCH_API_KEY = billed project, used
// only for the Google Search step when the draft says it would help. Leave the
// second one unset to stay at zero cost.

/** Gemini model used for product copy. The free tier caps each model per day
 *  (3.5-flash was 20 requests/day on 2026-10-17), so the draft step moves to
 *  the paid key once the free one answers 429. */
export const AI_PRODUCT_COPY_MODEL = "gemini-3.8-flash";

/** Products sent to the AI per bulk step — small so the free tier's rate limit holds. */
export const AI_BULK_BATCH_SIZE = 5;

/** How many highlight bullets the Flipkart-style copy carries. */
export const AI_HIGHLIGHT_COUNT = { min: 4, max: 7 } as const;
