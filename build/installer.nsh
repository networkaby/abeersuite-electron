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

; app.getPath("userData") — named from package.json "name", NOT the "AbeerSuite"
; productName (see the comment above loadEnvFiles in electron/main.ts). Keep the two
; in step, the same way UPDATER_CACHE_DIR tracks updateManager.ts.
!define APPDATA_DIR_NAME "abeersuite-electron"

; The one thing an uninstall keeps out of that folder. The counter's hardware is
; physical and does not change when the app is reinstalled: the thermal printer
; (thermal.windowsPrinterName), the customer display (qr.comPort + qr.relayPort) and
; the slideshow folder (qr.idleFolder) all live in this single file, so keeping it
; saves setting all three up again by hand. Safe to keep on its own —
; hardwareBridgeManager.ts treats an absent file as a fresh machine and the settings
; page rewrites it, so nothing depends on the rest of the folder being there.
; A second file to keep is a one-word edit here plus one line in wipeCounterData.
!define KEEP_ON_UNINSTALL "hardware-bridge.json"

; Electron writes auto-start as "electron.app.<executable name>" under HKCU Run
; (app.setLoginItemSettings, see setAutoStart in electron/main.ts). PRODUCT_FILENAME is
; electron-builder's own define for that name — "AbeerSuite".
;
; Windows keeps a SECOND record next door, under StartupApproved\Run, whenever somebody
; switches a startup item off in Task Manager. Left behind it would pre-disable the
; entry if the app were ever installed on this PC again, so it goes too.
;
; Neither key is subject to WOW64 registry redirection, so the 32-bit uninstaller reads
; and writes exactly the values the 64-bit app wrote.
!define AUTOSTART_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define AUTOSTART_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define AUTOSTART_REG_VALUE "electron.app.${PRODUCT_FILENAME}"

