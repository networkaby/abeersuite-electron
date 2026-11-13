/**
 * Meta's Graph API — one version for every call: WhatsApp (OTP, bills, templates,
 * Connect number) and Facebook / Instagram posting. Meta retires each version about
 * two years after release; bump it here and every caller moves together.
 */
export const META_GRAPH_VERSION = "v23.0";

/** Base URL for Graph API calls: `${META_GRAPH}/<id>/<edge>`. */
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** Facebook Login's sign-in dialog, same version. */
export const META_OAUTH_DIALOG = `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`;
