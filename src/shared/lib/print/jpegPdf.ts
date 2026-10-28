// A JPEG on A4 pages as a PDF file, in the browser — for a customer saving or
// sharing a bill they see on screen (the customer app's Download / Share). The
// image is scaled to the page width; a much taller one runs on to further pages.
// A PDF needs nothing more than the JPEG itself (DCTDecode) and a few objects,
// so no PDF library rides along to the phone.

const A4_W = 595.28; // points (210 mm)
const A4_H = 841.89; // points (297 mm)
/** Up to this much taller than a page still prints on one page, slightly smaller. */
const ONE_PAGE_SLACK = 1.15;

/** `jpeg` = the file's bytes; `width` × `height` = its pixel size. */
export function jpegToA4Pdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
    // At page width; a bill a little taller than A4 (the sheet's margins) is
    // shrunk onto one page instead of spilling a strip onto a second.
    let drawW = A4_W;
    let drawH = (height * A4_W) / width;
    if (drawH > A4_H && drawH <= A4_H * ONE_PAGE_SLACK) {
        drawW = (A4_W * A4_H) / drawH;
        drawH = A4_H;
    }
    const left = (A4_W - drawW) / 2;
    const pages = Math.max(1, Math.ceil(drawH / A4_H - 0.001));

    const enc = new TextEncoder();
    const parts: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (p: Uint8Array | string) => {
        const bytes = typeof p === "string" ? enc.encode(p) : p;
        parts.push(bytes);
        length += bytes.length;
    };
    const object = (n: number, body: string | Uint8Array[]) => {
        offsets[n] = length;
        push(`${n} 0 obj\n`);
        if (typeof body === "string") push(body);
        else body.forEach(push);
        push("\nendobj\n");
    };

    // 1 catalog · 2 page tree · 3 image · then a page + its drawing per page.
    const pageNo = (i: number) => 4 + i * 2;
    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${pageNo(i)} 0 R`).join(" ")}] >>`);
    object(3, [
        enc.encode(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
        jpeg,
        enc.encode("\nendstream"),
    ]);
    for (let i = 0; i < pages; i++) {
        // Page i shows the slice of the image that falls on it; the rest is clipped by the page.
        const y = A4_H - drawH + i * A4_H;
        const draw = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${left.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;
        object(pageNo(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] /Resources << /XObject << /Im0 3 0 R >> >> /Contents ${pageNo(i) + 1} 0 R >>`);
        object(pageNo(i) + 1, `<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
    }

    const count = 4 + pages * 2;
    const xref = length;
    push(`xref\n0 ${count}\n0000000000 65535 f \n`);
    for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(length);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}