; One argument list for counter-teardown.ps1, used by all three ways it can be run
; (check, silent-in-place, attended).
!define TEARDOWN_ARGS '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\counter-teardown.ps1" -InstallDir "$INSTDIR" -UpdaterCacheDir "${UPDATER_CACHE_DIR}" -FirewallRuleName "${FIREWALL_RULE_NAME}"'

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
;
; Only when there is a window to write to. A silent run has no page and $hwndparent is
; 0, which turns both FindWindow calls into TOP-LEVEL searches for any "#32770" — that
; is every dialog on the machine, so the SendMessage below could relabel a control in
; some other program's dialog. Nothing has been seen to go wrong, but silent runs now
; do real work in the uninstaller, so close it rather than leave it.
!macro sayStep TEXT
  ${IfNot} ${Silent}
    Push $R8
    Push $R9
    FindWindow $R8 "#32770" "" $hwndparent
    FindWindow $R8 "#32770" "" $hwndparent $R8
    GetDlgItem $R9 $R8 1000
    SendMessage $R9 ${WM_SETTEXT} 0 "STR:${TEXT}"
    Pop $R9
    Pop $R8
  ${EndIf}
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
    ; An auto-update runs this silently, and a MessageBox with no default answer
    ; would wait for a click that never comes. /SD IDOK gives it one, so a silent
    ; run falls straight through to the Abort and a short-drive counter simply
    ; keeps the version it has. NSIS wants /SD after the message text, not before
    ; it - put it before and makensis reads the text as a jump label and dies.
    MessageBox MB_OK|MB_ICONSTOP "AbeerSuite needs about $2 MB free on drive $0 to install, and only $1 MB is free.$\r$\n$\r$\nIt needs roughly twice its own size because Windows unpacks the app first and then copies it into place.$\r$\n$\r$\nFree up some space and run this setup again." /SD IDOK
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

  ; The registry key and the actual DLLs can disagree. A bad uninstall, a cleanup
  ; tool or a failed repair leaves "Installed=1" behind with the files gone - and
  ; then this audit skips the download while initdb still dies with 0xC0000135,
  ; which is the exact failure it exists to prevent. So check both.
  ;
  ; NSIS runs 32-bit, so $SYSDIR is redirected to SysWOW64, which holds the x86
  ; runtime. The x64 DLLs initdb needs are in the REAL System32 - only visible with
  ; redirection off. Without this the check would look in the wrong folder and
  ; report the runtime missing on every machine.
  StrCpy $3 "0"
  ${DisableX64FSRedirection}
  ${If} ${FileExists} "$SYSDIR\vcruntime140.dll"
  ${AndIf} ${FileExists} "$SYSDIR\vcruntime140_1.dll"
  ${AndIf} ${FileExists} "$SYSDIR\msvcp140.dll"
    StrCpy $3 "1"
  ${EndIf}
  ${EnableX64FSRedirection}

  ${If} $0 == 1
  ${AndIf} $1 >= 14
  ${AndIf} $2 >= ${VCREDIST_MIN_MINOR}
  ${AndIf} $3 == "1"
    DetailPrint "Visual C++ runtime $1.$2 present, and its DLLs are in System32 — skipping."
  ${ElseIf} ${Silent}
    ; An auto-update runs silently, with NO window on screen. Every call below can
    ; block on a click nobody is there to give: inetc's own progress dialog, the UAC
    ; prompt raised by ExecShellWait "runas", and the two MessageBoxes. A blocked
    ; silent update is the worst outcome there is - the app is already replaced, the
    ; installer waits for ever, and the till shows nothing at all.
    ;
    ; Skipping is safe here. Reaching an update at all means the first install already
    ; dealt with the runtime, so a missing one now means something outside this app
    ; removed it - and postgresManager.ts already catches exactly that at startup
    ; (initdb exit 0xC0000135) and names the download. A counter that boots and
    ; explains itself beats one that hangs mid-update.
    DetailPrint "Visual C++ runtime missing, but this is a silent update - skipping so the update cannot hang. The app reports it at startup."
  ${Else}
  !insertmacro sayStep "Downloading the Microsoft Visual C++ runtime (about 25 MB)..."
  inetc::get /USERAGENT "AbeerSuite-Setup" /RESUME "" "${VCREDIST_URL}" "$PLUGINSDIR\vc_redist.x64.exe" /END
  Pop $0
  ${If} $0 != "OK"
    MessageBox MB_OK|MB_ICONSTOP "AbeerSuite needs the Microsoft Visual C++ 2015-2022 (x64) runtime for its local database, and it could not be downloaded ($0).$\r$\n$\r$\nConnect to the internet and run this setup again, or install it yourself from:$\r$\n${VCREDIST_URL}" /SD IDOK
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
    MessageBox MB_OK|MB_ICONSTOP "The Visual C++ runtime installer failed (exit code $0). AbeerSuite's local database cannot start without it.$\r$\n$\r$\nInstall it yourself from:$\r$\n${VCREDIST_URL}$\r$\nthen run this setup again." /SD IDOK
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

; ── Finish page: start the app into the system tray ──────────────────────────
;
; electron-builder's own finish page launches the app with no arguments, which
; opens a window. A counter PC wants the opposite: the app up and warm — Postgres
; started, server listening, sync running — with nothing on screen until somebody
; asks for it. `--hidden` does exactly that (isHiddenLaunch in electron/main.ts),
; and it is the same argument Windows uses to auto-start the app every morning,
; so the very first start behaves like every one after it.
;
; Replacing the whole page is the supported route: assistedInstaller.nsh checks
; `!ifmacrodef customFinishPage` and only falls back to its own StartApp +
; MUI_PAGE_FINISH block when we have not defined one. Because we take that
; branch, `nsis.runAfterFinish` in package.json no longer governs this page — it
; is set true there so the config does not contradict what happens here.
;
; The default StartApp also passes `--updated` on a re-install. Nothing in this
; app has ever read that flag, so dropping it loses nothing.
;
; $launchLink is the Start Menu shortcut, set by installSection.nsh well before
; this page is reached. ShellExecute appends our argument to the shortcut's own,
; and ExecShellAsUser sheds the installer's elevation first — so the app runs as
; the cashier, not as whoever approved the UAC prompt.
!macro customFinishPage
  Function StartApp
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--hidden"
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  ; Say where it goes. Ticked, clicked Finish, and no window appearing looks like
  ; a failed install unless the box itself explains the tray.
  !define MUI_FINISHPAGE_RUN_TEXT "Start AbeerSuite now (it waits in the system tray)"
  !insertmacro MUI_PAGE_FINISH
