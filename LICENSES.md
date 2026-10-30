# Third-party licences

The game is MIT licensed (see `LICENSE`). Only MIT, Apache-2.0, CC0 or OFL third-party code and assets are allowed.

## Shipped in `dist/`

| Package | Licence | Use |
| --- | --- | --- |
| three (three.js) | MIT | 3D rendering, bundled by Vite |

## Development only (not shipped)

| Package | Licence |
| --- | --- |
| vite | MIT |
| typescript | Apache-2.0 |
| vitest | MIT |
| fast-check | MIT |
| @playwright/test | Apache-2.0 |
| eslint, @eslint/js | MIT |
| typescript-eslint | MIT |
| globals | MIT |
| prettier | MIT |
| concurrently | MIT |
| @types/three, @types/node | MIT |

## Art, audio and fonts

- All art is original. The icons are generated from original vector shapes by `scripts/make-icons.mjs`.
- All audio is synthesized at run time with Web Audio. The game ships no audio files.
- The game uses system monospace fonts only. It ships no font files.
