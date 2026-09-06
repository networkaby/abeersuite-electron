; ══ AbeerSuite installer customisations ══════════════════════════════════════
;
; electron-builder includes this file at GLOBAL scope, near the top of the
; generated .nsi (NsisTarget.js -> scriptGenerator.include). Only defines,
; macros and attributes belong here — a bare instruction at this level does not
; compile. Everything that has to run does so from one of electron-builder's
; hook macros: preInit, customWelcomePage, customInstall, customUnInstall.

!include FileFunc.nsh

!define FIREWALL_RULE_NAME "AbeerSuite Desktop"
; Where electron-updater stages a downloaded installer — CACHE_DIR_NAME in
; electron/updateManager.ts. Keep the two in step.
!define UPDATER_CACHE_DIR "$LOCALAPPDATA\abeersuite-electron-updater"
!define PS_EXE "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"

; Where this file and its two .ps1 siblings live, at COMPILE time.
;
; NOT the __FILEDIR__ macro: electron-builder feeds the whole script to makensis on
; stdin, so that macro resolves to app-builder-lib's own templates directory and every
; command below fails with "no files found" — in the uninstaller pass first, because
; that one is built first. BUILD_RESOURCES_DIR is electron-builder's own define for the
; buildResources folder (build/), and it is supplied to both passes.
!define NSH_DIR "${BUILD_RESOURCES_DIR}"

; ── Saying what is happening ─────────────────────────────────────────────────
;
; DetailPrint on its own is invisible in this installer, and always has been:
; electron-builder's common.nsh sets `ShowInstDetails nevershow` and its
; installSection.nsh sets `SetDetailsPrint none` for every non-silent install.
; The six DetailPrint lines this file used to carry were never seen by anybody.
;
; The progress page's status label is not governed by SetDetailsPrint, so write
; to it directly — the same SendMessage electron-builder itself uses for
; one-click mode. DetailPrint is kept alongside so a silent or logged install
; still records the identical line.
!macro sayStep TEXT
  Push $R8
  Push $R9
  FindWindow $R8 "#32770" "" $hwndparent
  FindWindow $R8 "#32770" "" $hwndparent $R8
  GetDlgItem $R9 $R8 1000
  SendMessage $R9 ${WM_SETTEXT} 0 "STR:${TEXT}"
  Pop $R9
  Pop $R8
  DetailPrint "${TEXT}"
!macroend

; ── Disk space ───────────────────────────────────────────────────────────────
;
; The install needs roughly TWICE the app size free, which surprises people.
; electron-builder's NSIS does not unpack into the program folder: it extracts
; the whole payload into %TEMP%\...\7z-out and then copies that tree into
; $INSTDIR (extractAppPackage.nsh — deliberate, it makes the install atomic).
; Both live on the same drive on a counter PC.
;
; Without this check a short drive fails halfway through with a message nobody
; can act on. APP_64_UNPACKED_SIZE is in KB and comes from the real payload, so
; this tracks the app instead of going stale.
!ifdef APP_64_UNPACKED_SIZE
  !define REQUIRED_FREE_KB ${APP_64_UNPACKED_SIZE}
!else
  !define REQUIRED_FREE_KB 700000
!endif

