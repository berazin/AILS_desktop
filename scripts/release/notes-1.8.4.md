# AILS Developer 1.8.4

- Fix updates cancelling with `EBUSY` while reading `update-sessions/.../status.json`. The installer now publishes progress without exclusively opening the status file, including when updating from older AILS versions.
- Retry temporary status-file locks for a bounded period while keeping malformed or mismatched update sessions as errors.
- Retain the 1.8.3 improvements to FFmpeg/FFprobe reuse, update verification speed, user-state migration, and failed-update recovery.

This release is the developer edition for Windows x64. It includes the serverless developer login and ChatGPT study chatbot fixes. A ChatGPT connection is required for actual AI responses.
