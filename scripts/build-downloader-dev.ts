import * as fs from "fs";
import * as path from "path";
import { config as loadDotenv } from "dotenv";
import { compileWinExe, ensureIco } from "./lib/csc";

loadDotenv({ path: path.join(process.cwd(), ".env") });

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist-app");
const SCRIPTS_DIR = path.join(ROOT, "scripts", "downloader");
const SOURCE_CS = path.join(SCRIPTS_DIR, "AbeerSuiteDownloader.cs");
const OUT_EXE = path.join(DIST, "AbeerSuite-WebSetup-Dev.exe");
const ICON_PNG = path.join(ROOT, "build", "icon.png");
const ICON_ICO = path.join(ROOT, "build", "icon.ico");
const LOG = "[build-downloader-dev]";

// Ensure dist-app directory exists
fs.mkdirSync(DIST, { recursive: true });

// 1. Prepare token — a read-only PAT scoped to the test repo, separate from the
// write-scoped GH_TOKEN_2 that release-electron.ts uses to publish there.
const rawToken = (process.env.GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN_2 || "").trim();
const XOR_KEY = 0x5a;

let tokenBytesStr = "/* No token embedded */";
if (rawToken) {
    const bytes = Buffer.from(rawToken, "utf8");
    const encoded = [];
    for (let i = 0; i < bytes.length; i++) {
        encoded.push("0x" + (bytes[i] ^ XOR_KEY).toString(16).padStart(2, "0"));
    }
    tokenBytesStr = encoded.join(", ");
    console.log(`${LOG} Embedded read token into executable (obfuscated, length ${rawToken.length}).`);
} else {
    console.warn(
        `${LOG} NOTE: No GITHUB_DOWNLOAD_UPDATE_PAT_TOKEN_2 found in .env.\n` +
        "  The generated .exe will prompt the user to enter their token at runtime or accept --token=..."
    );
}

// 2. Prepare target repo — the test/prerelease channel, GITHUB_UPDATE_REPO_2.
const [repoOwner, repoName] = (process.env.GITHUB_UPDATE_REPO_2 || "").split("/");
if (!repoOwner || !repoName) {
    throw new Error(
        "GITHUB_UPDATE_REPO_2 must be set in .env as \"owner/repo\" — the test repo this dev downloader fetches releases from."
    );
}

// 3. Read C# source and inject token + repo (same source file as the production
// downloader — only the build-time substitution differs).
let csContent = fs.readFileSync(SOURCE_CS, "utf8");
csContent = csContent
    .replace(
        "public static byte[] EmbeddedTokenBytes = new byte[] { /* TOKEN_BYTES */ };",
        `public static byte[] EmbeddedTokenBytes = new byte[] { ${tokenBytesStr} };`
    )
    .replace('"/* REPO_OWNER */"', JSON.stringify(repoOwner))
    .replace('"/* REPO_NAME */"', JSON.stringify(repoName));

const tempCs = path.join(SCRIPTS_DIR, "AbeerSuiteDownloader.dev.g.cs");
fs.writeFileSync(tempCs, csContent, "utf8");

try {
    compileWinExe({
        source: tempCs,
        outExe: OUT_EXE,
        icon: ensureIco(ICON_PNG, ICON_ICO, LOG),
        logPrefix: LOG,
    });

    const stat = fs.statSync(OUT_EXE);
    const kb = (stat.size / 1024).toFixed(1);
    console.log(`${LOG} SUCCESS: Generated ${OUT_EXE} (${kb} KB).`);
} finally {
    if (fs.existsSync(tempCs)) {
        try { fs.unlinkSync(tempCs); } catch {}
    }
}
