# exile-js Progress

> Live status of the project. See `PLAN.md` for the full approved plan.
> **Convention:** whoever works on this (any model/session) reads this file first, updates it as work lands, and commits it with the work.

## Quick orientation (read this first)

- `npm run dev` → the game at http://localhost:5199. `?scenario=stealth` loads another.
- Keys: arrows/keypad move, **L** look, **T** talk, **U** use, **G** get items, **1-6** whose pack shows.
  In conversations: l/n/j/b/s/r/d/g/a. In shops: **a-h** buy, arrows scroll, Escape leaves.
  In prompts: 1-6, Escape, Enter.
- `npm test` runs everything headless (no browser needed).
- `node scripts/verify-screen.mjs` drives the real UI in Chromium and screenshots
  it — needs `npx vite --port 5199` running first. `SHOTS_DIR=...` sets where the
  screenshots go. It exits non-zero if anything regressed, so it's the fastest
  way to check a change end to end.
- Code layout: `core/` (rng, geometry, line of sight), `data/` (parsed scenario
  content), `fileio/` (parsers), `universe/` (mutable game state), `game/`
  (rules: session, talk, doors, shop, itemShop, training, rest, and
  `specials/` — the scripting VM), `render/` (the screen), `dialogs/`,
  `platform/`.
- **Convention that matters:** where a port stops short of the C++, there's an
  inline `TODO(Mn)` naming the milestone that fills it in. Grep `TODO(M` for the
  full list of known gaps — that's the honest inventory of what's missing.

## Current state

**M2 done bar two items, M3 nearly done, M4 breadth-first complete (2026-07-25): full 605×430 UI on the real Universe/GameSession architecture. A new game starts in the scenario's start town with the pregen party; you can walk the world with line-of-sight fog, lighting, terrain trim, roads, floor items and step sounds, talk to townspeople, open and bash doors, look at things and read signs, **pick up, equip, give and drop items**, and **buy, sell, identify, recharge, train and stay the night**. Remaining M2: the replay driver. Scenario scripting runs: walking onto a scripted square, looking at one, entering or leaving a town, or using a lever fires its chain, and Fort Talrus's own messages, its Rest prompt and its walk-through-a-wall node all work. Remaining M3: item Use (needs M5's abilities), enchanting (needs M5's enchantment table), job banks and boats/horses (M6), and the full dialogxml toolkit. Remaining M4: the opcodes that need combat, fields, timers or quests — each one says so in the transcript rather than failing silently.**

