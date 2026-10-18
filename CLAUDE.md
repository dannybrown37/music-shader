# Music Shader: notes for coding agents

Browser music visualizer: TypeScript + raw WebGL2 + Vite. See README.md, ARCHITECTURE.md, TWEAKING.md.

## Commands

- `just check`: typecheck + eslint + vitest (run before ending a turn; prek runs the same)
- `just dev`: dev server on 127.0.0.1:5173; reachable from Windows Chrome via WSL localhost forwarding
- `just shot ...`: headless SwiftShader stills / contact sheets / export test against the dev server.
  The only way to *see* a shader change from WSL (no GPU here). See the header of tools/shot.ts.
- `just analyze <mp3> --png out/x.png`: analysis strip chart for tuning detectors

## Conventions

- Imports use explicit `.ts` extensions (Node runs tools/*.ts with type stripping; no enums or parameter properties).
- `src/analysis/` must stay DOM-free: it runs in Node tests and in a Web Worker.
- Offline and live analysis share detector constants via `src/analysis/bands.ts`. Change both behaviours together.
- Analyses are cached in IndexedDB: bump `ANALYSIS_VERSION` (`src/analysis/types.ts`) whenever analysis output changes.
- Shaders: linear HDR out, dark frames with bright structure; scene uniforms come from `common.glsl`;
  scene params are `uniform float p_<key>` declared in the scene and listed in `scenes/index.ts`.
- Settings are plain JSON (`src/settings.ts`); every slider's range lives there.
- Tests: vitest with `it.each` tables; synthetic audio from `src/analysis/test-signals.ts`.
- `out/` is scratch output (gitignored).
