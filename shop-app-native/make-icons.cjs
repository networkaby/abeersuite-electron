// Draws the Android launcher icons and the splash icon from the website's own
// customer-app icons (public/shop-icon-*.png), so the app and the PWA never drift.
//   node shop-app-native/make-icons.cjs        (sharp comes from the main project)
// Re-run after replacing public/shop-icon-*.png, then rebuild the APK.
const path = require("path");
const sharp = require("sharp");

const root = path.join(__dirname, "..");
const res = path.join(__dirname, "android/app/src/main/res");
const maskable = path.join(root, "public/shop-icon-maskable-512.png");
const plain = path.join(root, "public/shop-icon-512.png");

// Android density buckets: launcher icon is 48dp, adaptive foreground 108dp.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// A maskable icon keeps its logo inside the middle 80%; an adaptive icon shows only
// the middle 72 of 108dp. Drawing the maskable at 90dp lines those two zones up, so
// no launcher shape crops the logo.
const FOREGROUND_DP = 90;

async function run() {
    for (const [bucket, scale] of Object.entries(DENSITIES)) {
        const dir = path.join(res, `mipmap-${bucket}`);
        const launcher = Math.round(48 * scale);
        const canvas = Math.round(108 * scale);
        const inner = Math.round(FOREGROUND_DP * scale);
        const pad = Math.floor((canvas - inner) / 2);

        await sharp(plain).resize(launcher, launcher).png().toFile(path.join(dir, "ic_launcher.png"));

        const circle = Buffer.from(`<svg width="${launcher}" height="${launcher}"><circle cx="${launcher / 2}" cy="${launcher / 2}" r="${launcher / 2}"/></svg>`);
        await sharp(maskable).resize(launcher, launcher).composite([{ input: circle, blend: "dest-in" }]).png()
            .toFile(path.join(dir, "ic_launcher_round.png"));

        await sharp(maskable).resize(inner, inner)
            .extend({ top: pad, left: pad, bottom: canvas - inner - pad, right: canvas - inner - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png().toFile(path.join(dir, "ic_launcher_foreground.png"));
    }
    console.log("icons written to", res);
}

run().catch((e) => { console.error(e); process.exit(1); });