M2 landed so far:
- Town/talk/town-map parsers (`townXml.ts`, data in `town.ts`/`talking.ts`) — all 21 valleydy towns + all scenarios load.
- Monster graphics: `render/mPicIndex.ts` (mechanically extracted m_pic_index table) + `render/monsterPics.ts` (get_monster_template_rect port: sheet monst{1+(i+part)/20}, col 2*(idx/10)+adj, adj=1 for default pose).
- **Architecture** (replaces the old ad hoc `Demo` class):
  - `game/modes.ts` — `GameMode` = eGameMode verbatim + isOut/isTown/isCombat (range comparisons depend on the order, don't reshuffle).
  - `universe/` — `Party` (gold/food/age/SDF + the outdoorCorner/iwc/outLoc/locInSec position model), `Player` + `makePresetPlayer` (PARTY_DEFAULT/PARTY_DEBUG pregens from pc.cpp:1032), `CurOut` (96×96 window built from a 2×2 sector block, shift_universe_* port), `CurTown` + `Creature`, `Universe` (holds party/out/town/rng/transcript).
  - `game/session.ts` — `GameSession`: outd_move_party, town_move_party, start_town_mode, end_town_mode, checkTownEntrance (find_direction_from), world-edge clamping, explored-map updates. Unported branches are marked `TODO(Mn)` inline.
  - `render/` — `layout.ts` (win_to_rects, PC row rects, toolbar placement), `screen.ts` (the whole 605×430 composite), `tiling.ts` (pixpats bg patterns), `text.ts`, `colours.ts`, `pcPics.ts`.
  - `platform/input.ts` — `InputRouter` with the `dialogStack` gate that will suppress game input under modal dialogs.
- **Party start is faithful**: put_party_in_scen starts the party *inside* `scenario.startTown` (entry_dir 9), not outdoors. `GameSession.startNewGame()` does this.
- Headless verification: `scripts/verify-screen.mjs` (start vite on :5199 first, `SHOTS_DIR=… node scripts/verify-screen.mjs`) — checks all six panels paint, start-in-town, walk out, roam, re-enter, zero console errors. `window.__session`/`__univ`/`__screen`/`__scen`/`__redraw` exposed for driving.
- `test/session.test.ts` — 11 tests over party presets, town enter/exit, map memory, entrance direction, window sliding, world edge.

- **Visual fidelity** (all ported, all visible in `scripts/verify-screen.mjs` screenshots):
  - `core/sight.ts` — `canSee` (utility.cpp:19) verbatim, including the integer DDA stepping.
  - Session: `sightObscurity`/`getBlockage`/`canSeeLight`/`ptInLight`/`lightRadius`/`setUpLights`; `updateExplored` gates reveals on line of sight, so fog behaves like the original.
  - Screen: unexplored/unlit tiles draw black (`can_draw`), roads draw stubs from fields.png (`place_road`/`extend_road_terrain`), and `render/trim.ts` stencils shoreline frills, rounded wall corners and walkway corners.
  - Floor items: preset items placed on town entry, drawn via `calc_item_rect` (objects.png / tinyobj.png).
- **Sound**: `platform/sound.ts` (Web Audio, SND*.wav), wired to `move_sound`'s step sounds and the town-entry sound. Starts on the first user gesture, as browsers require.
- **Dialogs (M3b)**: `dialogs/dialog.ts` — a minimal async modal (`DialogHost.run()` → `Promise<button name>`) covering picture + text + buttons + selectable rows, which is what `view-sign`, `locked-door-action`, `select-pc` and the specials VM's message/choice dialogs need. Rows carry a `key` (drawn as a numbered button), a `disabled` flag, and a `highlight` flag — select_pc uses all three. This is the async replacement for ASYNCIFY-blocking `cDialog::show()` from PLAN.md §2.3; the `InputRouter.dialogStack` gate keeps game input suppressed. Note the dark background (`cDialog::BG_DARK` = bg[5]) means **white** text, and `|` is a hard line break in game text. Full dialogxml (~210 defs) is still to come.
- **Items (M3d)**: `data/itemVariety.ts` ports load_item_type_info (equip counts, hand counts, exclusion categories); `universe/inventory.ts` ports give_item / equip_item / unequip_item / max_weight / cur_weight / item_weight / has_abil_equip. Session gains `reachableItems` (get_item's adjacency + mass-get rules), `takeItem`, `dropItem`, `giveItemTo`, `toggleEquip`, and `selectPcOptions` (select_pc's candidate list). The inventory panel is real: eight rows with icons, equipped items italicised and coloured by kind (weapons pink, armour green, other blue), and Give/Drop/Info row buttons. Keys: **G** get, **1-6** switch whose pack shows; click a name to equip/unequip.
- **Keyboard shortcuts**: talking has the original's letter keys (`talk_chars`, boe.actions.cpp:2790 — l/n/j/b/s/r/d/g/a, Escape = Done, Space = Go Back), and only responds to presets currently on screen. `select_pc` prompts answer number keys 1-6 (`select-pc.xml` def-keys) and show the highest skill in green.
- **Doors and looking (M3c)**: `game/doors.ts` ports pick_lock/bash_door/stat_adj (incl. the `skill_bonus` table from shop.cpp:43); `GameSession.checkSpecialTerrain` handles CHANGE_WHEN_STEP_ON (walk into a door to open it — costs the turn if it blocked) and UNLOCKABLE (locked → host prompt → pick/bash). Unlocked doors persist via `cTown::door_unlocked`, replayed on town entry. `GameSession.lookAt` ports do_look, `signAt` gates sign reading on adjacency. Keys: **L** to look, **T** to talk.
- **Shops (M3e)**: `data/shop.ts` (cShop/cShopItem verbatim, `cost_mult` prices, the two preset shops), `data/treasure.ts` (return_treasure / pull_item_of_type, RNG call order preserved), `data/strings.ts` (get_str against `data/strings/*.txt`, loaded before the scenario because shop stock names itself synchronously), `fileio/scenarioXml.ts` (`readShopFromXml` + the store-items rects), `game/shop.ts` (`ShopState` = set_up_shop_array + handle_sale), `render/shopScreen.ts` (draw_shop_graphics with init_shopping_rects geometry). A SHOP talk node opens it; keys **a**-**h** buy, arrows scroll, Escape leaves. `Universe.refreshStoreItems` rolls random-shop stock; `party.storeLimitedStock` remembers what's been bought out.
- **Shop services on your own goods (M3f)**: `game/itemShop.ts` ports place_item_button's eligibility/price rules and handle_item_shop_action — selling (half value), identifying, recharging (a free recharge can melt the item), enchanting (stubbed on M5's table). A SELL/IDENTIFY/RECHARGE talk node switches the inventory panel into a prompt where each eligible item grows a priced button. Note `inventory.ts`'s `takeItem` now compacts the pack the way `cPlayer::take_item` does.
- **Training and inns (M3g)**: `game/training.ts` holds spend_xp's mode-1 rules (skill-point *and* gold costs, caps, no refunding a level the PC walked in with, the Anama curse); `game/rest.ts` ports do_rest for the INN node. The training dialog is a two-column list rather than the original's stepper grid — marked `TODO(M3)` pending stepper widgets.
- **Talking (M3a)**: `game/talk.ts` (`TalkState`) ports start_talk_mode/handle_talk_node/reset_talk_words/scan_for_response; `render/talkScreen.ts` ports place_talk_str/place_talk_face. Press T (or the TALK toolbar button) then a direction. Keyword matching is first-4-chars case-insensitive, and nodes are filtered to the personality (or -2 = anyone in town). Node types implemented: REGULAR, DEP_ON_SDF, SET_SDF, DEP_ON_TIME(_AND_EVENT), DEP_ON_TOWN, BUY_INFO, BUY_SDF, BUY_SPEC_ITEM, BUY_TOWN_LOC, END_FORCE/FIGHT/ALARM/DIE, SHOP, INN, TRAINING, SELL_WEAPONS/ARMOR/ITEMS, IDENTIFY, ENCHANT, RECHARGE. Still unimplemented (and saying so in the transcript rather than failing silently): JOB_BANK, BUY_SHIP, BUY_HORSE, RECEIVE_QUEST, CALL_TOWN_SPEC, CALL_SCEN_SPEC.

