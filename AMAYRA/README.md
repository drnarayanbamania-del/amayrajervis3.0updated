# AMAYRA — Replica / Source Recovery

A private 3D AI desktop companion powered by **each user's own Gemini API key**.
Electron 43 + React 19 + Three.js (PMX "evelyn" model + ANIMA GIRL video states)
renderer, a Node/Express + WebSocket backend with a full cognitive runtime
(attention, initiative, autonomous mind, structured memory, goals, skills,
screen vision, API hub), and a PyInstaller-frozen Python desktop-control agent.

## Provenance of this tree

Recovered from the installed app (`C:\Program Files\AMAYRA`) on this machine:

| Piece | Status |
| --- | --- |
| `electron/` main, preload, splash, afterPack, launcher.cs | **Original** (shipped as plain files) |
| `server.ts`, `server_memory.ts`, `server_paths.ts`, `server_screenVision.ts`, `cognition/*`, `api_hub/*` (33 files) | **Original** — recovered verbatim from `dist/server.cjs.map` `sourcesContent` |
| `src/lib/memoryTypes.ts`, `cognition/types.ts`, `api_hub/types.ts`, `cognition/index.ts`, `api_hub/index.ts` | **Reconstructed** from exact usage (types are erased by bundling; names/shapes/union literals mirror every usage site) |
| `dist/` renderer bundles + `assets/` (videos, PMX model, textures) + `build/` icons | **Original binaries** (renderer TS/TSX source was not shipped and has no maps) |
| `agent_dist/amayra-agent/` | **Original frozen Python agent** (PyInstaller bundle copied as-is) |
| `node_modules/` | Copied from the installed app (exact dependency versions) |

## Layout

```
server.ts                 Node backend: Express + WS + Gemini Live + cognition wiring
server_memory.ts          Legacy memory cards + Gemini-driven consolidation
server_paths.ts           Data-dir & Gemini key resolution (secrets.json)
server_screenVision.ts    Screen capture → Gemini Live frame injection pipeline
cognition/                Cognitive runtime (attention, initiative, autonomous mind,
                          structured memory, goals, skills, safety, tools, planner)
api_hub/                  Public-API capability registry + verified declarative adapters
src/                      Renderer source tree (only shared types recovered)
electron/                 Main process, preload, splash, packaging hooks
dist/                     Built renderer + bundled server (shipped bundle)
assets/                   idle/talking/thinking videos, evelyn PMX model + textures
build/                    Icons
agent_dist/amayra-agent/   Frozen Python desktop agent (FastAPI on 127.0.0.1:8765)
```

## Scripts

```bash
npm install                # (already vendored via node_modules copy in this tree)
npm run build:server       # esbuild server.ts -> dist/server.cjs
npm run dev                # build server, then run Electron (dev mode)
npm run dist               # build + electron-builder NSIS installer (AMAYRA-Setup-1.0.1.exe)
npm run dist:dir           # unpacked win-unpacked output for quick testing
```

The Electron main process launches `dist/server.cjs` with
`ELECTRON_RUN_AS_NODE=1`, sets `AMAYRA_DATA_DIR` to the per-user data folder and
`AMAYRA_AGENT_EXE` to the frozen agent, shows a splash while the backend boots,
then loads `http://localhost:3000`.

## Notes

- The original development machine path (`C:\Users\MSI\...`) is referenced by
  `findPythonRuntime()` in `server.ts`; adjust `AMAYRA_PYTHON` if you want the
  source-run agent in development.
- Renderer TS/TSX under `src/` was never shipped with the installer; only the
  compiled bundles in `dist/assets/` exist. If you need to modify UI code, edit
  the bundles directly or rebuild `src/` against them.
- Packaging requires `build/AMAYRA-launcher.exe` (compiled from
  `electron/launcher.cs`); `afterPack.cjs` swaps the Electron stub exe for the
  launcher and keeps the real runtime as `AMAYRA-runtime.exe`.
- Build the installer with `npm run dist:repack` (electron-builder over the
  prebuilt `dist/`). Plain `npm run dist` fails here because its
  `build:renderer` step needs the missing renderer source (root `index.html`).
- `@google/genai` MUST stay in `dependencies`. It briefly lived in
  `devDependencies`, so 1.0.2 installers shipped without it and the backend
  crashed on boot with `Cannot find module '@google/genai'` (the infamous
  "AMAYRA backend stopped (code 1)" dialog). Version 1.0.3 fixes this and
  persists backend stderr to `<userData>\logs\backend-stderr.log`.
