# Bigchx Make

[简体中文](README.zh-CN.md)

Bigchx Make is an agent skill for turning images into clean, printable, multicolor artwork. It combines original-image color analysis, limited-color separation, assistant-guided cartoon vector redraws, official Bambu filament matching, and printer-specific 3MF export.

This repository contains the installable `bigchx-make` skill package. The repository is maintained privately under the `bigchx` GitHub organization while the public website and release channel are managed separately.

## Capabilities

- Analyze dominant colors from the complete source image and report HEX values, pixel counts, percentages, and Bambu filament matches.
- Separate images into 2–36 layers with printable, detail, or mosaic goals, locked colors, transparency, and editable layer state.
- Guide an assistant-authored cartoon redraw with smooth Bezier paths, consistent outlines, limited flat colors, and transparent SVG/PNG previews.
- Recolor layers with official Bambu material and color identities.
- Export aligned, printer-specific multicolor 3MF/STL/SVG projects for flat prints.
- Create a continuous rectangular base plate with a raised Logo at explicitly defined Z heights.
- Generate laser (`LaserImageEngrave`) or blade (`KCPrintThenCut`) LAC projects from matching Bambu Suite templates, with confirmed machine, material, and size.

## Laser LAC projects

The package can build an editable Bambu Suite laser project from a verified `.lac` template. It inherits the template's machine, material, and `LaserImageEngrave` settings, replaces the image and previews, and removes template G-code so the old image cannot be engraved accidentally.

```sh
node scripts/laser-lac.mjs \
  --input logo.png \
  --template laser-template.lac \
  --machine "Bambu Lab H2C-10W" \
  --material "200g Kraft Paper" \
  --out job/logo-laser.lac
```

The result is an unsliced LAC project. Open it in Bambu Suite and re-slice before treating the generated G-code as valid for the new image.

For blade cutting, pass `--mode blade` with a blade template. Use `--width-mm` and `--height-mm` for the finished size; the script validates that the template process matches the selected mode.

## Quick start

Requirements: Node.js 22.12 or newer (Node 24 LTS recommended) and npm.

```sh
npm install --omit=dev
node scripts/run.mjs help
node scripts/run.mjs catalog
```

Example local workflow:

```sh
node scripts/run.mjs analyze --input photo.png --out job/colors.json
node scripts/run.mjs separate --input photo.png --config config.json --out job/separated
node scripts/run.mjs recolor --state job/separated/project.json.gz --assignments assignments.json --out job/recolored
node scripts/run.mjs export --state job/recolored/project.json.gz --printer A1 --out job/model
```

For an assistant-authored flat SVG:

```sh
node scripts/render-svg.mjs --input job/artwork.svg --out job/vector --size 1600
```

The renderer produces an editable source alongside `transparent.png`, a white-background `preview.png`, and `subject-print.png` for the later physical separation step.

## Installation in an agent client

Install the complete directory as `bigchx-make` in the client's skills directory. Do not copy only `SKILL.md`: local commands depend on `scripts/`, `references/`, `assets/`, the official configuration snapshot, and the package manifest.

The maintained download address is:

<https://oss.3dp.ing/skills/bigchx-make-skill.zip>

The website at <https://skills.bigchx.com/> provides the Skills documentation and browser workbench. It is a static browser application: image computation runs in the browser or through this local Node.js package. There is no remote image-computation API.

## Printing behavior

The recommended orientation is flat. A generated 3MF is an unsliced Bambu Studio project; it is not a print job and does not bind the user's AMS slots. A statement that a model was slice-verified is made only after an actual slicer check. The number of supported color layers is independent from the number of colors a printer can automatically load.

## Version and updates

The current package version is **2.3.0**. Module versions and release notes are in `manifest.json` and `releases.json`. Before a task, an agent can check the published manifest with:

```sh
node scripts/check-update.mjs --force
```

The check is advisory, cached, and offline-tolerant. It does not install or overwrite files automatically.

## Scope and roadmap

The mature workflow covers color analysis, separation, vector redraw guidance, filament matching, flat multicolor print export, and raised Logo plates. Free-form relief, complete solid/CAD reconstruction, engraving/CAM toolpaths, and UV printing/textures remain planned directions and are not represented as finished commands.

## Development and release notes

The algorithm source is maintained in the companion web project; this package contains the synchronized `scripts/core` runtime used by agents. Keep the module versions, package version, `manifest.json`, `releases.json`, and `SKILL.md` metadata aligned when releasing. Do not place user images, generated models, dependency caches, or release ZIPs in this repository.

See `NOTICE.md` for authorship, Bambu configuration provenance, and third-party dependency notices.
