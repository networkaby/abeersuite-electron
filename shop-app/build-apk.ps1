# Builds the signed CUSTOMER app (Trusted Web Activity, Bubblewrap) and puts it
# where the website serves it.
#   pwsh -File shop-app\build-apk.ps1
#
# A TWA, not Capacitor like the staff app (phone-app/), on purpose (owner,
# 2026-10-06): a TWA runs the site in real Chrome, so web push and the service
# worker's "shown" report work — that report is what lets a bill skip the
# WhatsApp copy. Capacitor's WebView has no web push.
#
# Every screen is the live site: a deploy reaches installed phones without a new
# APK. Rebuild only when the name, icon, colours or address change, and bump
# appVersionCode in twa-manifest.json first, or phones refuse it as "not an update".
#
# FIRST TIME ONLY (owner, by hand — the key's passwords are typed, never stored):
#   1. Deploy first: Bubblewrap downloads the icons from shop.networkservice.in.
#   2. Create the key, and back it up OFF this PC — losing it means the app can
#      never be updated under in.networkservice.shop:
#        & "D:\AndroidTools\jdk-17.0.20.1+1\bin\keytool.exe" -genkeypair -v `
#          -keystore shop-app\ns-shop.keystore -alias ns-shop -keyalg RSA -keysize 2048 -validity 10000
#   3. Run this script. It generates the Gradle project from twa-manifest.json
#      the first time (`bubblewrap update`), then builds.
$ErrorActionPreference = "Stop"
$tools = "D:\AndroidTools"
$env:JAVA_HOME = "$tools\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "$tools\android-sdk"
$env:GRADLE_USER_HOME = "$tools\gradle-home"

Set-Location $PSScriptRoot
# Bubblewrap runs a bare `gradlew.bat` through cmd; PowerShell 7 sets
# NoDefaultCurrentDirectoryInExePath, so cmd won't look in this folder unless told.
$env:PATH = "$PSScriptRoot;$env:PATH"
if (-not (Test-Path ".\ns-shop.keystore")) {
    throw "shop-app\ns-shop.keystore is missing. First build: create it (see the top of this script). Otherwise restore it from the backup - a new key cannot update phones that already have the app."
}

$bubblewrap = "$tools\bubblewrap\node_modules\.bin\bubblewrap.cmd"
if (-not (Test-Path ".\gradlew.bat")) {
    & $bubblewrap update --skipVersionUpgrade --manifest=.\twa-manifest.json
    if ($LASTEXITCODE -ne 0) { throw "bubblewrap update failed ($LASTEXITCODE)" }
}

& $bubblewrap build --skipPwaValidation
if ($LASTEXITCODE -ne 0) { throw "bubblewrap build failed ($LASTEXITCODE)" }

# Served from public/ (SHOP_APP_APK in src/shared/lib/device/shopApp.ts) until
# the Play Store listing is live; the .aab next to it is what Play takes.
Copy-Item ".\app-release-signed.apk" "..\public\ns-shop.apk" -Force

# assetlinks.json is what opens the app full screen with no address bar. Keeps
# the staff app's entry — see scripts/set-assetlinks.ps1.
. "$PSScriptRoot\..\scripts\set-assetlinks.ps1"
Set-AssetLink -Package (Get-Content ".\twa-manifest.json" -Raw | ConvertFrom-Json).packageId -Apk ".\app-release-signed.apk"
Write-Host "Done: public\ns-shop.apk and public\.well-known\assetlinks.json updated. Play Store upload: shop-app\app-release-bundle.aab"
