# AgentForge Icons

`icon.svg` is the canonical source. All raster sizes are generated from it.

## Required files (referenced in `tauri.conf.json`)

| File | Size | Used for |
|------|------|----------|
| `32x32.png` | 32×32 px | Windows taskbar (small) |
| `128x128.png` | 128×128 px | Windows installer, app list |
| `128x128@2x.png` | 256×256 px | HiDPI / Retina displays |
| `icon.icns` | multi-res | macOS (generated but unused in Windows-only builds) |
| `icon.ico` | multi-res | Windows `.exe` embedded icon + NSIS installer |

## Regenerating from the SVG

### Option A — Tauri CLI (recommended, generates all formats)

```bash
# From repo root
npx @tauri-apps/cli icon src-tauri/icons/icon.svg
```

This writes all required files into `src-tauri/icons/` automatically.

### Option B — sharp CLI

```bash
npm i -g sharp-cli

sharp -i src-tauri/icons/icon.svg -o src-tauri/icons/32x32.png       resize 32
sharp -i src-tauri/icons/icon.svg -o src-tauri/icons/128x128.png     resize 128
sharp -i src-tauri/icons/icon.svg -o src-tauri/icons/128x128@2x.png  resize 256
```

For `.ico` and `.icns`, use [ImageMagick](https://imagemagick.org/):

```bash
# .ico (multi-resolution: 16, 32, 48, 64, 128, 256)
magick src-tauri/icons/icon.svg \
  -define icon:auto-resize=256,128,64,48,32,16 \
  src-tauri/icons/icon.ico

# .icns (macOS)
magick src-tauri/icons/icon.svg -resize 1024x1024 icon_1024.png
png2icns src-tauri/icons/icon.icns icon_1024.png
```

## Design notes

The mark shows three agent nodes in a branching tree:
- **Root node** (top centre) — teal filled circle with an A-caret cutout
- **Two child nodes** (bottom left/right) — slightly smaller, with inner dot
- **Connector lines** — teal gradient, rounded caps

Colours match the app's Nexus design system:
- Background: `#1a1918` (dark surface)
- Mark gradient: `#4f98a3` → `#01696f` (Hydra Teal)