Notes for M2 implementer:
- The window is **605×430** (`global.hpp:30`), not 800×600 — the earlier plan text was wrong. index.html scales the canvas ×2 in CSS.
- The inventory panel is a placeholder until the item/equip model lands (M3).
- Trim stencilling: trim.png is a 1-bit **black-on-white** bitmap; black = "let the neighbouring ground show through". The C++ uses a fragment shader; we use an offscreen tile + `destination-in` against an alpha mask. Masks sit at the same offset inside a 28×36 cell as inside the sheet.
- Still missing from the terrain view: fields/barriers/webs overlay (`draw_fields`), boats and horses, special-spot markers, and the `sightObscurity` contributions those add.
- Monster abilities are captured as lossless `RawAbility` records (monster.ts) — port uAbility union semantics at M5, reference readMonstAbilFromXml (fileio_scen.cpp:1425).
- Town reader reference: readTownFromXml (fileio_scen.cpp:1839), loadTownMapData; town terrain templates are variable-size (min 24); talkN.xml via readDialogueFromXml.
- scenarioXml.ts skips deferred sections by name (quests/shops/special-items/strings) — tighten as those land.

- `npm test` → 198 tests green (19 files); `npm run dev` → the game screen (arrow keys / keypad, Home/End/PgUp/PgDn for diagonals; `?scenario=stealth` to load another).
- `node scripts/verify-screen.mjs` (needs `npx vite --port 5199` running) drives the real UI headless and screenshots it. Playwright + chromium installed as devDependency.
- Parsers: `src/fileio/mapParse.ts` (.map), `specialParse.ts` (.spec + opcode table from strings resource, 'nop'=NONE special case), `terrainXml.ts`, `outdoorsXml.ts`, `scenarioXml.ts` (header+game block; quests/shops/etc. deferred by name), `loadScenario.ts` (out{x}~{y} assembly), `source.ts` (Fetch/Fs sources).
- Data: `special.ts` (SpecType enum + 15-short node), `terrain.ts`, `fields.ts` (FieldType — note SPECIAL_SPOT=9, SPECIAL_ROAD=25), `outdoors.ts`, `enumTags.ts` (estreams.cpp lookup tables), `scenario.ts`.
- M0: rng (std::mt19937-verified), location, sheets tile math, assets in `public/data`, scenarios unpacked in `public/scenarios`.

