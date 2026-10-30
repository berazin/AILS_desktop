# AILS Developer 1.8.3

- Reuse existing FFmpeg and FFprobe during normal installation and automatic updates. Preserve newly downloaded tools in the AILS cache so cancelled or failed updates do not download them again.
- Fix updates failing when unrelated historical backup folders contain Windows junctions. Keep validating the user data actually being migrated.
- Reduce repeated filesystem checks during update verification while retaining file size, SHA-256, duplicate-path and linked-path checks. Check cancellation while verifying files.
- Stop automatically reinstalling the same failed update after the previous version reopens. A manual update check can retry it.

This release is the developer edition for Windows x64. It includes the serverless developer login and ChatGPT study chatbot fixes from 1.8.2. A ChatGPT connection is required for actual AI responses.