!macroend

;  ── One install, one set of shortcuts ───────────────────────────────────────
;
; The setup asks "only for me" or "anyone who uses this computer", and over time a
; PC can end up with both: a copy in Program Files AND one under
; %LOCALAPPDATA%\Programs, or one copy with its shortcuts left in both Start Menus.
; Both copies open the same counter database (it lives in the user's %APPDATA%,
; whoever installed), so the one just picked is kept and the other goes.
;
; electron-builder already removes a per-user copy when installing for everyone,
; but passes --keep-shortcuts, which is how the per-user Start Menu link survives.
; The other direction (installing for me over a for-everyone copy) it never does.
;
; The old copy is removed with its own uninstaller and `--updated`, the same flag a
; normal update uses, so customUnInstall keeps the counter's data, auto-start and the
; firewall rule. Removing a Program Files copy needs a UAC prompt, so it only happens
; when someone is at the setup — a silent auto-update leaves it for the next manual run.
!macro removeOtherInstall
  Push $0
  Push $1
  ${If} $installMode != "all"
  ${AndIfNot} ${Silent}
    ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ReadRegStr $1 HKLM "${UNINSTALL_REGISTRY_KEY}" UninstallString
    ${If} $0 != ""
    ${AndIf} $0 != "$INSTDIR"
    ${AndIf} $1 != ""
      !insertmacro sayStep "Removing the older AbeerSuite copy in $0..."
      !insertmacro GetInQuotes $1 "$1"
      ${If} ${FileExists} "$1"
        CopyFiles /SILENT "$1" "$PLUGINSDIR\other-uninstaller.exe"
        ExecWait '"$PLUGINSDIR\other-uninstaller.exe" /S /allusers /KEEP_APP_DATA --updated _?=$0' $1
        DetailPrint "Older copy uninstaller returned $1."
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; Shortcuts in the other scope, whichever way round. A for-everyone Start Menu or
  ; Public Desktop link needs admin rights; without them the Delete simply fails.
  ${If} $installMode == "all"
    SetShellVarContext current
  ${Else}
    SetShellVarContext all
  ${EndIf}
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${Else}
    SetShellVarContext current
  ${EndIf}

  ; electron-builder never recreates a deleted Desktop icon on an update — it reads
  ; the missing link as "the user removed it". The owner wants it back every time.
  ${IfNot} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
  Pop $1
  Pop $0
!macroend

!macro customInstall
  !insertmacro removeOtherInstall
  !insertmacro ensureVcRuntime
  !insertmacro ensureCounterSetup
  !insertmacro sayStep "Finishing up..."
!macroend

; ══ Taking AbeerSuite off the PC ═════════════════════════════════════════════
;
; Until now an uninstall removed the program folder and the shortcuts and stopped
; there. Three things were always left behind:
;
;   %APPDATA%\abeersuite-electron  ~155 MB — pgdata (a full local copy of the shop
;                                  database, 116 tables, no password on it),
;                                  sync-config.json with the LIVE database password in
;                                  plain text, update-config.yml with the GitHub token,
;                                  the session signing key and the signed-in cookies
;   %LOCALAPPDATA%\...-updater     ~160 MB — one whole downloaded installer
;   HKCU ...\Run                   a startup entry pointing at an exe that is gone
;
; The credentials are the real problem; the 300 MB is secondary.
;
; ── The one rule everything here obeys ───────────────────────────────────────
; An UPDATE also runs this uninstaller. installUtil.nsh hands the old uninstaller
; `/S /KEEP_APP_DATA --updated _?=<dir>` purely to clear the program folder before the
; new version is written into it. Removing any of the three above at that moment would
; break the version being installed: the replica pulled down again over the shop's
; internet, the staged installer taken from under electron-updater, the firewall rule the
; new version wants deleted, and the counter's whole settings folder emptied — including
; `autostart.json`, which is now where the auto-start preference itself lives. So every
; removal below sits behind $UninstallIsUpdate.
;
; Auto-start is the one that would NOT be permanent, and only since 2026-09-06: the app
; re-asserts the Run entry on every start when the preference says on
; (ensureAutoStartMatchesPreference in electron/main.ts, which replaced the old one-shot
; marker). Removing it mid-update would still be wrong — the counter would not come back
; up if it were rebooted before the next start, and the preference file that drives the
; repair is in the same folder — but it would no longer be lost for good.
;
; The flag is read off the command line rather than through electron-builder's own
; ${isUpdated}: it is the same `--updated` that installUtil.nsh promises, and reading it
; here keeps this file standing on its own instead of on an internal define.