!macro preInit
  ; Per-user install (perMachine: false), so the payload lands under
  ; $LOCALAPPDATA and %TEMP% is on the same drive. $INSTDIR is not set this
  ; early — take the root from $LOCALAPPDATA instead.
  Push $0
  Push $1
  Push $2
  StrCpy $0 $LOCALAPPDATA 3
  ${DriveSpace} "$0" "/D=F /S=M" $1
  ; Double for the unpack-then-copy, and a little headroom on top.
  IntOp $2 ${REQUIRED_FREE_KB} / 1024
  IntOp $2 $2 * 2
  IntOp $2 $2 + 300
  ${If} $1 < $2
    ; /SD IDOK: an auto-update runs this silently. Without a default answer the
    ; box would hang the update forever; with one it falls straight through to
    ; the Abort below, so a short-drive counter simply keeps the version it has.
    MessageBox MB_OK|MB_ICONSTOP /SD IDOK "AbeerSuite needs about $2 MB free on drive $0 to install, and only $1 MB is free.$\r$\n$\r$\nIt needs roughly twice its own size because Windows unpacks the app first and then copies it into place.$\r$\n$\r$\nFree up some space and run this setup again."
    Abort
  ${EndIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; ── Welcome page ─────────────────────────────────────────────────────────────
;
; The unpack is one long blocking call (Nsis7z::Extract, then CopyFiles) with no
; progress callback we can hook, so nothing can report from inside it. Setting
; the expectation beforehand is the honest alternative to a bar that looks stuck.
;
; Fresh installs only — an auto-update runs silently and never shows a page.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Installing AbeerSuite"
  !define MUI_WELCOMEPAGE_TEXT "This will install AbeerSuite on this counter PC.$\r$\n$\r$\nUnpacking takes a few minutes on a new machine — the progress bar can look still for a while. Please leave the window open until it finishes.$\r$\n$\r$\nClick Next to begin."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; ── Visual C++ runtime ───────────────────────────────────────────────────────
;
; The embedded PostgreSQL (resources/pgsql) is a Microsoft-toolchain build and
; needs the VC++ 2015-2022 x64 shared runtime (vcruntime140.dll, msvcp140.dll).
; A clean counter PC does not have it: initdb then dies with 0xC0000135
; (STATUS_DLL_NOT_FOUND), the app silently falls back to live mode, and counter
; onboarding cannot start its local sync (see postgresManager.ts).
;
; Not bundled — it would add ~25 MB to every installer and every update. A counter
; is bound online, so internet at install time is a given: check the registry, and
; download from Microsoft only when the runtime is missing. AbeerSuite-WebSetup.exe
; runs the same audit first, so this usually finds it already present and skips.
!define VCREDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"
!define VCREDIST_KEY "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"
; 14.20 = VS2019 — the floor the bundled PostgreSQL was linked against.
!define VCREDIST_MIN_MINOR 20

!macro ensureVcRuntime
  !insertmacro sayStep "Checking the Microsoft Visual C++ runtime..."
  SetRegView 64
  ReadRegDWORD $0 HKLM "${VCREDIST_KEY}" "Installed"
  ReadRegDWORD $1 HKLM "${VCREDIST_KEY}" "Major"
  ReadRegDWORD $2 HKLM "${VCREDIST_KEY}" "Minor"
  SetRegView lastused
  ${If} $0 == 1
  ${AndIf} $1 >= 14
  ${AndIf} $2 >= ${VCREDIST_MIN_MINOR}
    DetailPrint "Visual C++ runtime $1.$2 already installed — skipping."
  ${Else}
  !insertmacro sayStep "Downloading the Microsoft Visual C++ runtime (about 25 MB)..."
  inetc::get /USERAGENT "AbeerSuite-Setup" /RESUME "" "${VCREDIST_URL}" "$PLUGINSDIR\vc_redist.x64.exe" /END
  Pop $0
  ${If} $0 != "OK"
    MessageBox MB_OK|MB_ICONSTOP "AbeerSuite needs the Microsoft Visual C++ 2015-2022 (x64) runtime for its local database, and it could not be downloaded ($0).$\r$\n$\r$\nConnect to the internet and run this setup again, or install it yourself from:$\r$\n${VCREDIST_URL}"
    Abort "Visual C++ runtime download failed: $0"
  ${EndIf}

  !insertmacro sayStep "Installing the Microsoft Visual C++ runtime..."
  ; ExecShellWait so the redistributable's own elevation applies even when this
  ; installer is running per-user. 0 = ok, 3010 = ok but reboot pending, 1638 = a
  ; newer version is already present.
  ExecShellWait "runas" "$PLUGINSDIR\vc_redist.x64.exe" "/install /quiet /norestart"
  Pop $0
  ${If} $0 == 0
  ${OrIf} $0 == 3010
  ${OrIf} $0 == 1638
    DetailPrint "Visual C++ runtime installed (exit $0)."
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "The Visual C++ runtime installer failed (exit code $0). AbeerSuite's local database cannot start without it.$\r$\n$\r$\nInstall it yourself from:$\r$\n${VCREDIST_URL}$\r$\nthen run this setup again."
    Abort "Visual C++ runtime install failed: $0"
  ${EndIf}
  ${EndIf}
!macroend

; ── Firewall rule and Defender exclusions ────────────────────────────────────
;
; Both need administrator rights, which a per-user install does not have, so
; they go through one elevated PowerShell script (counter-setup.ps1) rather than
; the bare `netsh` this file used to run — that call needed admin, never got it,
; never had its return value checked, and so no counter has ever had the rule.
;
; The exclusions are the biggest single lever on how long an update takes: the
; payload is written twice (see preInit) and Defender inspects every file both
; times. Excluding the program folder and the updater's staging folder removes
; the second half of that, and stops Defender re-reading the embedded PostgreSQL
; on every app start.
;
; -CheckOnly first, unelevated: when everything is already in place — which is
; every update after the first install — nothing is asked of the counter.
!macro ensureCounterSetup
  File "/oname=$PLUGINSDIR\counter-setup.ps1" "${NSH_DIR}\counter-setup.ps1"

  !insertmacro sayStep "Checking Windows Firewall and Defender settings..."
  nsExec::Exec '"${PS_EXE}" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\counter-setup.ps1" -InstallDir "$INSTDIR" -UpdaterCacheDir "${UPDATER_CACHE_DIR}" -FirewallRuleName "${FIREWALL_RULE_NAME}" -CheckOnly'
  Pop $0

  ${If} $0 == 0
    DetailPrint "Firewall rule and Defender exclusions already in place."
  ${ElseIf} ${Silent}
    ; An auto-update runs this section with nobody sitting at the counter, and
    ; ExecShellWait has no timeout - the UAC prompt would wait for a click that
    ; never comes, behind a blank screen, with the old app already shut down.
    ; Neither the firewall rule nor the exclusions are needed for AbeerSuite to
    ; run; they only make it faster. So skip them here and let the next attended
    ; install put them in.
    DetailPrint "Silent update - skipping Firewall/Defender setup (needs an administrator)."
  ${Else}
    !insertmacro sayStep "Setting up Windows Firewall and Defender for AbeerSuite..."
    ExecShellWait "runas" "${PS_EXE}" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\counter-setup.ps1" -InstallDir "$INSTDIR" -UpdaterCacheDir "${UPDATER_CACHE_DIR}" -FirewallRuleName "${FIREWALL_RULE_NAME}"'
    Pop $0
    ; Never fatal. A counter without the exclusion still runs correctly, just
    ; more slowly, and a cashier who declines the prompt must not be left with a
    ; half-installed till.
    ${If} $0 == 0
      DetailPrint "Firewall rule and Defender exclusions applied."
    ${Else}
      DetailPrint "Firewall/Defender setup was declined or failed (exit $0) — AbeerSuite will still run."
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro ensureVcRuntime
  !insertmacro ensureCounterSetup
  !insertmacro sayStep "Finishing up..."
!macroend

!macro customUnInstall
  File "/oname=$PLUGINSDIR\counter-teardown.ps1" "${NSH_DIR}\counter-teardown.ps1"

  ; Check first, exactly as the install side does. Without this every uninstall
  ; raised a UAC prompt even on a PC that had nothing of ours to take off it.
  nsExec::Exec '"${PS_EXE}" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\counter-teardown.ps1" -InstallDir "$INSTDIR" -UpdaterCacheDir "${UPDATER_CACHE_DIR}" -FirewallRuleName "${FIREWALL_RULE_NAME}" -CheckOnly'
  Pop $0

  ${If} $0 == 0
    DetailPrint "No firewall rule or Defender exclusions to remove."
  ${ElseIf} ${Silent}
    DetailPrint "Silent uninstall - leaving firewall rule and Defender exclusions in place."
  ${Else}
    !insertmacro sayStep "Removing AbeerSuite's firewall rule and Defender exclusions..."
    ; Elevates because both were added with administrator rights. Declining leaves
    ; two harmless entries behind rather than blocking the uninstall.
    ExecShellWait "runas" "${PS_EXE}" '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\counter-teardown.ps1" -InstallDir "$INSTDIR" -UpdaterCacheDir "${UPDATER_CACHE_DIR}" -FirewallRuleName "${FIREWALL_RULE_NAME}"'
    Pop $0
    DetailPrint "Firewall/Defender cleanup finished (exit $0)."
  ${EndIf}
!macroend
