!define AILS_FFMPEG_URL "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
!define AILS_FFMPEG_SHA256_URL "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256"

!include "${BUILD_RESOURCES_DIR}\reuse-ffmpeg.nsh"
!include "${BUILD_RESOURCES_DIR}\staged-installer.nsh"
!include "${BUILD_RESOURCES_DIR}\user-state.nsh"
!include "${BUILD_RESOURCES_DIR}\process-cleanup.nsh"

!macro customInstall
  Call AilsInstallFfmpeg
  Call AilsRestoreUserState
!macroend

!macro AILS_DEFINE_FFMPEG_FUNCTION
!ifndef BUILD_UNINSTALLER
Function AilsInstallFfmpeg
  IfFileExists "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg\bin\ffmpeg.exe" 0 ails_ffmpeg_try_reuse
  IfFileExists "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg\bin\ffprobe.exe" ails_ffmpeg_done

  ails_ffmpeg_try_reuse:
  Call AilsReuseInstalledFfmpeg
  IfFileExists "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg\bin\ffmpeg.exe" 0 ails_ffmpeg_download
  IfFileExists "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg\bin\ffprobe.exe" ails_ffmpeg_done

  ails_ffmpeg_download:
  DetailPrint "Downloading FFmpeg Essentials..."
  inetc::get /USERAGENT "AILS Installer" /RESUME "" /CAPTION "AILS Setup" /POPUP "Downloading FFmpeg (about 105 MB)..." "${AILS_FFMPEG_URL}" "$PLUGINSDIR\ffmpeg.zip" /END
  Pop $0
  StrCmp $0 "OK" ails_ffmpeg_checksum
  MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "FFmpeg download failed: $0. Retry, skip FFmpeg, or abort setup." IDRETRY ails_ffmpeg_download IDIGNORE ails_ffmpeg_done
  Abort

  ails_ffmpeg_checksum:
  inetc::get /USERAGENT "AILS Installer" /CAPTION "AILS Setup" /POPUP "Verifying FFmpeg download..." "${AILS_FFMPEG_SHA256_URL}" "$PLUGINSDIR\ffmpeg.zip.sha256" /END
  Pop $0
  StrCmp $0 "OK" ails_ffmpeg_extract
  MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "FFmpeg checksum download failed: $0. Retry, skip FFmpeg, or abort setup." IDRETRY ails_ffmpeg_download IDIGNORE ails_ffmpeg_done
  Abort

  ails_ffmpeg_extract:
  File /oname=$PLUGINSDIR\install-ffmpeg.ps1 "${BUILD_RESOURCES_DIR}\install-ffmpeg.ps1"
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-ffmpeg.ps1" -ArchivePath "$PLUGINSDIR\ffmpeg.zip" -ChecksumPath "$PLUGINSDIR\ffmpeg.zip.sha256" -Destination "$INSTDIR\resources\backend\AILSBackend\tools\ffmpeg"'
  Pop $0
  Pop $1
  StrCmp $0 "0" ails_ffmpeg_remember
  DetailPrint "$1"
  MessageBox MB_ABORTRETRYIGNORE|MB_ICONEXCLAMATION "FFmpeg verification or extraction failed. Retry, skip FFmpeg, or abort setup." IDRETRY ails_ffmpeg_download IDIGNORE ails_ffmpeg_done
  Abort

  ails_ffmpeg_remember:
  Call AilsRememberFfmpeg
  ails_ffmpeg_done:
FunctionEnd
!insertmacro AILS_DEFINE_FFMPEG_REUSE_FUNCTIONS
!endif
!macroend