; $APPDATA and $LOCALAPPDATA mean the CURRENT user's folders — but an all-users
; uninstall runs with the shell context set to "all", where the same two variables point
; at ProgramData and every path below would be wrong. electron-builder's uninstaller.nsh
; flips the context exactly this way before it touches app data.
!macro useUserFolders
  ${If} $installMode == "all"
    SetShellVarContext current
  ${EndIf}
!macroend

!macro restoreFolders
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
!macroend

; ── Stop the embedded PostgreSQL ─────────────────────────────────────────────
;
; Runs on the update path too, unlike everything else here: postgres.exe lives in
; $INSTDIR\resources\pgsql\bin, which is being emptied either way.
;
; electron-builder does not reliably stop it. CHECK_APP_RUNNING only reaches postgres.exe
; on its PowerShell branch, which matches every process whose path is under $INSTDIR;
; where PowerShell is missing or its execution policy is Restricted it falls back to
; `taskkill /IM AbeerSuite.exe` and nothing more — and a live postgres.exe then holds
; files open so `RMDir /r $INSTDIR` leaves half the program folder behind.
;
; `pg_ctl stop -m fast` is the same graceful stop the app uses when it quits
; (stopEmbeddedPostgres in electron/postgresManager.ts): the server closes its files
; instead of being killed mid-write.
!macro stopEmbeddedPostgres
  Push $0
  Push $1

  !insertmacro useUserFolders
  StrCpy $1 "$APPDATA\${APPDATA_DIR_NAME}\pgdata"
  !insertmacro restoreFolders

  ${If} ${FileExists} "$INSTDIR\resources\pgsql\bin\pg_ctl.exe"
  ${AndIf} ${FileExists} "$1\postmaster.pid"
    !insertmacro sayStep "Stopping the local database..."
    nsExec::Exec '"$INSTDIR\resources\pgsql\bin\pg_ctl.exe" stop -D "$1" -m fast -t 20'
    Pop $0
    ${If} $0 != 0
      ; A crashed cluster, a stale postmaster.pid, anything. Kill what is running OUT OF
      ; $INSTDIR — the same test electron-builder itself uses. Never `taskkill /IM
      ; postgres.exe`: a shop PC may run an unrelated PostgreSQL and that would stop it.
      DetailPrint "pg_ctl stop returned $0 - stopping anything still running from the program folder."
      nsExec::Exec `"${PS_EXE}" -NoProfile -ExecutionPolicy Bypass -C "Get-CimInstance -ClassName Win32_Process | ? { $$_.Path -and $$_.Path.StartsWith('$INSTDIR', 'CurrentCultureIgnoreCase') } | % { Stop-Process -Id $$_.ProcessId -Force }"`
      Pop $0
    ${EndIf}
  ${EndIf}

  Pop $1
  Pop $0
!macroend

