// Stand-in for Node-only packages a browser library names but never needs here.
// next.config.ts aliases `canvas` to this: Konva's Node entry requires the native
// `canvas` module, and Turbopack still builds the server copy of a
// `dynamic(..., { ssr: false })` import, so without the alias the page fails to compile.
const empty = {};
export default empty;
