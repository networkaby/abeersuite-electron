import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { spawnSync } from "child_process";

loadDotenv({ path: path.join(process.cwd(), ".env") });

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist-app");
const SCRIPTS_DIR = path.join(ROOT, "scripts", "downloader");
const SOURCE_CS = path.join(SCRIPTS_DIR, "AbeerSuiteDownloader.cs");
const OUT_EXE = path.join(DIST, "AbeerSuite-WebSetup.exe");
const ICON_PNG = path.join(ROOT, "build", "icon.png");
const ICON_ICO = path.join(ROOT, "build", "icon.ico");

// Ensure dist-app directory exists
fs.mkdirSync(DIST, { recursive: true });

// 1. Ensure build/icon.ico exists from build/icon.png
function ensureIco() {
    if (fs.existsSync(ICON_ICO)) return;
    if (!fs.existsSync(ICON_PNG)) {
        console.warn("[build-downloader] Warning: build/icon.png not found, skipping icon embedding.");
        return;
    }

    try {
        const pngBuf = fs.readFileSync(ICON_PNG);
        // Standard Windows PNG-in-ICO wrapper
        const icoHeader = Buffer.alloc(22);
        icoHeader.writeUInt16LE(0, 0); // Reserved
        icoHeader.writeUInt16LE(1, 2); // ICO type
        icoHeader.writeUInt16LE(1, 4); // Image count (1)

        icoHeader.writeUInt8(0, 6);    // Width: 0 means 256
        icoHeader.writeUInt8(0, 7);    // Height: 0 means 256
        icoHeader.writeUInt8(0, 8);    // Color count
        icoHeader.writeUInt8(0, 9);    // Reserved
        icoHeader.writeUInt16LE(1, 10); // Color planes
        icoHeader.writeUInt16LE(32, 12); // Bits per pixel
        icoHeader.writeUInt32LE(pngBuf.length, 14); // Image byte length
        icoHeader.writeUInt32LE(22, 18); // Image data offset

        const icoBuf = Buffer.concat([icoHeader, pngBuf]);
        fs.writeFileSync(ICON_ICO, icoBuf);
        console.log("[build-downloader] Generated build/icon.ico from build/icon.png.");
    } catch (err) {
        console.warn("[build-downloader] Could not generate icon.ico:", err);
    }
}

// 2. Locate csc.exe compiler
function findCsc(): string {
    const candidates = [
        "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
        "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error("Could not find .NET Framework csc.exe compiler on this Windows machine.");
}

// 3. Prepare token
const rawToken = (process.env.GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN || "").trim();
const XOR_KEY = 0x5a;

let tokenBytesStr = "/* No token embedded */";
if (rawToken) {
    const bytes = Buffer.from(rawToken, "utf8");
    const encoded = [];
    for (let i = 0; i < bytes.length; i++) {
        encoded.push("0x" + (bytes[i] ^ XOR_KEY).toString(16).padStart(2, "0"));
    }
    tokenBytesStr = encoded.join(", ");
    console.log(`[build-downloader] Embedded read token into executable (obfuscated, length ${rawToken.length}).`);
} else {
    console.warn(
        "[build-downloader] NOTE: No GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN found in .env.\n" +
        "  The generated .exe will prompt the user to enter their token at runtime or accept --token=..."
    );
}

// 3b. Prepare target repo — owner/repo the downloader fetches releases from.
const [repoOwner, repoName] = (process.env.GITHUB_DOWNLOAD_UPDATE_REPO || "").split("/");
if (!repoOwner || !repoName) {
    throw new Error(
        "GITHUB_DOWNLOAD_UPDATE_REPO must be set in .env as \"owner/repo\" — the repo the bootstrap downloader fetches releases from."
    );
}

// 4. Read C# source and inject token + repo
let csContent = fs.readFileSync(SOURCE_CS, "utf8");
csContent = csContent
    .replace(
        "public static byte[] EmbeddedTokenBytes = new byte[] { /* TOKEN_BYTES */ };",
        `public static byte[] EmbeddedTokenBytes = new byte[] { ${tokenBytesStr} };`
    )
    .replace('"/* REPO_OWNER */"', JSON.stringify(repoOwner))
    .replace('"/* REPO_NAME */"', JSON.stringify(repoName));

const tempCs = path.join(SCRIPTS_DIR, "AbeerSuiteDownloader.g.cs");
fs.writeFileSync(tempCs, csContent, "utf8");

try {
    ensureIco();
    const cscPath = findCsc();

    const args = [
        "/target:winexe",
        "/optimize+",
        "/platform:anycpu",
        "/nologo",
        `/out:${OUT_EXE}`,
        "/r:System.dll,System.Drawing.dll,System.Windows.Forms.dll",
    ];

    if (fs.existsSync(ICON_ICO)) {
        args.push(`/win32icon:${ICON_ICO}`);
    }

    args.push(tempCs);

    console.log(`[build-downloader] Compiling ${path.basename(OUT_EXE)} using ${path.basename(cscPath)}...`);
    const res = spawnSync(cscPath, args, { stdio: "inherit" });

    if (res.status !== 0) {
        throw new Error(`csc compilation failed with exit code ${res.status}`);
    }

    const stat = fs.statSync(OUT_EXE);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`[build-downloader] SUCCESS: Generated ${OUT_EXE} (${kb} KB).`);
} finally {
    if (fs.existsSync(tempCs)) {
        try { fs.unlinkSync(tempCs); } catch {}
    }
}
