!macro AILS_DEFINE_FFMPEG_REUSE_FUNCTIONS
!ifndef BUILD_UNINSTALLER
Function AilsCacheInstalledFfmpeg
  ReadRegStr $0 SHCTX "Software\${APP_GUID}" InstallLocation
  ${If} $0 == ""
    StrCpy $0 "$INSTDIR"
  ${EndIf}
  InitPluginsDir
  File /oname=$PLUGINSDIR\reuse-ffmpeg.ps1 "${BUILD_RESOURCES_DIR}\reuse-ffmpeg.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\reuse-ffmpeg.ps1" -SourceDir "$0\resources\backend\AILSBackend\tools\ffmpeg" -DestinationDir "$PLUGINSDIR\ails-installed-ffmpeg"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ails_ffmpeg_cache_done
  DetailPrint "$1"
  ${IfNot} ${Silent}
    MessageBox MB_ICONSTOP "The installed FFmpeg could not be preserved. The existing installation has not been removed."
  ${EndIf}
  SetErrorLevel 27
  Quit
  ails_ffmpeg_cache_done:
FunctionEnd

Function AilsReuseInstalledFfmpeg
  InitPluginsDir
  File /oname=$PLUGINSDIR\reuse-ffmpeg.ps1 "${BUILD_RESOURCES_DIR}\reuse-ffmpeg.ps1"
  IfFileExists "$PLUGINSDIR\ails-installed-ffmpeg\bin\ffmpeg.exe" 0 ails_ffmpeg_reuse_cache
  IfFileExists "$PLUGINSDIR\ails-installed-ffmpeg\bin\ffprobe.exe" 0 ails_ffmpeg_reuse_cache
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\reuse-ffmpeg.ps1" -SourceDir "$PLUGINSDIR\ails-installed-ffmpeg" -DestinationDir "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg"'
  Goto ails_ffmpeg_reuse_result
  ails_ffmpeg_reuse_cache:
  # This cache survives a cancelled/failed staged installation. The backend
  # also looks here when resolving already available FFmpeg executables.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\reuse-ffmpeg.ps1" -SourceDir "$LOCALAPPDATA\AILS\tools\ffmpeg" -DestinationDir "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg"'
  ails_ffmpeg_reuse_result:
  Pop $0
  Pop $1
  DetailPrint "$1"
  StrCmp $0 "0" ails_ffmpeg_reuse_done
  SetErrorLevel 28
  Quit
  ails_ffmpeg_reuse_done:
FunctionEnd

Function AilsRememberFfmpeg
  # Preserve a verified download before staging can be cancelled or rolled back.
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\reuse-ffmpeg.ps1" -SourceDir "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg" -DestinationDir "$LOCALAPPDATA\AILS\tools\ffmpeg"'
  Pop $0
  Pop $1
  DetailPrint "$1"
  # The installed pair is already verified. A read-only cache must not undo it.
  StrCmp $0 "0" ails_ffmpeg_remember_done
  DetailPrint "FFmpeg is installed, but could not be saved for a future update."
  ails_ffmpeg_remember_done:
FunctionEnd
!endif
!macroend
