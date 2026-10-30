# AILS Developer 1.8.2

- Open supported external files in the editable AILS workspace and reuse the existing Electron window.
- Start the workspace and backend concurrently, load optional features when needed, and use a current optimized frontend build for normal development launches.
- Separate application composition, feature services, and UI state to make the desktop easier to maintain.
- Start PDF study history only after a storage folder is saved, refresh Home after folder changes, and suppress expected cancellation warnings.
- Defer local model and OCR inspection until the corresponding settings are used.
- Correct RTF body parsing and preserve existing document editing and save behavior.
- Include lazy evidence and grading modules in the packaged backend and fix bootstrap update credential import from the packaged app.
- Fix the study chatbot request failure caused by an HTTP method keyword colliding with service routing arguments.
- Allow arbitrary local developer login without an AILS server, and route cloud AI through the user's ChatGPT connection. Real ChatGPT sign-in is still required.

This release is the developer edition for Windows x64. Startup latency depends on the machine and document; this release does not guarantee opening every file within one second.