; ── The counter's own folder, minus the keep-list ────────────────────────────
;
; Deliberately not electron-builder's `deleteAppDataOnUninstall`: that flag is
; all-or-nothing and would take the hardware settings with it.
!macro wipeCounterData
  Push $0
  !insertmacro useUserFolders

  ${If} ${FileExists} "$APPDATA\${APPDATA_DIR_NAME}\*.*"
    !insertmacro sayStep "Removing this counter's data..."

    StrCpy $0 "0"
    ${If} ${FileExists} "$APPDATA\${APPDATA_DIR_NAME}\${KEEP_ON_UNINSTALL}"
      CopyFiles /SILENT "$APPDATA\${APPDATA_DIR_NAME}\${KEEP_ON_UNINSTALL}" "$PLUGINSDIR"
      StrCpy $0 "1"
    ${EndIf}

    RMDir /r "$APPDATA\${APPDATA_DIR_NAME}"

    ${If} $0 == "1"
      CreateDirectory "$APPDATA\${APPDATA_DIR_NAME}"
      CopyFiles /SILENT "$PLUGINSDIR\${KEEP_ON_UNINSTALL}" "$APPDATA\${APPDATA_DIR_NAME}"
      Delete "$PLUGINSDIR\${KEEP_ON_UNINSTALL}"
      DetailPrint "Counter data removed, hardware settings kept (${KEEP_ON_UNINSTALL})."
    ${Else}
      ; No hardware was ever set up on this PC, so there is nothing to put back and no
      ; reason to leave an empty folder behind.
      DetailPrint "Counter data removed."
    ${EndIf}
  ${EndIf}

  !insertmacro restoreFolders
  Pop $0
!macroend

; ── The updater's staging folder ─────────────────────────────────────────────
;
; counter-teardown.ps1 drops the Defender exclusion for this path but has never deleted
; the folder, and nothing else did either.
!macro removeUpdaterCache
  !insertmacro useUserFolders
  ${If} ${FileExists} "${UPDATER_CACHE_DIR}\*.*"
    !insertmacro sayStep "Removing the downloaded update files..."
    RMDir /r "${UPDATER_CACHE_DIR}"
  ${EndIf}
  !insertmacro restoreFolders
!macroend

; ── The auto-start entry ─────────────────────────────────────────────────────
;
; The app writes this itself, not the installer, so electron-builder does not know it
; exists and its uninstaller never touches it.
;
; Two passes, because neither alone is complete:
;   1. By NAME — catches the entry even if its target has been repointed somewhere else.
;   2. By TARGET — anything under Run pointing inside $INSTDIR is ours whatever it is
;      called, so renaming the app later cannot quietly start leaving entries behind.
;
; Reaches only the user running the uninstaller. On an all-users install another Windows
; user who also ran the app keeps their own copy — there is no clean way to reach it
; from here, and a Run entry pointing at a missing exe does nothing.
!macro removeAutoStart
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5

  DeleteRegValue HKCU "${AUTOSTART_REG_KEY}" "${AUTOSTART_REG_VALUE}"
  DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "${AUTOSTART_REG_VALUE}"

  ; Enumeration restarts from 0 after every delete: removing a value shifts each index
  ; above it down by one, so carrying on would step straight over the next entry. Each
  ; pass deletes at most one, which is also why this terminates.
  StrLen $3 "$INSTDIR"
  StrCpy $4 1
  ${While} $4 == 1
    StrCpy $4 0
    StrCpy $0 0
    ${Do}
      ClearErrors
      EnumRegValue $1 HKCU "${AUTOSTART_REG_KEY}" $0
      ${If} ${Errors}
      ${OrIf} $1 == ""
        ${ExitDo}
      ${EndIf}
      ReadRegStr $2 HKCU "${AUTOSTART_REG_KEY}" "$1"
      ; Electron writes `"<exe>" --hidden`, so the path starts one character in. Offset 0
      ; is tried as well, in case it is ever written unquoted.
      StrCpy $5 $2 $3
      ${If} $5 != "$INSTDIR"
        StrCpy $5 $2 $3 1
      ${EndIf}
      ${If} $5 == "$INSTDIR"
        DetailPrint "Removing Windows startup entry: $1"
        DeleteRegValue HKCU "${AUTOSTART_REG_KEY}" "$1"
        DeleteRegValue HKCU "${AUTOSTART_APPROVED_KEY}" "$1"
        StrCpy $4 1
        ${ExitDo}
      ${EndIf}
      IntOp $0 $0 + 1
    ${Loop}
  ${EndWhile}

  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend

