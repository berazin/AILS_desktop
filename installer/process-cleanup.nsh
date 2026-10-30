!macro AILS_DEFINE_PROCESS_CLEANUP_FUNCTIONS
!ifndef BUILD_UNINSTALLER
Function AilsStopInstalledProcesses
  InitPluginsDir
  File /oname=$PLUGINSDIR\process-cleanup.ps1 "${BUILD_RESOURCES_DIR}\process-cleanup.ps1"
  ReadRegStr $2 SHCTX "Software\${APP_GUID}" InstallLocation
  StrCmp $2 "" 0 +2
  StrCpy $2 "$INSTDIR"
  ails_process_stop_run:
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\process-cleanup.ps1" -Phase Stop -InstallDir "$2"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ails_process_stop_next
  DetailPrint "$1"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "AILS background processes could not be stopped. Setup has not replaced any files."
  ${EndIf}
  SetErrorLevel 27
  Quit
  ails_process_stop_next:
  StrCmp $2 "$INSTDIR" ails_process_stop_done
  StrCpy $2 "$INSTDIR"
  Goto ails_process_stop_run
  ails_process_stop_done:
FunctionEnd
!else
Function un.AilsPrepareRemoval
  InitPluginsDir
  File /oname=$PLUGINSDIR\process-cleanup.ps1 "${BUILD_RESOURCES_DIR}\process-cleanup.ps1"
  File /oname=$PLUGINSDIR\user-state.ps1 "${BUILD_RESOURCES_DIR}\user-state.ps1"
  File /oname=$PLUGINSDIR\reuse-ffmpeg.ps1 "${BUILD_RESOURCES_DIR}\reuse-ffmpeg.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\process-cleanup.ps1" -Phase Stop -InstallDir "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 "0" 0 ails_uninstall_prepare_failed
  ${IfNot} ${isUpdated}
    # Keep private settings/drafts outside the program directory before removal.
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\user-state.ps1" -Phase Backup -InstallDir "$INSTDIR" -BackupBase "$LOCALAPPDATA\AILS\backups"'
    Pop $0
    Pop $1
    StrCmp $0 "0" 0 ails_uninstall_prepare_failed
    # A reinstall can reuse the tools even after the installation is deleted.
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\reuse-ffmpeg.ps1" -SourceDir "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg" -DestinationDir "$LOCALAPPDATA\AILS\tools\ffmpeg"'
    Pop $0
    Pop $1
    ${If} $0 != "0"
      DetailPrint "FFmpeg cache could not be saved: $1"
    ${EndIf}
  ${EndIf}
  Return
  ails_uninstall_prepare_failed:
  DetailPrint "$1"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "AILS could not prepare a safe uninstall. The installation and user data have been retained. $1"
  ${EndIf}
  SetErrorLevel 27
  Quit
FunctionEnd
!endif
!macroend

!macro customUnInstall
  Call un.AilsPrepareRemoval
!macroend

!macro customRemoveFiles
  # Registry entries and shortcuts are removed by NSIS only after this succeeds.
  SetOutPath "$TEMP"
  ${If} ${isUpdated}
    # Preserve electron-builder's rollback when an older updater uses the
    # normal uninstall path instead of the staged update protocol.
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.atomicRMDir
    Pop $R0
    ${If} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      SetErrorLevel 28
      Quit
    ${EndIf}
    RMDir /r "$INSTDIR"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\process-cleanup.ps1" -Phase Verify -InstallDir "$INSTDIR"'
  ${Else}
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\process-cleanup.ps1" -Phase Remove -InstallDir "$INSTDIR"'
  ${EndIf}
  Pop $0
  Pop $1
  StrCmp $0 "0" ails_uninstall_remove_done
  DetailPrint "$1"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "AILS files could not be completely removed. Close applications using this installation and retry. $1"
  ${EndIf}
  SetErrorLevel 28
  Quit
  ails_uninstall_remove_done:
!macroend
