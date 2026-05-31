# Installer Assets

This folder holds optional bitmap images used by the NSIS Windows installer.
If the files are absent, Tauri falls back to its default installer appearance.

## Files

| File | Size | Used for |
|------|------|----------|
| `nsis-header.bmp` | 150×57 px | Header banner on every installer page |
| `nsis-sidebar.bmp` | 164×314 px | Left sidebar on the welcome / finish pages |

## Generating

Create the BMPs in any image editor (Figma, GIMP, Inkscape + ImageMagick).
Keep them simple: dark background (`#1a1918`), AgentForge wordmark in teal,
optional tagline in muted text.

```bash
# Convert a PNG to the exact BMP format NSIS expects
magick nsis-header.png -type TrueColor -compress None BMP3:nsis-header.bmp
magick nsis-sidebar.png -type TrueColor -compress None BMP3:nsis-sidebar.bmp
```
