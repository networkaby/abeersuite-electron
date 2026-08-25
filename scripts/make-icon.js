/**
 * Generates `build/icon.png`, the source image electron-builder converts into the
 * Windows `.ico` for the installer, desktop shortcut and taskbar.
 *
 * Without this the app ships with the default Electron icon, which looks unfinished
 * on a shop counter and makes the desktop shortcut hard to identify.
 *
 * `public/logo.svg` is a 3.4:1 wordmark, so it cannot be used directly — scaled into a
 * square it becomes an unreadable sliver at the 16 and 32 px sizes Windows uses most.
 * We render an "A" monogram in the brand blue taken from that same logo instead.
 *
 * Chromium (via Electron) does the rasterising, because the repo has no image library
 * and Windows' `convert.exe` is not ImageMagick. We draw into a `<canvas>` and read the
 * pixels back rather than calling `capturePage()`: capturing depends on the compositor
 * actually painting a hidden window, which hangs indefinitely for an offscreen surface.
 *
 * Run with:  pnpm icon:build
 *
 * NOTE: this is a clean placeholder, not brand-approved artwork. Replace
 * `build/icon.png` with a proper square mark when design provides one — the build
 * picks it up with no code change.
 */
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

/** Brand blue, taken from the fill in public/logo.svg. */
const BRAND_BLUE = "#0133ff";

/** Render at 512 so electron-builder has headroom for every .ico size it emits. */
const SIZE = 512;

/** Runs inside the page and returns a PNG data URL. */
const DRAW = `(() => {
  const size = ${SIZE};
  const radius = Math.round(size * 0.18);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Rounded square, matching the Windows 11 app-icon convention.
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = "${BRAND_BLUE}";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = '700 ' + Math.round(size * 0.62) + 'px "Segoe UI Semibold", "Segoe UI", Arial, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Nudge down: the cap-height glyph sits optically high on the middle baseline.
  ctx.fillText("A", size / 2, size / 2 + Math.round(size * 0.04));

  return canvas.toDataURL("image/png");
})()`;

app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false });

    try {
        await win.loadURL("data:text/html;charset=utf-8,<!DOCTYPE html><title>icon</title>");
        const dataUrl = await win.webContents.executeJavaScript(DRAW);

        const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, "");
        if (!base64 || base64 === String(dataUrl)) {
            console.error("[make-icon] FATAL: canvas did not return a PNG data URL.");
            app.exit(1);
            return;
        }

        const outDir = path.join(__dirname, "..", "build");
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, "icon.png");
        fs.writeFileSync(outFile, Buffer.from(base64, "base64"));

        console.log(`[make-icon] Wrote build/icon.png (${SIZE}x${SIZE}, ${fs.statSync(outFile).size} bytes).`);
        app.exit(0);
    } catch (err) {
        console.error("[make-icon] FATAL:", err);
        app.exit(1);
    }
});