; ── Firewall rule and Defender exclusions ────────────────────────────────────
;
; The mirror of ensureCounterSetup. Both were added with administrator rights, so
; removing them needs them too.
!macro removeCounterSetup
  Push $0
  File "/oname=$PLUGINSDIR\counter-teardown.ps1" "${NSH_DIR}\counter-teardown.ps1"

  ; Check first, exactly as the install side does. Without this every uninstall
  ; raised a UAC prompt even on a PC that had nothing of ours to take off it.
  nsExec::Exec '"${PS_EXE}" ${TEARDOWN_ARGS} -CheckOnly'
  Pop $0

  ${If} $0 == 0
    DetailPrint "No firewall rule or Defender exclusions to remove."
  ${ElseIfNot} ${Silent}
    !insertmacro sayStep "Removing AbeerSuite's firewall rule and Defender exclusions..."
    ; Elevates, because both were added with administrator rights. Declining the prompt
    ; leaves two harmless entries behind rather than blocking the uninstall.
    ; No Pop after this: ExecShellWait pushes nothing on the stack and has no exit-code
    ; form at all (unlike nsExec::Exec below). Popping here used to take back the $0 this
    ; macro saved on entry, print it as an "exit code", and leave the stack one short.
    ExecShellWait "runas" "${PS_EXE}" '${TEARDOWN_ARGS}'
    DetailPrint "Firewall/Defender cleanup finished."
  ${Else}
    ; Silent, so `runas` must never be reached: it would raise a UAC prompt with nobody
    ; there to answer and ExecShellWait has no timeout.
    ;
    ; This used to give up at that point. It no longer does, because a silent uninstall
    ; is normally ALREADY elevated — an all-users install records
    ; "...\Uninstall AbeerSuite.exe" /allusers — and then the script needs no prompt at
    ; all. nsExec runs it in place: it never shows a window and never prompts, so it
    ; cannot hang, and counter-teardown.ps1 is written to report its problems and still
    ; exit 0. So when the rights are there the PC gets cleaned, and when they are not the
    ; attempt costs a logged failure and nothing else — strictly better than skipping.
    ;
    ; Not UserInfo::GetAccountType: that answers "is this user an administrator", which is
    ; still true for an admin running WITHOUT elevation, so it would claim rights we do
    ; not have. Trying and reading the result is the honest test.
    nsExec::Exec '"${PS_EXE}" ${TEARDOWN_ARGS}'
    Pop $0
    DetailPrint "Silent uninstall - firewall/Defender cleanup attempted in place (exit $0)."
  ${EndIf}

  Pop $0
!macroend

!macro customUnInstall
  ; Declared here, not at file scope: this file is compiled into the installer as well,
  ; and a variable only the uninstaller uses would draw a "never set" warning out of
  ; every build. Inside the section is where electron-builder's own uninstaller.nsh
  ; declares $isDeleteAppData, for the same reason.
  Var /GLOBAL UninstallIsUpdate

  Push $R0
  Push $R1
  ClearErrors
  ${GetParameters} $R0
  ${GetOptions} $R0 "--updated" $R1
  ${If} ${Errors}
    StrCpy $UninstallIsUpdate "0"
  ${Else}
    StrCpy $UninstallIsUpdate "1"
  ${EndIf}
  ClearErrors
  Pop $R1
  Pop $R0

  ; First either way — it holds files in the folder that is about to be emptied.
  !insertmacro stopEmbeddedPostgres

  ${If} $UninstallIsUpdate == "1"
    DetailPrint "Update in progress - keeping the counter's data, the update files, auto-start and the firewall rule."
  ${Else}
    !insertmacro wipeCounterData
    !insertmacro removeUpdaterCache
    !insertmacro removeAutoStart
    !insertmacro removeCounterSetup
  ${EndIf}
!macroend