- **Fields**: `CurTown.fields` is a per-square set of `FieldType` (the C++ packs the same information into one bitfield), built from the town's preset fields; `render/fieldPics.ts` + `Screen.drawFields` port `draw_fields` (boe.graphutil.cpp:379) with its layering — decals, then things in the space, then transient walls and clouds, then the special-encounter marker last. Webs/barriers/crates feed `sight_obscurity`, force barriers and cages stop movement, and `RECT_PLACE_FIELD` / `IF_FIELDS` work.
- **Specials VM (M4)**: `game/specials/` — `context.ts` (SpecCtx/SpecCtxType/SpecCat verbatim, the host interface), `vm.ts` (run_special: pointer resolution, the reserved 10/11/12 pointers, one-chain-at-a-time queueing, handle_message), then one file per opcode group mirroring the C++ sections: `general.ts`, `ifthen.ts`, `oneshot.ts`, `town.ts`, `rect.ts`, `outdoor.ts`, `affect.ts`. Every handler is `async` — the C++ blocks on a dialog and we `await` the host instead, which is PLAN.md §2.3's ASYNCIFY replacement applied to scripting.
  - **Movement is async because of this.** `session.move`/`moveTo` return promises: a square's special can put a dialog up before deciding whether the step goes through.
  - The host (`main.ts`) supplies message/choice/askText/selectPc/startShop/startTalk/sound/rest/moveParty/changeLevel/endScenario. `DialogHost.runQueued` serialises dialogs so a chain can show several in a row.
  - Triggers: town + outdoor movement, `adj_town_look`, town entry (`spec_on_entry`) and exit (each exit's node), `CALL_SPECIAL` terrain, `use_space` (**U**), the scenario's `on-init`, and talk's CALL_TOWN_SPEC / CALL_SCEN_SPEC.

## Milestones (Part 1: BoE player)

- [x] **M0 — Skeleton**: Vite+TS(strict)+Vitest scaffold; `core/` (mt19937 rng, location) with tests; assets copied to `public/data`; tile-grid demo page
- [x] **M1 — Scenario loads, outdoor walkabout**: XML/.map/.spec parsers, terrain view, outdoor movement (gzip+tar for packed .boes deferred to file-upload work; items/monsters XML land with M2)
- [ ] **M2 — Towns + full 605×430 shell**: town enter/exit ✅, UI chrome ✅, pregen party ✅, GameSession/Universe ✅, sound ✅, line-of-sight fog + lighting ✅, terrain trim + roads ✅, floor items ✅, inventory panel ✅, fields overlay ✅; replay driver still open
- [ ] **M3 — Dialog toolkit + talk + shops**: talking ✅, minimal async modal dialog ✅, doors + look + signs ✅, item/equip model + inventory panel ✅, shops ✅, sell/identify/recharge ✅, training ✅, inns ✅; item Use, enchanting, and full dialogxml still open
- [x] **M4 — Specials interpreter (breadth-first)**: VM core (pointers, queueing, messages) + all seven opcode groups; triggers wired for movement, look, town entry/exit, use-space, call-special terrain and the two talk nodes. Opcodes needing combat/fields/timers/quests report themselves and wait for M5/M6.
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
- (2026-07-25) BoE's window is 605×430, terrain view is 9×9 tiles centred on index 4, tiles at (13+28q, 13+36r) inside the terView panel. `rectangle` is `{top,left,bottom,right}`.
- (2026-07-25) `rsrc/bases/{bladbase,cavebase}` are *scenario templates*, not party files — there is no pregen party file to read. The pregen party is hardcoded (`cPlayer(party, PARTY_DEFAULT, slot)`), so no tagfile reader is needed to start a game; .exg loading stays an M7 concern.
- (2026-07-25) The party starts **in the start town**, via `start_town_mode(which_town_start, 9)`. `scenario.outdoorStart`/`sectorStart` is only where it lands on leaving.
- (2026-07-25) `play_sound(n)` treats a **negative** n as "play asynchronously"; the sound is `abs(n)`. Terrain stores door sounds in flag2 and the game calls `play_sound(-flag2)`. Also: a sound that isn't cached must be fetched *and then played*, or the first door you open is silent.
- (2026-07-25) `item_buttons_from` (boe.text.cpp:47) is indexed by `eItemButton - 2`, so USE/GIVE/DROP/INFO map to entries 0-3.
- (2026-07-25) `find_direction_from` maps travel direction → entrance index as N→2, S→0, other-easterly→3, other-westerly→1. An earlier demo had this inverted.
- (2026-07-25) `eShopItemType`'s numbering is load-bearing twice over: old scenarios are ported by number, and *every value from `HEAL_WOUNDS` (10) up is treated as a healing service* by `>=` comparisons. Don't renumber.
- (2026-07-25) A shop's `<entries>` can be empty — valleydy has four "Unused Shop" placeholders. `start_shop_mode` returning false for them is the normal path, not an error.
- (2026-07-25) An optional shop item packs its percentage chance into the *thousands place* of `quantity` (`quantity = min(999, n) + chance * 1000`).
- (2026-07-25) Shops name their stock (spells, skills) out of `data/strings/*.txt` **while parsing**, so the string tables must be registered before `loadScenario` runs. `main.ts` awaits `loadStringTables`; tests do it in `test/setup.ts`.
- (2026-07-25) `cPlayer::take_item` **compacts** the pack — everything below the slot shifts up. That's why the inventory list never has holes in it.
- (2026-07-25) `is_out`/`is_town` recurse through SHOPPING and TALKING by swapping in the mode each interrupted; a shop opened from a conversation nests two deep, so unwrapping has to loop.
- (2026-07-25) **`cCurTown::is_special` (universe.cpp:301) scans the town's `special_locs` list — it does *not* read the SPECIAL_SPOT field flag.** The flag only controls the white marker the map draws. Fort Talrus has ten scripted squares and one flag; gating on the flag silently disables nine tenths of a scenario's scripting. Outdoors there's no flag check at all, and the chain is passed *sector-local* coordinates.
- (2026-07-25) A special node field `<= -10` is a **pointer**, not a value: `-N` reads party pointer N. Pointers 10/11/12 are forced to the trigger location and its terrain before every chain. This applies to every field of every node, so it has to happen in one place (`resolvePointers`).
- (2026-07-25) One-shot nodes use no flag of their own: they read an SDF, refuse to run if it's already **250**, and write 250 on the way out. A node that *couldn't* complete (no room for the item, player pressed Leave) deliberately skips that write so it can be retried.
- (2026-07-25) `handle_message` returns early when both `m1` and `m2` are negative — which means a node whose only string is `BUFFER_STR` (-8) prints nothing. That's the C++ behaviour, not a port bug.
- (2026-07-25) A `CANT_ENTER` node with `ex2a > 0` runs even on a square whose terrain blocks movement, and its `b` return forces the party through. That's how a scenario walks you through a wall.
- (2026-07-25) Special-node fields default to **-1**, which is truthy in both C++ and JS. Nodes that test a field as a boolean (`if(spec.pic)`) therefore behave as "set" unless the scenario writes 0.
- (2026-07-25) `day_reached(day, event)` tests the day the event *happened* (`key_times[event] >= day`), not elapsed time since it. Easy to get backwards.
- (2026-07-25) Movement, `talkTo` and `useSpace` are **async** now, because each can raise a dialog mid-action. `main.ts` keeps an `acting` flag so a held arrow key can't start a second move on top of the first — the C++ gets that for free by blocking.

## Handoff: how to build combat (the next chunk)

M5 is the biggest single piece in the plan (~30% of the effort) and the one
that unlocks most of what's still stubbed. It's explicitly split three ways:
**M5a melee → M5b missiles + monster AI → M5c spells, patterns and fields.**

Before starting, `grep -rn "TODO(M5" src/` — that's the list of places already
waiting for it, and it's the honest scope. As of now it includes: terrain
damage, item Use and abilities, traps, encounters, spell patterns, fields,
enchanting, disease, and the specials VM's damage/monster opcodes.

Suggested order:

1. **The `iLiving` seam first.** PLAN.md §2.4: the C++ has an abstract base
   over Player and Creature, and all damage/status code targets it. This port
   has `universe/player.ts` and `universe/creature.ts` with no shared base yet.
   Introduce it before combat, not after — `boe.combat.cpp` ports nearly
   line-by-line against it, and retrofitting is much worse.
2. **Damage and status.** `damage_pc` / `damage_monst` (boe.specials.cpp:1442
   is the monster half) plus `eStatus` handling. `Status` is already ported in
   `universe/skills.ts` and PCs already carry the array.
3. **Combat mode.** The `GameMode` enum already has COMBAT, SPELL_TARGET,
   FIRING, THROWING, FANCY_TARGET, DROP_COMBAT in the right order, and
   `isCombat()` works. `start_town_combat` / `end_town_combat` are the entry
   and exit points the town nodes already call for.
4. **Preserve the `get_ran` call order.** This is the fidelity constraint that
   makes replays possible, and combat is where it matters most. The RNG is
   already bit-compatible; the sequence is the part a port loses.
5. **Fields already exist** — the model, the overlay and the two field opcodes
   landed with M4. What M5c adds is the *behaviour*: damage on entry, quickfire
   spreading, webs slowing, and the spell patterns that place them.

Once combat exists, these open up almost for free: the specials VM's DAMAGE /
AFFECT_MONST / spell-pattern opcodes, `ONCE_TRAP` and the encounter nodes,
item Use, and the enchanting service (which just needs `eEnchant`).

Smaller things outstanding, all independent of M5:
- **The replay driver** is M2's last leftover (`test/replays` in exile-wasm).
- **Training's dialog** works but is a list, not the original's stepper grid;
  replace it when dialogxml grows steppers. Rules are all in `game/training.ts`.
- **`askForText`** still uses `window.prompt` — needs a canvas text field.
- **Timers** (M6): `SCEN_TIMER_START` / `TOWN_TIMER_START` parse and report
  themselves but need `special_increase_age`'s tick loop.
- **Quests and job banks** (M6): `UPDATE_QUEST`, `IF_QUEST`, `JOB_BANK`.
- **Boats and horses** (M6): the two talk nodes and `CHANGE_*_OWNER`.

## Next steps

1. M5: combat, following the handoff plan above — starting with the `iLiving` seam.
2. Finish M2's leftovers alongside: the fields/barriers overlay (which M5c needs anyway) and the replay driver.
3. Part 2 (Exile 3) hasn't started; E3-0 (format groundwork) can proceed in parallel at any time.
