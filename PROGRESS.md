# exile-js Progress

> Live status of the project. See `PLAN.md` for the full approved plan.
> **Convention:** whoever works on this (any model/session) reads this file first, updates it as work lands, and commits it with the work.

## Current state

**M1 core complete (2026-07-06): all four scenarios parse; outdoor walkabout verified in headless Chromium. Remaining M1-adjacent: items.xml/monsters.xml parsers.**

- `npm test` → 36 tests green; `npm run dev` → walkabout demo (arrow keys, Home/End/PgUp/PgDn for diagonals).
- `node scripts/verify-walkabout.mjs` (needs `npx vite --port 5199` running) drives the demo headless: renders 97% non-black, sector crossing works. Playwright + chromium installed as devDependency.
- Parsers: `src/fileio/mapParse.ts` (.map), `specialParse.ts` (.spec + opcode table from strings resource, 'nop'=NONE special case), `terrainXml.ts`, `outdoorsXml.ts`, `scenarioXml.ts` (header+game block; quests/shops/etc. deferred by name), `loadScenario.ts` (out{x}~{y} assembly), `source.ts` (Fetch/Fs sources).
- Data: `special.ts` (SpecType enum + 15-short node), `terrain.ts`, `fields.ts` (FieldType — note SPECIAL_SPOT=9, SPECIAL_ROAD=25), `outdoors.ts`, `enumTags.ts` (estreams.cpp lookup tables), `scenario.ts`.
- M0: rng (std::mt19937-verified), location, sheets tile math, assets in `public/data`, scenarios unpacked in `public/scenarios`.

## Milestones (Part 1: BoE player)

- [x] **M0 — Skeleton**: Vite+TS(strict)+Vitest scaffold; `core/` (mt19937 rng, location) with tests; assets copied to `public/data`; tile-grid demo page
- [x] **M1 — Scenario loads, outdoor walkabout**: XML/.map/.spec parsers, terrain view, outdoor movement (gzip+tar for packed .boes deferred to file-upload work; items/monsters XML land with M2)
- [ ] **M2 — Towns + full 800×600 shell**: town enter/exit, UI chrome, sound, pregen party via tagfile reader, replay driver
- [ ] **M3 — Dialog toolkit + talk + shops**
- [ ] **M4 — Specials interpreter (breadth-first)**: VM + general/oneshot/ifthen/town groups
- [ ] **M5 — Combat** (M5a melee, M5b missiles+AI, M5c spells)
- [ ] **M6 — Specials depth + party ops** (valleydy completable)
- [ ] **M7 — Save/load (.exg) + startup flow**
- [ ] **M8 — Fidelity hardening** (replay golden masters)

## Milestones (Part 2: Exile 3)

- [ ] **E3-0 — Format groundwork**: TOWN.DAT/OUTDOOR.DAT layouts pinned, strings extractor, FORMATS.md
- [ ] **E3-1 — Walkable overworld** (needs M1)
- [ ] **E3-2 — Towns, NPCs, shops, dialogue** (needs M2–M3)
- [ ] **E3-3 — Quest logic, incrementally** (needs M4+)

## Key references (do not lose)

- Reference C++ implementation: `../exile-wasm` (CBoE WASM fork). Critical files listed at the end of `PLAN.md`.
- Exile 3 data + user's prior reverse-engineering: `../exile3-mapping` (`outdoor-to-json.js` = 90 zones × 3220 B, 48×48 terrain; `display.js` = partial E3→BoE terrain-sprite mapping).
- RNG must match C++ `std::mt19937` + `get_ran` (`../exile-wasm/src/mathutil.cpp:15`) including **call order** — replays depend on it.
- Tile math: 28×36 px, 10/row, 100/sheet, sheet = pic/100 (`../exile-wasm/src/gfx/gfxsheets.cpp`).
- UI layout rects: `../exile-wasm/src/game/boe.ui.cpp:33`.

## Findings / gotchas log

- (2026-07-05) `../exile3-mapping/Exile3/strings.txt` is a headerless Windows EXE image, not text — game text is inside as resources.
- (2026-07-05) BoE legacy `outdoor_record_type` ≈ 4146 B vs E3 zone 3220 B; difference is mostly the `specials[60]` node array (1320 B) BoE added — E3 encounter logic is hardcoded in EXILE3.EXE.
- (2026-07-05) TOWN.DAT (709,200 B) divides cleanly at 4728×150, 3546×200, 5910×120 … layout not yet pinned.

## Next steps

1. Finish M0 (this session): scaffold, rng+location ports w/ tests, asset copy, tile demo.
2. M1: tar/gzip reader + scenario XML parsers against `test/fixtures` (copy from `../exile-wasm/test/files`).
