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

# Preview every palette as out/palettes.png
palettes:
    node tools/palettes.ts
