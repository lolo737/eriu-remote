# Ériu Remote Access — Build Repo

Builds the host agent Electron app for Windows 10/11 and macOS (Catalina+).
Viewers use the browser-based page at https://eriu.tech/remote/ — no download needed.

## How builds work

Push a version tag → GitHub Actions builds Windows + macOS → files appear in Releases.

```bash
git tag v1.0.0
git push origin v1.0.0
```

That's it. ~10 minutes later, two files appear in the GitHub Release:
- `Eriu Remote Access Setup 1.0.0.exe` — Windows 10/11 x64 installer
- `Eriu Remote Access-1.0.0.dmg` — macOS Catalina+ (Intel + Apple Silicon)

## Repo structure

```
.github/workflows/
  build-release.yml     ← CI pipeline (Windows + macOS builds + release)

host-agent/
  main.js               ← Electron main process (screen capture, input injection)
  preload.js            ← IPC bridge (contextIsolation)
  renderer.js           ← Host UI (WebSocket, WebRTC, accept/deny UI)
  index.html            ← Host UI page
  package.json          ← electron-builder config
  assets/
    entitlements.mac.plist  ← macOS hardened runtime entitlements
    icon.icns           ← macOS icon (add before first build)
    icon.ico            ← Windows icon (add before first build)

signaling-server/       ← Deployed separately (see eriu-signal repo)
```

## Before first build — add icons

electron-builder needs platform icons. Without them the build succeeds but
uses Electron's default icon (looks unprofessional).

**macOS** — `icon.icns`: 1024×1024 PNG converted to .icns
```bash
# On a Mac:
mkdir icon.iconset
sips -z 1024 1024 your-logo.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o host-agent/assets/icon.icns
```

**Windows** — `icon.ico`: multi-size ICO file
```bash
# Using ImageMagick:
convert your-logo.png -resize 256x256 host-agent/assets/icon.ico
```

Or use https://convertico.com for a quick online conversion.

## Code signing (optional but recommended)

Without signing:
- **macOS**: Gatekeeper warning on first run ("cannot verify developer")
  → right-click → Open → Open anyway
- **Windows**: SmartScreen warning ("unknown publisher")
  → More info → Run anyway

To sign properly, add these secrets in GitHub repo settings
(Settings → Secrets → Actions):

| Secret | What it is |
|---|---|
| `MAC_CERTS` | Base64-encoded .p12 certificate from Apple Developer account |
| `MAC_CERTS_PASSWORD` | Password for the .p12 file |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-character team ID from developer.apple.com |

Without these secrets, the CI still builds successfully — signing steps
are skipped gracefully. Users just see the "unknown developer" warning.

## Local build (on your Mac)

```bash
cd host-agent
npm install
npm run build:mac     # builds DMG for Intel + Apple Silicon
npm run build:win     # cross-compiles Windows installer (needs Wine or run on Windows)
```

Output goes to `host-agent/dist/`.

## Security issues to fix before client release

See the pen test report. Three HIGH priority issues:

1. **Rate limit PIN attempts** — signaling server needs per-IP throttling
2. **WSS enforced** — renderer.js now uses wss://signal.eriu.tech ✅ fixed
3. **Validate input events** — renderer.js needs whitelist check before robotjs injection

## Versioning

Use semantic versioning: `v1.0.0`, `v1.0.1`, `v1.1.0` etc.
The version in `package.json` should match the git tag.

## Where the viewer lives

The viewer (what clients open in their browser) is at:
`https://eriu.tech/remote/`

It's a static HTML page — no download, no install. Clients just open the URL,
enter the 6-digit PIN from your host agent, and connect.
