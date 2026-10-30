# Developer release

Run from the desktop directory, only after an explicit release request:

```powershell
.\.venv\Scripts\python.exe scripts/release/build_electron_release.py --edition developer
.\.venv\Scripts\python.exe scripts/release/verify_release.py <output-directory>
node scripts/release/verify_renderer.cjs <output-directory>
.\.venv\Scripts\python.exe scripts/release/publish_release.py <output-directory> --notes <release-notes-file>
```

Update `ails-frontend/package.json` and the root version entries in
`ails-frontend/package-lock.json` together before building.

This entry point packages developer NSIS only. It uses the existing Media
Foundation and Paperback native executables; their source trees are not restored
or rebuilt. The Paperback runtime is checked with an actual text document and
its hash is recorded in the package. Native dependency license texts accompany it.

Installer compression defaults to level 3; `ELECTRON_BUILDER_COMPRESSION_LEVEL`
can override it. `--package-existing <output-directory>` reruns only installer
assembly after checking the staged edition and version. It preserves previous
archives under a different name so interrupted archives cannot be reused.
The BCJ filter is mandatory: automatic ARM64 filters from recent 7-Zip versions
are unsupported by the bundled NSIS decoder.

Verification uses isolated runtime data and an isolated fake installation. The
installer must reach `ready`, then cancellation must preserve the old executable.
It does not commit an update to the user's installed application. The renderer
test launches the actual packaged Electron executable with a separate profile.

Publishing creates a draft in `berazin/AILS_desktop`, uploads the five verified
assets, checks every GitHub SHA-256 and size, and then publishes it as latest.
Existing tags are never replaced. A failed upload remains a draft for inspection.
