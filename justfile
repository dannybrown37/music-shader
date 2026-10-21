# Music Shader: run `just` to list recipes.

default:
    @just --list

# Install pinned dependencies
install:
    npm ci

# Dev server on http://localhost:5173 (open it in Windows Chrome)
dev:
    npm run dev

# Open the running dev server in Windows Chrome (from WSL)
open:
    cd /mnt/c && cmd.exe /c start chrome http://localhost:5173

# Unit tests
test:
    npm test

# Typecheck + lint + tests
check:
    npm run typecheck
    npm run lint
    npm test

# Production build into dist/
build:
    npm run build

# Analysis report for one song; add --png out/plot.png [--from 30 --seconds 20] for a strip chart
analyze file *args:
    node tools/analyze.ts "{{file}}" {{args}}

# Headless stills / contact sheets / export test (needs `just dev` running); see tools/shot.ts
shot *args:
    node tools/shot.ts {{args}}

# Every scene compiles and draws a frame in headless Chrome (needs `just dev` running; CI runs this too)
smoke *args:
    node tools/smoke.ts {{args}}

# Regenerate docs/scenes.png: one labelled still per scene, in key order (needs `just dev` and ImageMagick)
scenes-png t="95":
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p out/scenes
    tiles=()
    n=0
    for id in $(grep -oP '^\s+id: "\K\w+' src/render/scenes/index.ts); do
        n=$((n + 1))
        if [ "$n" -le 10 ]; then key=$((n % 10)); else key="–"; fi
        node tools/shot.ts --scene "$id" --t {{t}} --w 720 --h 404 --out "out/scenes/$id.png" > /dev/null
        convert "out/scenes/$id.png" -resize 360x202 -fill white -pointsize 13 -gravity southwest \
            -annotate +8+6 "$key  $id" "out/scenes/$id-tile.png"
        tiles+=("out/scenes/$id-tile.png")
    done
    montage "${tiles[@]}" -tile 5x -geometry +0+0 docs/scenes.png
    echo "wrote docs/scenes.png ($n scenes)"

# Preview every palette as out/palettes.png
palettes:
    node tools/palettes.ts
