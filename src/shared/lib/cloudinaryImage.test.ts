// Unit tests: Cloudinary thumbnails for plain <img>. Run with `pnpm test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudinaryThumb, isCloudinaryUrl } from "./cloudinaryImage";

const CL = "https://res.cloudinary.com/demo/image/upload/v1700000000/shop/laptop.jpg";

test("Cloudinary photo -> a small copy capped at the width asked", () => {
    const u = cloudinaryThumb(CL, 64);
    assert.ok(isCloudinaryUrl(u));
    assert.match(u, /\/image\/upload\/[^/]*w_64[^/]*\//);
    assert.match(u, /f_auto/);
    assert.ok(u.endsWith("/v1700000000/shop/laptop.jpg"));
});

test("not on Cloudinary -> left exactly as it is", () => {
    for (const src of ["blob:http://localhost/abc", "/logo.png", "https://lh3.googleusercontent.com/a/x", ""]) {
        assert.equal(cloudinaryThumb(src, 64), src);
    }
});
