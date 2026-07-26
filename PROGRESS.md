# exile-js Progress

> Live status of the project. See `PLAN.md` for the full approved plan.
> **Convention:** whoever works on this (any model/session) reads this file first, updates it as work lands, and commits it with the work.

## Quick orientation (read this first)

- `npm run dev` → the game at http://localhost:5199. `?scenario=stealth` loads another.
- Keys follow the original's `handle_keystroke` (boe.actions.cpp:2772):
  arrows/keypad move, **f** fight (and end a fight), **e** end combat,
  **w**/Space wait — stand ready in combat, **d** parry, **x** hold the turn on
  one PC, **t** talk, **l** look, **u** use, **b** bash, **g** get, **r** rest,
  **1-6** whose pack shows, **a** the automap. Keys for things not built yet (**s**
  shoot, **m**/**p** spells, **A** alchemy) say which milestone they're waiting
  on. In conversations: l/n/j/b/s/r/d/g/a. In shops: **a-h** buy, arrows
  scroll, Escape leaves. In prompts: 1-6, Escape, Enter.
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

**M2 done bar two items, M3 nearly done, M4 complete, M5a (melee combat) complete (2026-07-25): full 605×430 UI on the real Universe/GameSession architecture. A new game starts in the scenario's start town with the pregen party; you can walk the world with line-of-sight fog, lighting, terrain trim, roads, floor items and step sounds, talk to townspeople, open and bash doors, look at things and read signs, **pick up, equip, give and drop items**, and **buy, sell, identify, recharge, train and stay the night**. Remaining M2: the replay driver. Scenario scripting runs: walking onto a scripted square, looking at one, entering or leaving a town, or using a lever fires its chain, and Fort Talrus's own messages, its Rest prompt and its walk-through-a-wall node all work. Remaining M3: item Use (needs M5's abilities), enchanting (needs M5's enchantment table), job banks and boats/horses (M6), and the full dialogxml toolkit. Remaining M4: the opcodes that need combat, fields, timers or quests — each one says so in the transcript rather than failing silently. **Combat is playable**: the SWORD button (or **C**) starts a fight, the party spreads out as six figures with action points, and you can swing, move, swap places, kill things and earn experience. Monsters notice you, walk over and hit back, in town mode as well as in combat — so Fort Talrus's eight Giant Rats will come for you from the moment a new game starts. The `uAbility` port landed 2026-07-26, so monster abilities are real data now; monsters shoot, breathe, summon aid and land their touch attacks; what's still missing from combat is monster spellcasting and the party's own missiles (M5b), and the spells and field behaviours (M5c).**

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

- `npm test` → 331 tests green (25 files); `npm run dev` → the game screen (arrow keys / keypad, Home/End/PgUp/PgDn for diagonals; `?scenario=stealth` to load another).
- `node scripts/verify-screen.mjs` (needs `npx vite --port 5199` running) drives the real UI headless and screenshots it. Playwright + chromium installed as devDependency.
- Parsers: `src/fileio/mapParse.ts` (.map), `specialParse.ts` (.spec + opcode table from strings resource, 'nop'=NONE special case), `terrainXml.ts`, `outdoorsXml.ts`, `scenarioXml.ts` (header+game block; quests/shops/etc. deferred by name), `loadScenario.ts` (out{x}~{y} assembly), `source.ts` (Fetch/Fs sources).
- Data: `special.ts` (SpecType enum + 15-short node), `terrain.ts`, `fields.ts` (FieldType — note SPECIAL_SPOT=9, SPECIAL_ROAD=25), `outdoors.ts`, `enumTags.ts` (estreams.cpp lookup tables), `scenario.ts`.
- M0: rng (std::mt19937-verified), location, sheets tile math, assets in `public/data`, scenarios unpacked in `public/scenarios`.

- **Fields**: `CurTown.fields` is a per-square set of `FieldType` (the C++ packs the same information into one bitfield), built from the town's preset fields; `render/fieldPics.ts` + `Screen.drawFields` port `draw_fields` (boe.graphutil.cpp:379) with its layering — decals, then things in the space, then transient walls and clouds, then the special-encounter marker last. Webs/barriers/crates feed `sight_obscurity`, force barriers and cages stop movement, and `RECT_PLACE_FIELD` / `IF_FIELDS` work.
- **Specials VM (M4)**: `game/specials/` — `context.ts` (SpecCtx/SpecCtxType/SpecCat verbatim, the host interface), `vm.ts` (run_special: pointer resolution, the reserved 10/11/12 pointers, one-chain-at-a-time queueing, handle_message), then one file per opcode group mirroring the C++ sections: `general.ts`, `ifthen.ts`, `oneshot.ts`, `town.ts`, `rect.ts`, `outdoor.ts`, `affect.ts`. Every handler is `async` — the C++ blocks on a dialog and we `await` the host instead, which is PLAN.md §2.3's ASYNCIFY replacement applied to scripting.
  - **Movement is async because of this.** `session.move`/`moveTo` return promises: a square's special can put a dialog up before deciding whether the step goes through.
  - The host (`main.ts`) supplies message/choice/askText/selectPc/startShop/startTalk/sound/rest/moveParty/changeLevel/endScenario. `DialogHost.runQueued` serialises dialogs so a chain can show several in a row.
  - Triggers: town + outdoor movement, `adj_town_look`, town entry (`spec_on_entry`) and exit (each exit's node), `CALL_SPECIAL` terrain, `use_space` (**U**), the scenario's `on-init`, and talk's CALL_TOWN_SPEC / CALL_SCEN_SPEC.

- **The `iLiving` seam (M5a)**: `universe/living.ts` — `eSpellNote` and its
  message table, `apply_status` / `clear_bad_status` / `clear_brief_status` /
  `void_sanctuary` / `spell_note` / `damaged_msg`, and the two module-level
  hooks the C++ keeps static (`setPrintResult`, `setLivingSound`) because status
  effects fire from deep inside the damage pipeline with no Universe to hand.
  `Player` and `Creature` both extend it and carry cPlayer's and cCreature's
  full set of effects; a `Creature` owns a *copy* of its monster definition
  (`monst.mon`), mirroring cCreature inheriting cMonster.
- **Damage (M5a)**: `game/damage.ts` — `damagePc` (armour rolls per piece,
  parry, toughness, luck, damage/species/full protection, invulnerability,
  magic resistance), `killPc` (the luck save, life-saving items, the pack
  spilling on the floor), `damageMonst` (resistances, elemental saving throw,
  invulnerability by tenths, morale loss in steps), `killMonst` (the SDF, the
  on-kill special, xp, gore), `awardXp`/`awardPartyXp` with the level-up loop,
  and `hitParty`. DAMAGING and DANGEROUS terrain both go through it now.
- **Combat (M5a)**: `game/combat.ts` — `setPcMoves` (action points with
  encumbrance, haste, slow and webs), `pickNextPc`, `takeAp`, `placeParty`,
  `startTownCombat`/`endTownCombat`, and `pcAttack`/`pcAttackWeapon` with the
  bless/curse and dexterity adjustments, two-weapon and ambidexterity rules,
  the slith pole-arm bonus, assassination, poisoned blades and martyr's shield.
  Session gains `startCombat`/`endCombat`/`combatMove`/`attackAt`; walking into
  a hostile creature starts a fight. Keys: arrows move the acting PC, **C**
  starts or ends a fight, **Space** passes. The toolbar swaps to
  `FIGHT_BUTTONS` in combat, and SWORD / END / WAIT are wired.
- **Monster turns and encounters (M5b, partial)**: `game/monsterTurn.ts` —
  `doMonsters` (the town-mode half of `do_monsters`: notice the party, say
  "Monster saw you!", drift with `rand_move` or walk over), `doMonsterTurn`
  (action points from speed, target picking, fleeing on lost morale, melee),
  `monsterAttack` (up to three attacks with the sanctuary miss, the difficulty
  multiplier against PCs, and double damage to a sleeping target), and
  `combatRunMonst` (the turn between rounds: the clock, the light, status
  decay). `session.afterPartyTurn` runs the town-mode pair after any
  successful move, which is what makes encounters happen at all.
- **Turning a town hostile (2026-07-26)**: `game/townAttitude.ts` ports
  `set_town_attitude` / `make_town_hostile` (boe.items.cpp:304) — the slot
  range with its Python-style negative indices, the summoned-creature
  exemption, the guard power-up (triple health, haste, bless, alerted) and the
  town's `spec_on_hostile` chain. Every caller now goes through it: the
  MAKE_TOWN_HOSTILE special, talk's END_ALARM, being caught stealing, and
  **attacking someone peaceful**. In combat, moving into a friendly raises
  `attack-friendly.xml` ("This creature isn't hostile. Attack anyway?"); Attack
  swings *and* turns the town. `CurTown.monstHostile` is the `cPopulation::hostile`
  flag, and `do_monsters` reads it so nobody drifts idly once it's set.
  `session.combatMove` is **async** now because of that prompt.
- **Monster abilities — the `uAbility` port (M5b, 2026-07-26)**:
  `data/monsterAbility.ts` holds `MonstAbil` (24 slots, in order),
  `MonstMissile`/`MonstGen`/`MonstSummon`/`SpellPat`, `abilityCategory`
  (getMonstAbilCategory, whose range comparisons depend on the enum order) and
  `abilityApCost` (get_ap_cost, monster.cpp:758). A monster now carries
  `abil: Ability[]` indexed by `MonstAbil`, so `mon.abil[MonstAbil.SPLITS]`
  reads like the C++; `RawAbility` is gone. `monstersXml.ts` ports
  `readMonstAbilFromXml` in full — the five element kinds, the required-element
  sets (including the two that only become required once a general ability
  isn't a touch), and the percentage-to-tenths conversion. All four bundled
  scenarios parse.
  Wired straight away: **MARTYRS_SHIELD** and **ABSORB_SPELLS** in
  `Creature.isShielded`/`getSharedDmg`/`magicAdjust`, **SPLITS** in
  `damageMonst`, **DEATH_TRIGGER** in `killMonst`, and the sleep-cloud
  breather's immunity to sleep. `game/monsterPlace.ts` ports `find_clear_spot`
  and `place_monster`, which splitting needs and summoning will reuse.
  Still ahead: missiles, breath, monster spells and summons.
- **Monster missiles and breath (M5b, 2026-07-26)**:
  `game/monsterAbilities.ts` ports the ability-picking loop from
  `do_monster_turn` (boe.combat.cpp:2303), `monst_fire_missile`'s MISSILE
  branch and `monst_basic_abil`. `doMonsterTurn` now reaches for a ranged
  ability *before* it considers a swing, so archers shoot and drakes breathe
  instead of walking up to you. Damage, status, stun, drain-SP, kill, and the
  food and gold thieves all land; PETRIFY, DRAIN_XP and FIELD say which
  milestone they're waiting on. Not ported: `run_a_missile`, the projectile
  flying across the screen — the shot resolves at once with its sound, and the
  damage still draws its explosion.
- **Summons and touch abilities (M5b, 2026-07-26)**:
  `game/monsterPlace.ts` gains `get_summon_monster` and `summon_monster`
  (boe.monster.cpp:1152/1210), and `place_monster` now honours the
  `which >= 10000` arm that reads `party.summons` (a new, normally empty list
  on `Party`). `monsterAbilities.ts`'s `monsterSummon` ports the SUMMON half of
  do_monster_turn's trailing block: it runs once per action the monster takes,
  costs nothing, and only fires when the summoner can actually see its foe.
  The three summon kinds all work — a named monster, a summon *class* drawn
  through `get_summon_monster`, and a random monster of a given race.
  `monsterTurn.ts`'s `monsterAttack` now runs the **touch abilities** off a
  blow that landed: the burning/freezing/paralysing touch, the killing touch,
  the food and gold thieves, each with the original's message and
  `monst_basic_abil` behind it. STATUS2 rides only the first attack, STATUS
  every one. Still open in this area: monster spellcasting, RADIATE (needs
  M5c's spell patterns) and the party's own missiles.
- **Loot (2026-07-26)**: `game/loot.ts` ports `place_item`, `reset_item_max`,
  `item_val`, `place_glands` and `place_treasure` (boe.items.cpp:168-841) —
  the five treasure tables verbatim and, more importantly, `place_treasure`'s
  whole `get_ran` sequence. `killMonst` calls both: glands hang off the
  experience check (nothing party-summoned leaves a body part), treasure off
  its own `summonTime === 0`. Kill a guard and it drops gold, a necklace and
  the armour it was wearing.
- **The automap (2026-07-26)**: `render/mapScreen.ts` ports `draw_map`
  (boe.town.cpp:1317) and `display_map`/`close_map`. **A** or the MAP toolbar
  button toggles it; Escape closes it. The original opens a second 296×277 OS
  window; the WASM build already draws it over the main one at (52, 62), and
  this port does the same — `Screen.mapVisible` gates it and `Screen.draw`
  paints it last, mirroring `redraw_screen`'s trailing
  `if(map_visible) draw_map(false)`. Explored squares only, 6px each, a 40×40
  window that slides with the party (`mapViewRect`, exported so it can be
  tested), road stubs from trim.png, and the red party marker. Arena combat
  says "No map in combat." and a `defy-mapping` town says so too.
- **Hit animation (M5a)**: `game/booms.ts` ports `boom_space` — the explosion
  frame from booms.png over the square with the damage printed on it, and the
  sound. The C++ draws it and sleeps; here each boom carries an expiry and
  `main.ts` runs a short rAF loop until they've all gone, which is the same
  observable behaviour without blocking.

## Milestones (Part 1: BoE player)

- [x] **M0 — Skeleton**: Vite+TS(strict)+Vitest scaffold; `core/` (mt19937 rng, location) with tests; assets copied to `public/data`; tile-grid demo page
- [x] **M1 — Scenario loads, outdoor walkabout**: XML/.map/.spec parsers, terrain view, outdoor movement (gzip+tar for packed .boes deferred to file-upload work; items/monsters XML land with M2)
- [ ] **M2 — Towns + full 605×430 shell**: town enter/exit ✅, UI chrome ✅, pregen party ✅, GameSession/Universe ✅, sound ✅, line-of-sight fog + lighting ✅, terrain trim + roads ✅, floor items ✅, inventory panel ✅, fields overlay ✅; replay driver still open
- [ ] **M3 — Dialog toolkit + talk + shops**: talking ✅, minimal async modal dialog ✅, doors + look + signs ✅, item/equip model + inventory panel ✅, shops ✅, sell/identify/recharge ✅, training ✅, inns ✅; item Use, enchanting, and full dialogxml still open
- [x] **M4 — Specials interpreter (breadth-first)**: VM core (pointers, queueing, messages) + all seven opcode groups; triggers wired for movement, look, town entry/exit, use-space, call-special terrain and the two talk nodes. Opcodes needing combat/fields/timers/quests report themselves and wait for M5/M6.
- [ ] **M5 — Combat**: M5a ✅ (the iLiving seam, damage/status, combat mode, melee); M5b mostly done (monster turns, melee AI, town encounters, the `uAbility` port, missiles, breath, summons and touch abilities ✅; monster spells and outdoor wandering monsters still open); M5c (spells, patterns, field behaviours) still open
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
- (2026-07-25) `handle_talk` takes the clicked square as given and only checks line of sight — **you can talk to anyone you can see, at any distance**, and its gate compares against 4, not SIGHT_BLOCKED. A UI that reduces the click to one step toward the target is wrong.
- (2026-07-25) `end_town_mode` **returns** the outdoor square to walk out onto, and `handle_action` assigns it straight over the move's destination (boe.actions.cpp:770). A town with no defined exits (Fort Talrus has none) falls back to "one step from where you entered", so the party leaves from wherever it was standing outdoors.
- (2026-07-25) `use_space` checks webs and pushable crates/barrels/blocks **before** the terrain specials, so a port that starts with terrain can never reach them.
- (2026-07-25) Drawing creatures needs `party_can_see_monst`, or they show through unexplored walls and darkness — a big creature counts as visible if any one of its squares is.
- (2026-07-25) **`inTown` is false in combat.** `MODE_COMBAT` sits *outside*
  `is_town`'s range (the enum comment even says so), so every sight and
  lighting check quietly switched to outdoor rules the moment a fight started
  — and nothing at all was drawn. Visibility asks `worldIsTown` (the party's
  town number) instead, which is what the C++ tests. If a whole panel goes
  blank in a new mode, suspect this shape of bug.
- (2026-07-25) A PC **only dies from a blow taken while already at zero
  health** (`damage_pc`): the hit that empties the bar leaves them standing.
  That is not a port slip, and a "fix" would make the game much harder.
- (2026-07-25) The saving roll in `cPlayer::sleep` compares `get_ran(1,1,100) +
  adjust` against a *floor*, so a **large positive `adjust` is what makes an
  effect land** — the specials pass 200 when a sleep is meant to be
  unavoidable. Easy to read backwards.
- (2026-07-25) `cCreature::sleep`'s negative-amount branch does
  `status[which] -= amount`, which *raises* the status instead of curing it,
  even though the code below reports "alert". It looks like a sign slip in
  CBoE; the port keeps it, with a test pinning the behaviour so nobody
  "fixes" it into a divergence.
- (2026-07-25) Sleep subtracts 25 from the roll *before* the `charm_odds`
  comparison (paralysis 15), so a roll of 1-25 beats even a threshold of 0.
  That's why sleep lands on high-level monsters that resist everything else.
- (2026-07-25) `is_special` is a *boolean* test in the C++, and this port's
  `specialAt` returns **-1** for "no special" — which is truthy. Comparing is
  required; `!session.specialAt(where)` silently marks every square special,
  which stacked the whole party on one tile in `placeParty`.
- (2026-07-25) `cPlayer::skill` (gear-adjusted, capped at 20 plus bulk
  bonuses) and `cPlayer::stat_adj` (raw skill through `skill_bonus`) are
  different functions and not interchangeable. Rolls use `skill`; the training
  screen and the stat bonuses use `stat_adj`.
- (2026-07-25) **`get_monst_sound` and `get_sound_type` return sound *types*,
  not sound files.** They are indices into `boom_space`'s
  `sound_lookup = {97,69,70,71,72,73,55,75,42,86,87,88,89,98,…}`, and the type
  travels as `damage_pc`/`damage_monst`'s `sound_type` argument down to
  `boom_space`, which does the lookup. Playing the index directly gives you a
  cash register instead of a rat's bite. A *negative* sound skips the table and
  is a file number.
- (2026-07-25) **`is_blocked` (boe.locutils.cpp) is much broader than terrain.**
  It also counts creatures, the party, other PCs, force barriers, cages and —
  during combat only — marked special spots and city-trim terrain (to keep
  combatants off portals). `place_party` and monster movement both depend on
  that breadth; a terrain-only version puts PCs inside walls and on top of
  monsters.
- (2026-07-25) `place_party` forces index 0 through whatever the criteria say,
  so the leading PC can legitimately stand somewhere blocked. Everyone else
  must not. And when no surrounding spot passes, the whole party stacks on one
  square — that's the original's behaviour in a cramped doorway, not a bug.
- (2026-07-26) **Parry is the SHIELD toolbar button**, not a button called
  Parry — `TOOLBAR_SHIELD` → `handle_parry`, and `TOOLBAR_WAIT` →
  `handle_stand_ready` (which is `parry = 100`, not just "spend the turn").
  Three fight-toolbar buttons were drawn but dead; a WAIT that only zeroed AP
  silently cost the player the stand-ready defence bonus.
- (2026-07-26) `TOWN_SET_ATTITUDE` names its creature by **slot in `ex1a`**
  with the attitude in `ex1b` — not by the trigger location, and not `ex2a`.
  Despite the name, `MAKE_TOWN_HOSTILE` is the group version and takes
  `set_town_attitude(ex1a, ex1b, ex2a)`: a *slot range*, not a monster type.
  Both were ported wrong first time round.
- (2026-07-26) **A throwing opcode handler used to kill all scripting for the
  rest of the session.** `SpecialsEngine.run` set `inProgress = true` and only
  cleared it on the normal path; there was no try/finally. Since almost every
  caller launches a chain fire-and-forget (`void runSpecial(...)`), one
  exception left the one-chain-at-a-time lock stuck at true, and from then on
  *every* special was silently pushed onto the queue and answered "nothing
  happened" — with no error anywhere the player could see. Now the flag comes
  down in a `finally`, the failure prints `SPECIAL ENCOUNTER FAILED.` and the
  detail goes to the console (which `verify-screen.mjs` fails on). If scripting
  ever "just stops" again, this is the shape to suspect.
- (2026-07-26) **`check_special_terrain` runs on outdoor moves too** —
  `outd_move_party` calls it first thing (boe.actions.cpp:3950) with
  `eSpecCtx::OUT_MOVE`. This port's version began `if (!town) return true`, so
  *nothing* outdoors ever hurt anyone: swamps didn't poison, lava didn't burn
  and CALL_SPECIAL terrain didn't fire. Only the terrain source and the
  special's context differ between the two modes. Pinned by two tests in
  `test/session.test.ts`.
- (2026-07-26) `uAbility` is a **real C union**: `missile`, `gen`, `summon`,
  `radiate` and `special` share storage, and which one is live follows from the
  *key* the ability is filed under, via `getMonstAbilCategory`. The port gives
  each its own object, so nothing stops code reading the wrong arm — always go
  through `abilityCategory(key)`. The `gen` arm's third field is the union
  inside the union: eDamageType for DAMAGE/DAMAGE2, eStatus for
  STATUS/STATUS2/STUN, eFieldType for FIELD.
- (2026-07-26) An ability's `chance` is a **percentage in the XML and tenths of
  a percent in the game** — `readMonstAbilFromXml` multiplies by 10. The one
  exception is `radiate`, which reads its chance as a plain integer.
- (2026-07-26) `RAY_HEAT` and `MISSILE_WEB` are filed under `<special>`, not
  `<missile>`: they sit inside `getMonstAbilCategory`'s SPECIAL range
  (SPLITS..DEATH_TRIGGER) despite their names.
- (2026-07-26) `get_ap_cost` returns **-1** for a touch ability. That isn't an
  error code — a touch rides along with the melee attack instead of costing a
  turn.
- (2026-07-26) `place_monster` re-assigns the monster template over the
  creature *after* `assign` has scaled it, throwing the difficulty adjustment
  away, and forces a friendly default attitude to hostile. Both are flagged as
  suspicious in the C++ with TODOs of their own; both are kept.
- (2026-07-26) A Creature's `mon` must be a **deep** copy of the scenario's
  definition now that `abil` is an array of objects — a shallow spread shares
  the ability table, and one monster splitting would edit every other monster
  of its kind.
- (2026-07-26) `place_treasure`'s forced mode (`mode == 1`) loops
  `do … while(no item || too expensive)` with **no exit** — a scenario whose
  treasure class holds nothing cheap enough would hang the game. The port caps
  it at 100 tries and leaves nothing; that's the one deliberate divergence in
  the function, and it can only differ from the C++ in a case where the C++
  never returns.
- (2026-07-26) `place_treasure` rolls the identify chance **once per living
  PC**, and keeps rolling after one has already succeeded. The extra draws
  change nothing visible but they move the RNG on, so a port that breaks out of
  the loop early desynchronises every later roll.
- (2026-07-26) `draw_map`'s small-icon branch is indexed by the terrain's
  **full-size `picture`**, not by the `map_pic` it just tested — `map_pic` only
  decides *which* branch runs (termap cell vs. a shrunken terrain tile). It
  reads like a slip, but every scenario's map is drawn against it, so the port
  keeps it with a comment.
- (2026-07-26) **A touch ability's odds test is backwards in CBoE.**
  `monster_attack` skips the ability when `get_ran(1,1,1000) <= gen.odds`, so a
  1000-in-1000 touch *never* fires and a 0-odds one always does (0 fails the
  `odds > 0` guard first). Kept verbatim, with two tests pinning both ends.
- (2026-07-26) `summon_monster`'s repeat loop is
  `while(--r1 && !failed) failed = summon_monster(...)` — `failed` takes the
  return value, which is **true on success**, so the loop stops as soon as one
  more creature lands and keeps trying only while summoning *fails*. A max of
  five therefore places two monsters, not five. Kept.
- (2026-07-26) A summon ability's `chance` is a **plain percentage**
  (`get_ran(1,1,100) < chance`), unlike every other ability's tenths — which is
  why `readMonstAbilFromXml` leaves it un-multiplied.
- (2026-07-26) `summon_monster` reads `where` two ways: in town, or while the
  monsters are taking their turn, it's the *caster's* square and the creature
  appears in a clear spot near it; in combat, when the party summons, it's the
  destination itself. The port passes a `monstersGoing` flag for the second
  half of that condition, since there's no global here.
- (2026-07-26) `set_town_attitude` returns early in an arena fight
  (`is_combat() && which_combat_type == 0`) — there's no town population there
  to turn, and running `spec_on_hostile` would be worse than useless.
- (2026-07-25) Movement, `talkTo` and `useSpace` are **async** now, because each can raise a dialog mid-action. `main.ts` keeps an `acting` flag so a held arrow key can't start a second move on top of the first — the C++ gets that for free by blocking.

## Handoff: what combat still needs (M5b and M5c)

M5a is done: the `iLiving` seam, damage and dying, combat mode, turn order and
the melee attack. `grep -rn "TODO(M5b" src/` is the honest list of what M5a
deliberately left at the seam — 13 markers as of now. In rough order:

1. ~~**Monster abilities (`uAbility`).**~~ **Done** (2026-07-26) — the data
   model, the parser, missiles and breath, summons and the touch abilities all
   landed; see the entries above. What still reads from it and isn't built:
   **monster spells** and **radiated fields** (which need the spell patterns
   from M5c).
2. ~~`monster_attack` and `combat_run_monst`~~ — **done**, in
   `game/monsterTurn.ts`, along with `do_monsters`, `seek_party`, `rand_move`,
   morale-driven fleeing and the on-hit touch abilities. Still missing from it:
   the free back-shot a
   monster gets when you step out of its reach (marked in `session.combatMove`),
   `monst_hate_spot`, `monst_check_special_terrain` and `monst_inflict_fields`.
3. **Missiles**: the *monsters'* half is done (`game/monsterAbilities.ts`).
   Still open: the **party's** missiles — FIRING/THROWING are already in the
   `GameMode` enum in the right places — `run_a_missile` (the projectile
   animation, which the monster half also wants), and `calc_spec_dam`
   (boe.combat.cpp:711), the slay-the-species damage bonus that
   `pcAttackWeapon` notes the place for.
4. **On-hit item abilities**: exploding weapons (needs spell patterns),
   STATUS_WEAPON, SOULSUCKER, ANTIMAGIC_WEAPON, WEAPON_CALL_SPECIAL.
5. **Random encounters outdoors** — the user reported this. It needs
   `create_wand_monst` and outdoor combat terrain (`create_out_combat_terrain`,
   boe.town.cpp:817), and `Sector.wandering` is already parsed and waiting.
6. ~~**`place_treasure` / `place_glands`**~~ — **done** (2026-07-26), in
   `game/loot.ts`. Corpses drop things now.

Then M5c: spells, spell patterns (`place_spell_pattern`), and the field
*behaviours* — damage on entry, quickfire spreading, webs slowing. The field
model, the overlay and the two field opcodes all landed with M4, so M5c is
about what fields *do*.

Fidelity notes for whoever picks this up:
- **`get_ran` call order is the spec.** `damagePc` rolls once per equipped
  armour piece and once for luck; `pcAttackWeapon` rolls to-hit then damage
  then (for a primary weapon) assassination. Keep the sequence even where a
  result goes unused.
- **`inTown` is false during combat** — MODE_COMBAT sits outside `is_town`'s
  range. Anything about seeing or lighting must ask `worldIsTown` instead.
    This one silently blanked the whole combat view once already.

### Reported by the user and fixed (second play-test, 2026-07-25)

- **The Fight (sword) button did nothing**, and the toolbar never swapped to
  `FIGHT_BUTTONS`, so End and Wait weren't there either. All wired now.
- **No hotkeys.** Replaced my invented set with the original's.
- **PCs placed inside walls and on top of monsters** — `is_blocked` was
  terrain-only. See the gotchas above.
- **The wrong attack sound** (a cash register) — sound types were being played
  as file numbers. See the gotchas above.
- **No damage animation**, though the log and the HP were right: `boom_space`
  had never been ported.

### Reported by the user and fixed (third play-test, 2026-07-26)

- **"Is parry/shield implemented?"** The rules were (`char_parry`,
  `char_stand_ready`, the `parry` term in `damage_pc`, shields as armour in the
  per-piece defence roll), but the **SHIELD, WAIT and ACT toolbar buttons were
  dead** — parry was keyboard-only, and clicking Wait zeroed AP without setting
  `parry = 100`. All three are wired now.
- **"Shouldn't I be able to attack peaceful NPCs?"** You couldn't: the swing
  was refused with "Blocked: a creature is in the way." Now it raises the
  original's attack-friendly prompt and turns the town hostile, via the new
  `set_town_attitude` port. See the gotchas above.

### Reported by the user and still open (2026-07-25)

Two of the seven issues from the first real play-test are genuinely blocked,
and both are honest gaps rather than bugs:

- ~~**The MAP button does nothing.**~~ **Fixed 2026-07-26** — see the automap
  entry above. Still missing from it: DETECT_LIFE's green monster dots (the
  party status effect doesn't exist yet) and custom scenario graphics sheets.
- **No random encounters outdoors.** In *towns* encounters now work: monsters
  notice the party and come after it. Outdoors still needs `create_wand_monst`,
  `handle_wandering_specials` (boe.specials.cpp:119) and — the big piece —
  `create_out_combat_terrain` (boe.town.cpp:817), which builds the arena an
  outdoor fight happens in. `Sector.wandering` is parsed and waiting.

The other five were fixed: talk-by-click, NPCs visible through unexplored
walls, using a web to clear it, the town-exit coordinate, and the Rest
command with its sound. Swamps poison again.

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

1. M5b continued: missiles, breath, summons and the touch abilities all landed
   2026-07-26, so what's left is monster spellcasting (`monst_cast_mage` /
   `monst_cast_priest`), the party's own missiles, and `run_a_missile` for all
   of them. Then outdoor wandering monsters, which additionally need the
   outdoor combat arena.
2. (The MAP overlay and `place_treasure` both landed 2026-07-26.)
3. M2's last leftover is the replay driver.
4. Part 2 (Exile 3) hasn't started; E3-0 (format groundwork) can proceed in
   parallel at any time.
