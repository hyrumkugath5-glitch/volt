# Building Volt as a downloadable app

Volt is an Electron app packaged with **electron-builder**. Icons live in
`build/` (regenerate with `npm run icon`; they're committed so CI doesn't need
to). Output goes to `dist/`.

## Windows (build locally)

```bash
npm ci
npm run dist:win
```

Produces in `dist/`:
| File | What |
|------|------|
| `Volt-1.0.0-Setup.exe` | installer (Start-menu + desktop shortcut, choose install dir) |
| `Volt-1.0.0-portable.exe` | single file, double-click to run, nothing installed |

> On a machine **without admin rights or Developer Mode**, electron-builder can't
> unpack its `winCodeSign` cache (it contains macOS symlinks). Work around it
> with `--config.win.signAndEditExecutable=false` — the app's own `.exe` then
> keeps the default Electron icon in Explorer, but every shortcut and the running
> window still show the Volt icon:
> ```bash
> CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis portable --config.win.signAndEditExecutable=false
> ```
> The proper fix is to build on a normal Windows box (or CI — see below), or turn
> on **Settings → System → For developers → Developer Mode**.

The builds are **unsigned**, so Windows SmartScreen shows "Windows protected your
PC" → click **More info → Run anyway**. To remove that, add an Authenticode
certificate (or free Azure Trusted Signing) — see electron-builder docs — and set
`CSC_LINK` / `CSC_KEY_PASSWORD`.

## macOS

**You can't build a Mac app from Windows** (needs `hdiutil`, `codesign`). Two
options:

1. **On a Mac:** `npm ci && npm run dist:mac` → `dist/Volt-1.0.0-arm64.dmg` and
   `-x64.dmg` (Intel). Unsigned, so users right-click the app → **Open** the
   first time (or run `xattr -cr /Applications/Volt.app`).
2. **GitHub Actions** (recommended): push a tag and let a macOS runner build it —
   see below.

To ship a Mac app with no Gatekeeper warning you need an **Apple Developer
account** ($99/yr): add `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`,
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as repo secrets and
electron-builder will sign + notarize automatically.

## GitHub Actions — build both at once

`.github/workflows/release.yml` builds Windows **and** macOS on every `v*` tag
and attaches the installers to a GitHub Release.

```bash
git tag v1.0.0
git push origin v1.0.0
```

Or run it by hand from the repo's **Actions** tab (uploads the files as workflow
artifacts, no release). Needs the project pushed to a GitHub repo.

## Linux (bonus)

```bash
npx electron-builder --linux         # -> dist/Volt-1.0.0-x86_64.AppImage
```
