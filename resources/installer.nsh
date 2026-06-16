!macro customCheckAppRunning
  ; Kill the entire process tree before install/upgrade.
  ; /T = kill child processes (node.exe, MCP servers), /F = force
  ; Only during install pass; uninstaller pass is a no-op.
  !ifndef BUILD_UNINSTALLER
  nsExec::Exec 'taskkill /T /F /IM "OMAGT.exe"'
  Pop $R0
  ; Kill orphaned node.exe from install directory via PowerShell (wmic deprecated on Win 11)
  ; $$ escapes dollar sign in NSIS so PowerShell receives $_ correctly
  nsExec::Exec 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $$_.Name -eq ''node.exe'' -and $$_.ExecutablePath -like ''*OMAGT*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  Pop $R0
  ; Wait for processes to exit and release file locks
  Sleep 3000
  !endif
!macroend

Function OMAShowLegacyUninstallHelp
  Exch $0
  DetailPrint `Legacy OMAGT uninstall failed: $0`

  ; ── installer pass (BUILD_UNINSTALLER is NOT defined) ──────────────
  !ifndef BUILD_UNINSTALLER
    MessageBox MB_OK|MB_ICONEXCLAMATION "OMAGT could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nNext steps:$\r$\n1. Close all OMAGT windows.$\r$\n2. Run:$\r$\n$EXEDIR\OMAGT-Legacy-Cleanup.cmd$\r$\n3. Start this installer again.$\r$\n$\r$\nAdd -RemoveAppData to the cleanup tool only if you also want to clear local settings."
  !endif

  ; ── uninstaller pass (BUILD_UNINSTALLER is defined) ────────────────
  !ifdef BUILD_UNINSTALLER
    MessageBox MB_OK|MB_ICONEXCLAMATION "OMAGT could not remove the previously installed version.$\r$\n$\r$\nThis usually means the legacy Windows uninstaller is damaged.$\r$\n$\r$\nPlease close OMAGT, delete:$\r$\n$LOCALAPPDATA\Programs\OMAGT$\r$\nand then run this installer again.$\r$\n$\r$\nLocal settings may remain in AppData by design."
  !endif

  Pop $0
FunctionEnd

; ─────────────────────────────────────────────────────────────────────
; Uninstall check hooks
; electron-builder calls these when the old-version uninstall returns
; a non-zero exit code.  We show a helpful message instead of the
; default cryptic "uninstall failed" dialog.
; ─────────────────────────────────────────────────────────────────────

!macro customUnInstallCheck
  ${if} $R0 != 0
    Push $R0
    Call OMAShowLegacyUninstallHelp
  ${endif}
!macroend

!macro customUnInstallCheckCurrentUser
  ${if} $R0 != 0
    Push $R0
    Call OMAShowLegacyUninstallHelp
  ${endif}
!macroend
