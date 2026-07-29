# exile-js Progress

> Live status of the project. See `PLAN.md` for the full approved plan.
> **Convention:** whoever works on this (any model/session) reads this file first, updates it as work lands, and commits it with the work.

## Quick orientation (read this first)

- `npm run dev` → the game at http://localhost:5199. `?scenario=stealth` loads another.
- Keys follow the original's `handle_keystroke` (boe.actions.cpp:2772):
  arrows/keypad move, **f** fight (and end a fight), **e** end combat,
  **w**/Space wait — stand ready in combat, **d** parry, **x** hold the turn on
  one PC, **t** talk, **l** look, **u** use, **b** bash, **g** get, **r** rest,
  **L** pick a lock, **1-6** whose pack shows, **9** the special items and
  **0** the quests,
  **a** the automap (drag it by its window), **A** alchemy (in town),
  **m**/**p** spells, **s** shoot (in combat: arms the
  missile, then click a square; **s** or Escape cancels). Keys for things not
  built yet say which milestone they're
  waiting on. In conversations: l/n/j/b/s/r/d/g/a. In shops: **a-h** buy, arrows
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

**M2 done bar the replay driver, M3 nearly done, M4 and M5 complete, M6 begun (2026-07-27): full 605×430 UI on the real Universe/GameSession architecture. A new game starts in the scenario's start town with the pregen party; you can walk the world with line-of-sight fog, lighting, terrain trim, roads, floor items and step sounds, talk to townspeople, open and bash doors, look at things and read signs, **pick up, equip, give and drop items**, and **buy, sell, identify, recharge, train and stay the night**. Remaining M2: the replay driver. Scenario scripting runs: walking onto a scripted square, looking at one, entering or leaving a town, or using a lever fires its chain, and Fort Talrus's own messages, its Rest prompt and its walk-through-a-wall node all work. Remaining M3: enchanting (needs M5's enchantment table), job banks (M6), and the full dialogxml toolkit. Remaining M4: the opcodes that need combat, fields, timers or quests — each one says so in the transcript rather than failing silently. **Combat is playable**: the SWORD button (or **C**) starts a fight, the party spreads out as six figures with action points, and you can swing, move, swap places, kill things and earn experience. Monsters notice you, walk over and hit back, in town mode as well as in combat — so Fort Talrus's eight Giant Rats will come for you from the moment a new game starts. The `uAbility` port landed 2026-07-26, so monster abilities are real data now; monsters shoot, breathe, summon aid and land their touch attacks; the party can shoot back with **S**; projectiles fly across the screen; and `place_spell_pattern` works, so exploding weapons blast, monsters lay fields and a protective circle raises four rings of wall. **M5 is closed**: monster spellcasting, the 147-spell list, `process_fields` and the real casting dialog all landed 2026-07-26. **M6 has started**: quests, job banks, special items and the town/scenario/party timers work as of 2026-07-27, so a scripted deadline can expire and a timed node can fire — **items can be Used**: the USE button on an inventory row drinks the potion, fires the wand and reads the book — and **boats and horses work**: walk onto one to board it, dry land to leave it, Space to dismount or re-board, and `CHANGE_HORSE_OWNER`/`CHANGE_BOAT_OWNER` hand one to the party — and **the job board works**: a JOB_BANK conversation node opens it, and a quest taken there (or handed over by a RECEIVE_QUEST node) runs on the timers that were already ported — and **the item panel has all three of its pages**: the tabs along its bottom (or 9 and 0) show the party's special items and its quests, and the scrollbar beside them finally reaches the other sixteen slots of a pack.

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
- **Talking (M3a)**: `game/talk.ts` (`TalkState`) ports start_talk_mode/handle_talk_node/reset_talk_words/scan_for_response; `render/talkScreen.ts` ports place_talk_str/place_talk_face. Press T (or the TALK toolbar button) then a direction. Keyword matching is first-4-chars case-insensitive, and nodes are filtered to the personality (or -2 = anyone in town). Node types implemented: REGULAR, DEP_ON_SDF, SET_SDF, DEP_ON_TIME(_AND_EVENT), DEP_ON_TOWN, BUY_INFO, BUY_SDF, BUY_SPEC_ITEM, BUY_TOWN_LOC, END_FORCE/FIGHT/ALARM/DIE, SHOP, INN, TRAINING, SELL_WEAPONS/ARMOR/ITEMS, IDENTIFY, ENCHANT, RECHARGE, JOB_BANK, RECEIVE_QUEST, CALL_TOWN_SPEC, CALL_SCEN_SPEC. Still unimplemented (and saying so in the transcript rather than failing silently): BUY_SHIP, BUY_HORSE.

Notes for M2 implementer:
- The window is **605×430** (`global.hpp:30`), not 800×600 — the earlier plan text was wrong. index.html scales the canvas ×2 in CSS.
- The inventory panel is a placeholder until the item/equip model lands (M3).
- Trim stencilling: trim.png is a 1-bit **black-on-white** bitmap; black = "let the neighbouring ground show through". The C++ uses a fragment shader; we use an offscreen tile + `destination-in` against an alpha mask. Masks sit at the same offset inside a 28×36 cell as inside the sheet.
- Still missing from the terrain view: fields/barriers/webs overlay (`draw_fields`), boats and horses, special-spot markers, and the `sightObscurity` contributions those add.
- Monster abilities are captured as lossless `RawAbility` records (monster.ts) — port uAbility union semantics at M5, reference readMonstAbilFromXml (fileio_scen.cpp:1425).
- Town reader reference: readTownFromXml (fileio_scen.cpp:1839), loadTownMapData; town terrain templates are variable-size (min 24); talkN.xml via readDialogueFromXml.
- scenarioXml.ts skips deferred sections by name (quests/shops/special-items/strings) — tighten as those land.

- `npm test` → 824 tests green (50 files); `npm run dev` → the game screen (arrow keys / keypad, Home/End/PgUp/PgDn for diagonals; `?scenario=stealth` to load another).
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
  milestone they're waiting on. The projectile that flies while it happens is
  `run_a_missile` — see the entry below.
- **The projectile animation (M5b, 2026-07-26)**: `game/missileAnim.ts` ports
  `run_a_missile` and `get_missile_direction` (boe.newgraph.cpp:297/517), and
  `Screen.drawMissiles` ports `do_missile_anim`'s drawing half. Same
  arrangement as `booms.ts`: the C++ blocks, stepping the sprite along and
  sleeping, so here the request goes to a sink the renderer owns and a rAF loop
  redraws until every missile lands. Rows 0-6 of missiles.png are directional
  (the column is `get_missile_direction`'s heading); 7 and up are animated and
  the column cycles with the step. `pathType` 1 lobs the missile in an arc.
  Wired into the party's `fireMissile` and every branch of the monsters'
  `monstFireMissile`. **A missile with a negative `pic` still plays its sound
  but draws nothing**, and one that travels zero distance is dropped — both
  are the C++'s own rules, and the verify script's test arrows needed a real
  `missile` index before anything showed.
  Not ported with it: the mid-flight camera move (`camera_dest` and the
  `recentered` branch), which follows a missile off the edge of the view. Ours
  clips there instead.
- **Spell patterns (M5c, 2026-07-26)**: `data/pattern.ts` ports `eSpellPat` and
  every builtin table from pattern.cpp; `game/spellPatterns.ts` ports
  `place_spell_pattern` and `modify_pattern`; `game/fieldEffects.ts` ports the
  helpers it leans on — `web_space`, `scloud_space`, `sleep_cloud_space`,
  `dispel_fields`, `break_force_cage` and `crumble_wall`. Wired into exploding
  weapons (melee **and** missile), the monsters' FIELD ability, and RADIATE.
  Three things worth knowing:
  - **The pattern literals are indexed `[x][y]`**, so each line as written in
    pattern.cpp is a *column*. Every builtin but `PAT_WALL` is symmetric, so it
    only shows up in which wall rotation is which — rotation 0 is the
    horizontal band, rotation 2 the vertical one.
  - **`PAT_PROT`'s cells are field types, not shape marks** (1 = force wall,
    5 = ice, 6 = blades, 3 = antimagic), which is why it is the one builtin
    placed unmodified and why one call raises four concentric rings.
  - **`dispel_fields`'s `mode >= 1` sets the adjustment to -10**, which no
    saving roll can recover from — so the scripted dispel sweeps the square
    clean and mode 0 (the spell) is the *weaker* one. The six rolls happen
    either way, so the RNG sequence matches. The deterministic
    `CurTown.dispelFields` that used to stand in for this cleared far too much
    and is gone.
  Still to come in M5c: the spells themselves, and `process_fields` — what
  fields do *over time*, as opposed to when they land.
- **The rest of `monst_fire_missile` (M5b, 2026-07-26)**: the port used to send
  only MISSILE through `monsterFireMissile` and everything else straight to
  `monsterBasicAbil`, which silently skipped the whole preamble — so a ray, a
  gaze, a breath or a spit announced nothing, MISSILE_WEB never webbed anything
  and RAY_HEAT did nothing at all. `monstFireMissile` is now the single entry
  the C++ has, with all four branches: the missile itself, the thrown web (plus
  a `web_space` port, boe.combat.cpp:5253), the heat ray and its fire-damage
  proxy ability, and the general case with its spell note, sound and path type.
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
- **Random encounters outdoors (M5b, 2026-07-26)**: the last of the seven
  first-play-test complaints. `universe/outdoorCreature.ts` +
  `party.outC[10]` port `cParty::cOutdoorCreature`: a wandering group is *not*
  a creature on the world map, it's a whole encounter definition (seven hostile
  types and three friendly) roaming the 96×96 window. `game/wandering.ts` ports
  `create_wand_monst` (both halves — towns spawn real creatures near their
  wandering points, and they *persist* across re-entry), `place_outd_wand_monst`,
  `outdoor_move_monster`, the outdoor half of `do_monsters`, `out_enc_lev_tot`
  and `count_walls`. `game/outCombat.ts` ports `create_out_combat_terrain`
  (all twenty arena kinds, their terrain-odds tables, the lake/pillar/fume/camp
  stamps, roads, crops and the extra walls) and `start_outdoor_combat`.
  `session.afterPartyTurn` now rolls for a group every tenth outdoor turn and
  every town turn, moves the groups, and starts the fight when one reaches the
  party — after its `spec_on_meet` chain has had a chance to call it off, and
  after `initiate_outdoor_combat`'s "Monsters fled!" test lets a weak encounter
  run away. Ending an outdoor fight refuses while anything hostile still
  stands, then puts the party back on the world map and fires `spec_on_win`.
  The groups draw on the terrain view (draw_monsters' outdoor half).
- **On-hit weapon abilities (M5b, 2026-07-26)**: `game/weaponAbilities.ts`
  ports `apply_weapon_status` (boe.combat.cpp:459) and the on-hit chain both
  `pc_attack_weapon` and `fire_missile` run — STATUS_WEAPON, SOULSUCKER,
  ANTIMAGIC_WEAPON and WEAPON_CALL_SPECIAL — plus `onHitTargetSpecial`, the
  chain the *target* runs (a creature's HIT_TRIGGER, a PC's HIT_CALL_SPECIAL),
  which monsters' melee fires too. `pcAttackWeapon` now calls `calcSpecDam`, so
  slayer and damaging weapons finally do their extra damage, with the C++'s
  spec/bonus swap deciding which sound type it booms with. The one seam:
  WEAPON_CALL_SPECIAL's chain is launched fire-and-forget and the free-swing
  action points are handed back when it resolves, because the melee path is
  synchronous and the C++ blocks there.
- **The party's missiles (M5b, 2026-07-26)**: `game/missiles.ts` ports
  `load_missile` (boe.combat.cpp:1459), `fire_missile` (:1531) and
  `calc_spec_dam` (:711). **S** in combat arms whatever the acting PC has
  equipped — a thrown weapon wins outright and reaches 8, a bow with arrows or
  a crossbow with bolts reaches 12, and the mismatched pairs each get their own
  refusal — and the game drops into `MODE_FIRING`/`MODE_THROWING`, where the
  next square clicked (or arrow key pressed) is the shot; **S** again or Escape
  cancels. The shot itself is complete bar the animation: skill from the
  launcher's `weap_type`, the ACCURACY/DISTANCE_MISSILE/SEEKING_MISSILE item
  abilities, the nephil bonus, the damage-scaling ammunition abilities, poison
  that only rides the ammunition it was applied to, and the charge accounting
  (RETURNING_MISSILE, DRAIN_MISSILES, the pack losing an empty stack).
  `calcSpecDam` is shared with melee and carries the slayer table with both its
  widened bane rules. Still open here: EXPLODING_WEAPON (needs M5c's
  `place_spell_pattern`) and the on-hit item abilities.
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

- **The party stats panel comes alive (2026-07-26)**: `data/statusIcons.ts`
  ports `status_info` (damage.cpp:13) and `get_stat_effect_rect`
  (boe.text.cpp:637), and `Screen.drawPcEffects` ports `draw_pc_effects` — the
  status icons beside each name, which is where "poisoned" finally *shows*
  rather than scrolling past in the transcript. A signed status draws a
  different icon each way (blessed vs cursed, hasted vs slowed) and poison
  switches to a nastier icon from level 4 up, which is the only use of
  `status_info`'s `special` band. Clicking a PC row works too
  (`Screen.pcRowHit` + the PC branch of `handle_action`): the name switches who
  is active — in combat that needs APs, not a pulse, and it works mid-shop so
  you can change who is buying — the HP and SP columns read themselves out, and
  the two icons are Info and Trade Places. `switch_pc` takes two clicks and
  `increase_age` cancels a half-finished one every turn.
  - *Gotcha (2026-07-26)*: `draw_pc_effects` tests its right limit **after**
    drawing and once per *status* rather than per icon, so a long enough name
    gets one icon painted over the HP column before the row gives up. Kept, and
    commented — it is what the original does.
  - Info is still the transcript version of the character sheet, not
    `give_pc_info`'s `pc-info.xml` dialog — TODO(M6), with the dialogxml
    toolkit.
- **Gotcha (2026-07-26): `verify-screen.mjs`'s missile assertion was
  timing-dependent.** It read `screen.missiles` straight after the party's shot
  and demanded exactly one projectile. Once monster thrown weapons became
  visible (the "spears you never saw" fix), the preceding step — which turns the
  town hostile — could leave a townsperson's spear still in the air, so the gate
  failed on two. The step now empties `screen.missiles` before firing, which is
  what the assertion always meant. Worth remembering: that array is the whole
  screen's projectiles, not one actor's.

- **`process_fields` — what fields do over time (M5c, 2026-07-26)**:
  `game/processFields.ts` ports `process_fields` (boe.combat.cpp:5099) and the
  four helpers under it — `hit_space`/`hit_pcs_in_space` (:4315),
  `monst_inflict_fields` (boe.monster.cpp:802), `sync_force_cages` (:1751) and
  `process_force_cage` (:5059). Fields are no longer scenery: a wall of fire
  burns whoever stands in it every turn and rolls to go out, quickfire creeps
  outwards (four times a turn in combat) and burns through crumbling barriers,
  stinking clouds curse, sleep clouds put you under, webs catch monsters and
  are used up doing it, and force cages tick down while their occupants roll to
  break out. Wired at both C++ call sites: `combat_run_monst` right after the
  monsters act, and `increase_age` in town — which runs *before* `do_monsters`
  (boe.actions.cpp:1266), so the order is the original's.
  `startCombatRound` now opens with `sync_force_cages`, as `combat_next_step`
  does.
  - *Gotcha*: the RADIATE check in `monst_inflict_fields` reads backwards. A
    monster is only hurt by a field if it radiates *some other* field, so a
    monster that radiates nothing walks through walls of blades untouched.
    Quickfire is the exception and always burns. Kept.
  - *Gotcha*: every arm of `monst_inflict_fields` ends in a `break`, so a
    monster only ever suffers the **first** field on its square, in source
    order. The C++ has a TODO wondering about that; kept as-is.
  - *Gotcha*: `processing_fields` and `monsters_going` are dead letters inside
    `process_fields`. Everything there goes through `hit_pcs_in_space`, which
    adds 10 to `hit_all` and turns monster-hitting off entirely — monsters take
    their field damage from `monst_inflict_fields`. This port passes
    attribution as an argument rather than keeping the globals, matching how
    the rest of the combat code already does it.
  - `cCurTown.quickfirePresent` is latched in `setField` rather than in the
    three places the C++ latches it, since that is the one road they all take.
    Never cleared, as in the C++.
  - Still not ported: `place_quickfire`'s own placement rules (it refuses
    blocking terrain, rolls against antimagic, and clears other fields first).
    Quickfire currently goes down through plain `setField`.

- **The spell list and who may cast it (M5c, 2026-07-26)**: `data/spell.ts`
  ports `eSpell` and the whole `cSpell` dictionary — all 147 entries from
  spell.cpp, with `refer`, cost, range, level, selector, skill, the
  when-castable bit field, `peaceful` and `target_lock`. The numbers are
  verbatim because a PC's known spells are stored as flags indexed by them:
  mage 0..61 with scenario-granted specials at 62..78, priest the same from
  100. **The table was transcribed by script from spell.cpp rather than by
  hand** — 147 builder chains is too many to retype reliably — and the
  generator checked that every `eSpell` member got exactly one row.
  `game/spellCast.ts` ports both `pc_can_cast_spell` overloads: the per-spell
  one (skill, level, points, known-flags, pacifism, dumbfounding, sleep and
  paralysis, and where the spell may be cast) and the per-skill one that the
  caster buttons use, returning `eCastStatus` so the UI can say *why* not.
  - *Gotcha*: `needsSelect()` in the C++ builder quietly sets `peaceful` as
    well as the selector. Every entry that calls it carries both here.
    `peaceful` means "a pacifist may cast this", **not** "only outside combat".
  - *Gotcha*: the dumbfounding test is `DUMB >= 8 - level`, so a dumbfounded PC
    is silenced at DUMB **7**, one step before the status maxes out — even a
    level-1 spell needs DUMB < 7.
  - *Gotcha*: `pc_can_cast_spell(pc, type)` **consumes RNG**, because
    `total_encumbrance` rolls per item. Asking "can they cast?" is not a free
    question, and the call order is part of the spec.
  - *Gotcha*: that same function checks only the *first* known mage spell
    before giving up (`break`), but tries every known priest spell. The
    asymmetry looks like a bug and is kept.
  - `isMage`/`isPriest` deliberately answer no for the special spells (62+,
    162+): those belong to scenario scripting and monsters, not the spell list.
  - Not yet ported: the effects themselves — `do_mage_spell` (boe.party.cpp:616),
    `do_priest_spell` (:873), `do_combat_cast` (boe.combat.cpp:839) and the two
    `combat_immed_*_cast` functions. That is the next piece of work, and it is
    the last thing standing between the port and a playable M5.

- **Spells that do something, out of combat (M5c, 2026-07-26)**:
  `game/spellTown.ts` ports `do_mage_spell` (boe.party.cpp:616),
  `do_priest_spell` (:873) and the `cast_spell` entry point (:494), so the
  town/outdoors half of the spell list works: light, true sight, stealth,
  flight, magic map, the protections, every summon on both lists, location,
  manna, the heals and cures, raise dead and resurrect, remove curse, destone,
  the party-wide heals and hides, shatter, detect life and firewalk.
  `universe/party.ts` gains `partyStatus` (`ePartyStatus` — stealth, flight,
  detect life, firewalk), which several of these set and which the automap's
  DETECT_LIFE dots were waiting on.
  - *Shape worth knowing*: almost every arm deducts the spell's cost itself
    rather than the caller doing it once, because several spells decide **not**
    to charge — a summon that fails, a Flight cast while already flying, an
    Identify with nothing to identify. `freebie` means the spell came from an
    item and never costs points.
  - *Gotcha*: `do_priest_spell` reads the **current** PC's Anama trait when
    working out the level bonus, not the caster's. Kept as written.
  - *Gotcha*: three of the summon arms roll a `store` value and throw it away
    before recomputing it (the C++ has its own "why is this discarded?"
    comment). The rolls are kept, because they move the RNG and `get_ran` call
    order is part of the spec.
  - *Gotcha*: `RAISE_DEAD` rolls `get_ran(1,1,level/2)`, which below level 2 is
    `get_ran(1,1,0)` — undefined in the C++. Our `getRan` clamps an empty range
    and returns 1, so a level-1 caster always reduces the body to dust.
  - **Divergence, deliberate**: the arms that read `store_spell_target` (the
    protections, the single-target heals and restorations) take *the caster* as
    the target, because the caster/target dialog doesn't exist yet. That makes
    `SYMBIOSIS` permanently answer "Can't cast on self." Revisit when the
    spellcasting dialog lands.
  - Reporting rather than doing, each marked in place: the arms that call
    `start_town_targeting` (Unlock, Capture Soul, the barriers, Quickfire,
    Dispel, Antimagic, Move Mountains, Ritual of Sanctification), Identify and
    Recharge (they open MODE_ITEM_TARGET), and Word of Recall (needs the
    town-entry plumbing, TODO(M6)).
- **Gotcha (2026-07-26): a float-precision flake in `increaseAge.test.ts`.**
  The animation-timeline assertions compared differences of two
  `performance.now()`-derived floats against an exact `MISSILE_MS`, and a gap
  that is exactly 200ms in real arithmetic can read back as 199.9999999999999
  once the timestamps grow large enough. It passed for months and started
  failing ~40% of the time purely because new modules made the suite take
  longer to reach it. Now compared with a 0.001 slack, which still catches the
  bug those tests pin (a spacing of *zero*).

- **Town targeting, and spells you can actually cast (M5c, 2026-07-26)**:
  `game/spellTarget.ts` ports `start_town_targeting` (boe.party.cpp:2269) and
  `cast_town_spell` (:1293), so the dozen spells that ask for a square work:
  Unlock, Dispel Barrier, the fire and force barriers, Quickfire, Antimagic,
  Scry Monster, the three Dispels, and both Move Mountains. `GameSession`
  gained `townTarget`, which mirrors how `missile` already drives FIRING mode,
  and a click in `TOWN_TARGET` resolves it (`main.ts`).
  **`m` and `p` now open a real spell picker** — caster first when more than
  one can cast, then the spells that PC can cast *here*, with costs, out of
  `castableSpells`. The old "(Spells need M5c)" stub is gone.
  - *Ordering that matters*: the cost is spent in `cast_town_spell`, not when
    targeting starts. Cancelling out of targeting is free; a spell that fails
    its roll has still been paid for.
  - *Gotcha*: the in-town bounds test is strict on all four sides
    (`where.x <= rect.left`, etc.), so the town's outermost ring of squares
    can't be targeted at all.
  - *Gotcha*: `start_town_targeting` silently substitutes PAT_SINGLE for a
    rotatable pattern, because town targeting can't ask which way a wall faces.
    Its own TODO wants an error instead; kept silent.
  - *Gotcha*: the barrier arms set the field and then *read it straight back*
    to decide which message to print, because `set_*_barr` can refuse.
  - *Gotcha*: Antimagic's cloud is radius 2 with the corners cut off
    (`|dx| < 2 || |dy| < 2`) — a plus sign with shoulders, not a 5x5 block.
  - `combat_percent` (boe.party.cpp:56) lands here as `COMBAT_PERCENT`; note it
    *falls* with level and the callers subtract it from a constant, so a higher
    level is a wider target.
  - Still reporting rather than doing: Capture Soul needs `record_monst`, and
    Scry Monster notes the monster (which is the lasting part) but doesn't open
    `display_monst`'s dialog. `cast_spell_on_space` — a TARGET-context special
    node intercepting a spell — needs `eSpecCtx::TARGET`, TODO(M6).

- **Two spellcasting bugs from the first play-test of it (2026-07-26)**:
  - **"Nobody can cast a mage/priest spell."** The pregen party was built with
    *no spells known at all* — `mageSpells`/`priestSpells` were initialised to
    all-false and nothing ever filled them in. The C++ sets
    `cPlayer::basic_spells` in the base `cPlayer` constructor
    (pc.cpp:28, :1023), which every preset runs through:
    `numeric_limits<uint32_t>::max() >> 2`, i.e. bits 0..29, so **every PC
    starts knowing the first 30 spells of each list** and learns the rest from
    books and scenario nodes. Now `BASIC_SPELLS` in `universe/player.ts`, with
    a regression test that the starting party can actually cast something.
  - **The MAGE and PRIEST toolbar buttons said "not implemented yet."** Only
    the `m`/`p` keys had been wired; the buttons fell through to the
    catch-all. Both now run the same `castSpellFlow`.

- **Casting in combat (M5c, 2026-07-26)**: `game/spellCombat.ts` ports
  `combat_cast_mage_spell`/`combat_cast_priest_spell` (boe.combat.cpp:4517,
  :4745) and the two `combat_immed_*_cast` functions under them (:4596, :4798),
  plus `do_shockwave` (:4261).
  - **In combat there is no caster to choose.** The C++ calls
    `pick_spell(univ.cur_pc, …)`, which sets `can_choose_caster` false — the
    active PC casts, full stop. Out of combat `cast_spell` passes 6 instead,
    and *that* is what opens the caster buttons. `main.ts` now follows this:
    pressing `m`/`p` in a fight goes straight to the spell list.
  - `combat_cast_*_spell` is a dispatcher on the spell's `refer`: `REFER_YES`
    hands off to the town implementation (after 6 AP), `REFER_IMMED` resolves
    at once, and `REFER_TARGET`/`REFER_FANCY` want a square.
  - *Play-test fix*: **every combat spell used to report "not implemented for
    town mode"**, because `m` routed straight to `do_mage_spell`, whose switch
    only covers the town arms. The immediate spells now work (haste, bless,
    strength, envenom, resist magic, the group slows/fears/paralyses, the two
    auras, shockwave), and the targeted ones say they need combat targeting
    instead of talking about towns — and spend neither points nor AP.
  - *Gotcha*: an encumbered mage who tries to cast **loses 6 AP anyway**
    (`combat_cast_mage_spell` takes the AP on NO_CAST_ENCUMBERED).
  - *Gotcha*: `HASTE_SLOW` and `BLESS_CURSE` are single signed statuses, so
    Haste is `slow(-n)` and Strength is `curse(-n)`. A slowed monster's
    `HASTE_SLOW` goes *below* zero.
  - *Gotcha*: the priest group spells (Curse All, Mass Charm, Pestilence) do
    **not** check line of sight, while the mage ones do. The C++ has a TODO
    asking whether that is right; kept.
  - Still open: `start_spell_targeting`/`start_fancy_spell_targeting`
    (:4910, :4961) and `do_combat_cast` (:839, ~600 lines) — the targeted
    combat spells, which is the bulk of the offensive list.

- **Quests, timers and the party's bookkeeping (M6, 2026-07-27)**: the first
  chunk of M6, and the one most of the rest was waiting on. `data/quest.ts`
  ports `cQuest`, `cJob`, `eQuestStatus`, `job_bank_t` and `cSpecItem`;
  `scenarioXml.ts` stops skipping `<quest>`, `<timer>` and `<special-item>` and
  ports `readQuestFromXml`/`readTimerFromXml`/`readSpecItemFromXml` (the town
  parser now shares the timer reader); `Party` gains `activeQuests`,
  `partyEventTimers` (+ `startTimer`) and `jobBanks`; and
  `game/specialIncreaseAge.ts` ports `special_increase_age`
  (boe.specials.cpp:1871) — quest deadlines expiring, job boards getting angry
  and cooling off, and the town, scenario and party timers firing their nodes.
  Wired at all three C++ call sites: `increase_age`'s tail (so it runs between
  the status upkeep and `process_fields`), `combat_run_monst`, and `do_rest`.
  The VM gained `queue_special` and the queue check from the tail of
  `handle_action`. The opcodes that were reporting themselves now work:
  `SCEN_TIMER_START`, `TOWN_TIMER_START`, `UPDATE_QUEST` and `IF_QUEST`; so do
  the quest-item paths in `give_item`, `ok_to_buy` and the town's preset-item
  placement, and `cUniverse::generate_job_bank`.
  - *Gotcha*: a **town or scenario timer zeroes itself the first time it
    fires**, so a "`freq` = 50" timer is really once-only, not every 50 days.
    That's the C++ (it assigns `time = 0` inside the loop that just ran the
    node), and scenarios are written against it.
  - *Gotcha*: `increase_age` calls `special_increase_age()` with the **default
    length of 1**, even outdoors where the clock just jumped by 5 or 10. So an
    outdoor turn ticks a party timer down by one, and the `age_before + 1 .. age`
    window the periodic timers scan misses most of the multiples it passed.
  - *Gotcha*: a `TOWN_TIMER_START` node prints no message and a
    `SCEN_TIMER_START` node does (`check_mess`). Asymmetric, and kept.
  - *Gotcha*: party timers are **blanked, not removed** when they fire (time 0,
    node -1), because the slot numbering is part of the save format. The ones
    whose `nodeType` is TOWN *are* dropped on leaving town, since their node
    numbers index a list that's going away (boe.town.cpp:590).
  - *Gotcha*: the C++ reads `active_quests[n]` through `std::map::operator[]`,
    which **inserts** a default AVAILABLE record for every quest it merely
    looks at. Here an absent entry reads as AVAILABLE instead; the one place
    the difference could show is `UPDATE_QUEST`, which needs the record to
    exist, so that one creates it explicitly.
  - *Gotcha*: `generate_job_bank` fills at most **four** of a board's six slots
    and stops scanning the quest list once they're full — a quest late in the
    list can never be offered while earlier ones keep winning their rolls.
  - `cSpecItem::flags` is two bits packed by *addition*: +1 useable, +10
    start-with. The C++ tests them as `flags % 10 == 1` and `flags >= 10`.
  - Still open in this area: the quest pane of the item window. (The JOB_BANK
    talk node and `RECEIVE_QUEST` landed 2026-07-28 — see the entry at the
    bottom.)

- **Using an item (M6 / M3's last leftover, 2026-07-27)**: `game/itemUse.ts`
  ports `use_item` (boe.specials.cpp:585, ~620 lines) with `poison_weapon`
  (boe.party.cpp:442) and `drain_pc` (:390) under it, and `data/item.ts` gains
  `abil_chart` plus `can_use` / `use_in_town` / `use_in_combat` /
  `use_outdoors` / `use_magic` / `abil_harms` / `abil_group`. The **USE button
  is now drawn on every inventory row that can take one** and clicking it works:
  potions heal and poison, wands and staves cast their spell, scrolls and books
  open their text, rings light the room, and the summoning and quickfire items
  do their thing. `Party` grew cParty's iLiving half (the `*All` methods) since
  a HELP_ALL item hits all six PCs, and `inventory.ts` gained `removeCharge`.
  - **The shape to know**: `takeCharge` starts true and every refusal turns it
    off, so an item that couldn't be used doesn't lose a dose. It's also how
    three *successful-looking* branches decline to charge — a failed
    `poison_weapon`, a Flight cast while already flying, and a CALL_SPECIAL
    chain that returns `a`.
  - `abil_chart` is the whole gate on what's usable: an ability not in that
    table can't be Used at all, which is how `can_use` says no to the sixty-odd
    passive abilities without listing them.
  - *Gotcha*: the group arm of AFFECT_STATUS / POISONED_WEAPON reads
    `takeCharge = takeCharge || poison_weapon(i, ...)`, so **once one PC's
    weapon is poisoned the `||` short-circuits and nobody else's is**. Kept.
  - *Gotcha*: MESSAGE (a book) sets `takeCharge = false` outright — reading is
    always free, which is also why `put_item_screen` hides the charge count on
    one.
  - *Gotcha*: cancelling Flight can **kill the whole party**. If the square
    below blocks movement you plummet to your deaths; otherwise you take
    `get_ran(current, 1, 12)` unless the effect had one turn left.
  - *Gotcha*: MASS_SUMMONING rolls `get_ran(str,1,4)` and throws it away (the
    C++ has its own "why is this here?" comment), then passes the *count* of
    summons as each one's duration rather than the item's strength. Both kept.
  - *Gotcha*: the AFFECT_SPELL_POINTS and AFFECT_STATUS/ACID harm arms write
    the pool or the status **directly** rather than through `drain_sp` / the
    status call, so neither caster resistance nor the usual clamping applies.
  - *Divergence, invisible*: `poison_weapon`'s C++ loop reads `equip[...]` one
    past the end of the pack when nothing poisonable is found at all, which is
    undefined there; this port's search simply runs out and reports "No weapon
    equipped", which is what that code was trying to do.
  - *Worth knowing for tests*: **PC 0 of the pregen party (Jenneke) is
    magically inept**, so she refuses every magic item — and the pregens carry
    no gear at all, so a `poison_weapon` test has to equip a weapon first. Both
    cost a round of confusing test failures.
  - `verify-screen.mjs` gained a step that finds the USE button by hit-testing
    the panel, clicks it for real through the canvas's bounding box, and checks
    the potion healed and lost a dose.

- **Spell targeting: the crosshair, and the bug that made every spell hit the
  next square (2026-07-27)**. Two defects found by play-testing scrolls:
  - **The bug.** `main.ts`'s terrain-click branch decided between "act on the
    square you clicked" and "step once toward it" with
    `if (pending === null && session.missile === null)`. `pending` is only ever
    set by Talk/Look/Use/Bash, and **spell targeting sets neither** — so every
    click in TOWN_TARGET, SPELL_TARGET and FANCY_TARGET was reduced to one step
    toward the target, and no spell in the game could reach past an adjacent
    square. The condition now asks `isAiming()`, which covers the missile and
    both spell-targeting states.
  - **The missing crosshair.** `draw_targeting_line` (boe.graphics.cpp:1708)
    and `draw_targets` (:1665) had never been ported, so there was no visible
    targeting at all. `Screen.hover` now tracks the pointer (the `InputRouter`
    grew `onHover`/`onHoverEnd` from mousemove/mouseleave, which it had no
    notion of before) and `Screen.drawTargetingLine` draws the grey line from
    the caster to the cursor plus a white frame around every square the spell's
    pattern would cover; `drawTargets` marks the squares a multi-target spell
    has already collected.
  - *Worth knowing*: the overlay draws **only when the hovered square is both in
    line of sight and within range**, so the crosshair vanishing *is* the "you
    can't reach that" feedback — there is no other message. Outdoors it is
    skipped entirely (`if(!is_out()) draw_targeting_line()`).
  - *Gotcha*: town targeting's overlay is gated on `current_pat[4][4] != 0` —
    a pattern with an empty centre gets no crosshair.
  - `current_spell_range` is a flat **8** for every town spell, set by
    `do_mage_spell` (boe.party.cpp:631) and `do_priest_spell` (:893) before they
    hand over; it is not the spell's own range and it doesn't gate the cast.
    It lives on `TownTarget.range` now.
  - The `+19`/`+7` constants in `draw_targeting_line`'s rect maths are just the
    terrain view's origin (`win_to_rects[WINRECT_TERVIEW]` is `{7,19,358,298}`),
    which is why this port's panel-relative `terrainSpotPos` matches it.
  - `verify-screen.mjs` gained a step that hovers three squares east, checks the
    crosshair appears, clicks, and asserts the barrier landed on **that** square
    rather than the adjacent one.

- **The viewport arrows and the spells you couldn't see (2026-07-27)**. Two
  more from the same play-test.
  - **The pointing arrows.** `draw_pointing_arrows` /
    `draw_one_pointing_arrow` (boe.graphics.cpp:1601) had never been ported:
    twelve little arrows around the terrain view, two per edge and one per
    corner, drawn from invenbtns. They appear in `scrollableModes`
    (boe.consts.hpp:44) — SPELL_TARGET, FIRING, THROWING, FANCY_TARGET and the
    two Look modes — and clicking them scrolls the view so a spell can reach
    something off screen. `session.screenShift` ports `screen_shift`
    (boe.actions.cpp:1465) with its bounds, and the view snaps back to the
    caster once the spell resolves or is cancelled (:888).
    - *Gotcha*: **TOWN_TARGET is not in `scrollableModes`** — a town spell
      can't scroll the view. Only combat targeting, missiles and Look can.
    - *Gotcha*: the C++ doesn't hit-test the arrows at all. It asks whether the
      click is inside the terrain *panel* but outside the 9x9 grid inset 13px
      within it, so **the whole border is live** and the arrows are only a hint
      about where to click. Each of the four edge tests is independent, so a
      corner scrolls diagonally. Kept.
    - This port's Look is a `pending` flag rather than a mode, so LOOK_TOWN and
      LOOK_COMBAT are in the set for fidelity but never reached yet.
  - **The missing projectiles.** `do_combat_cast` dropped every `add_missile`
    call, so Flame, Spark, Kill, the arrow spells and the summons all did their
    damage with nothing on screen. `spellCombatTarget.ts` now ports
    `add_missile` (boe.newgraph.cpp:278) and the `do_missile_anim` call sites.
    - The shape: most arms only *queue* their projectile and let the shared
      `do_missile_anim` at the end of `do_combat_cast` (:1412) fly the lot —
      35 steps for a volley, 60 for a single shot. Five arms (Spark/Ice Bolt,
      Wound/Wrack, Flame, Kill, and the summons' sparkle) fire theirs on the
      spot instead, which is why their flight happens *before* their damage.
      Fireball and Firestorm have their `do_missile_anim` commented out in the
      C++ and ride the shared volley; that's kept.
    - The whole single-target family shares one `add_missile` after its switch,
      driven by `store_m_type` — which **defaults to 2** (the flame bolt), so a
      spell whose arm never sets it still throws one. Ported as
      `SINGLE_TARGET_MISSILE` / `SINGLE_TARGET_SOUND`, with the arms that set
      -1 (Scry, Mindduel, and a Turn Undead or Ravage Spirit aimed at the wrong
      race) drawing nothing.
    - *Gotcha*: `add_missile` **drops a second missile aimed at a square that
      already has one**, so a spell that hits the same square twice only draws
      one projectile. The queue holds thirty.
    - The x/y adjustment on that call (`14 * (w - 1)`, `18 * (h - 1)`) centres
      the sprite on a big creature rather than on its top-left square.
  - `verify-screen.mjs` gained a step that arms Flame in a fight, checks the
    border scroll moves the centre, casts at a monster three squares away and
    asserts both that a type-2 projectile is on screen and that the monster
    lost health.

- **Sounds on the timeline, and the sight rules combat actually uses
  (2026-07-27)**. Two more from play-testing.
  - **The hit was heard at launch.** The boom *sprite* was already correct — it
    takes `animAt()`, which is past the missile the caller just booked — but the
    sound went straight out. Sound scheduling now lives in **one** place: the
    sink `main.ts` installs holds each sound until `animAt()`. The game logic
    goes on raising sounds exactly where the C++ does, and the host decides when
    they are heard. Since `animAt()` is the wall clock whenever nothing is
    animating, nothing outside combat changes.
    - This also fixes the ordering *between* effect sounds: the web thrown by a
      monster now makes its throw noise, then the flight, then each PC's
      "caught in a web" — because those are raised after `run_a_missile` and so
      book a later slot.
    - *Gotcha kept*: `do_missile_anim` plays its sound **before** the per-missile
      setup discards anything (boe.newgraph.cpp:429), so a missile that draws
      nothing — a negative pic, or one travelling zero distance — still makes
      its noise. A test pins this.
  - **`party_can_see` was one branch where the C++ has three.** This port had a
    single "on screen, lit, explored, unobstructed" test drawn from the party's
    square. The real function (boe.locutils.cpp:519) differs in ways that are
    very visible now the view can scroll:
    - **In town the on-screen test is waived once `center != party.town_loc`** —
      scrolling away from the party is itself permission to see further.
    - **In combat there is no on-screen test at all**, and the line is drawn
      from *each PC in turn*, returning which one can see it. A scout standing
      forward reveals ground for the whole party.
    - The explored check this port had added is not in the C++ at all. It was
      redundant while the view was pinned to the party (anything within 4 with
      light and line of sight is already explored) and wrong the moment it
      wasn't. Gone.
    - `combat_pt_in_light` (:486) landed with it — the combat twin of
      `pt_in_light`, measuring the light radius from each PC rather than from
      the party, and always true in an outdoor arena.
  - **The draw gate has a separate combat branch** (boe.graphics.cpp:939) that
    this port had collapsed into the town one. It bypasses the explored map
    entirely when `which_combat_type == 0`, when the monsters are moving, or
    when **`overall_mode != MODE_COMBAT` — that is, while you are aiming**. So
    scrolling with the pointing arrows during targeting shows you what the
    party can actually see instead of a wall of black. That was the "I should
    be able to see much further" report, and it was this.
  - *Verified, not changed*: line of sight itself is correct. `can_see` has no
    range limit at all — probing from the start town gives an obscurity of 0 and
    `canSeeLight` of 0 out to fourteen squares along a clear line — and
    `updateExplored`'s ±4 window is verbatim from boe.locutils.cpp:250. What
    limits reach is the 9x9 view, the spell's own `range`, and the fog.
  - `verify-screen.mjs` now scrolls four squares while aiming and asserts more
    squares are visible than the explored map alone would allow. Note the test
    is *not* "all 81 draw": squares genuinely behind a wall stay dark, which is
    the point of the line-of-sight test.

- **`boom_anim_active`: why the explosion beat the projectile (2026-07-27)**.
  Reported from play-testing, and the root cause turned out to be a piece of
  the C++'s drawing architecture this port had never had.
  - **What was wrong.** Only the arms that call `do_missile_anim` *inside*
    themselves (Flame, Spark, Wound, Kill, the summons) had the right order,
    because they book the missile's slot before doing their damage. Everything
    on the **shared volley** — Fireball, Firestorm, Icy Rain, Divine Thud, the
    arrow spells — and the **whole single-target family** damages first and
    queues its missile afterwards, so the boom took `animAt()` before the
    missile had booked anything and appeared at cast time. Measured: with
    Fireball the explosion was on screen 27ms in, with the missile still flying.
  - **How the C++ avoids it.** `start_missile_anim` sets `boom_anim_active`
    (boe.newgraph.cpp:258). While it's set, **`boom_space` draws nothing**
    (boe.graphics.cpp:1506) and `damage_monst`/`damage_pc` take a completely
    different path: they add to the victim's `marked_damage`, queue an
    `add_explosion`, and **return early without applying damage or printing
    anything** (boe.specials.cpp:1503, boe.party.cpp:2634). Then
    `do_missile_anim` flies the missiles, `do_explosion_anim` plays the
    collected explosions, and `handle_marked_damage` applies the damage for
    real. Three phases, and the port only had one.
  - **What landed**: the drawing half. `booms.ts` gains `startBoomAnim` /
    `runBoomAnim` and the queue, with `add_explosion`'s dedupe (one explosion
    per square, keeping the larger number, thirty max). `doCombatCast` opens the
    volley, and closes it in a `finally` — a handler that throws must not leave
    the queue open, or every later boom in the session is swallowed.
  - **The damage half landed too.** `damage_monst` and `damage_pc` now take the
    C++'s marked branch while a volley is open: clamp to zero, add to the
    victim's `marked_damage`, queue the explosion, and **return without
    applying damage or printing anything**. `handleMarkedDamage`
    (boe.combat.cpp:1445) applies the totals once the volley closes, passing
    `DamageType.MARKED` so the second pass skips the reductions already taken
    (easy mode, toughness, luck) and doesn't boom again. Those `MARKED` guards
    were already in this port's damage functions, waiting for a caller.
  - Transcript lines ride the timeline as sounds and sprites do
    (`Universe.transcriptAt` + `visibleTranscript`, stamped by a
    `transcriptClock` the host sets to `animAt`). Between that and the marked
    damage, **"Guard takes 4" now appears with the explosion**, not with the
    cast.
  - *Remaining artifact, and it is subtle*: the marked damage is applied when
    `doCombatCast` returns, which is immediately — the C++ gets there ~200ms
    later only because `do_missile_anim` and `do_explosion_anim` block. So a
    monster killed by a fireball vanishes from the terrain as the missile
    launches. Deferring that would mean deferring `killMonst` and everything
    downstream of it, which is a change to how the whole port runs rather than
    to how it draws.
  - `verify-screen.mjs` casts Fireball and asserts every boom starts at or after
    the missile's launch plus its flight time, **and** that no transcript line
    has appeared yet at that moment.
  - Only `doCombatCast` opens a volley so far. `combat_run_monst` has its own
    `handle_marked_damage` call for the volleys a *monster* fires; wiring
    `monst_fire_missile` the same way is a TODO(M6).

## Milestones (Part 1: BoE player)

- [x] **M0 — Skeleton**: Vite+TS(strict)+Vitest scaffold; `core/` (mt19937 rng, location) with tests; assets copied to `public/data`; tile-grid demo page
- [x] **M1 — Scenario loads, outdoor walkabout**: XML/.map/.spec parsers, terrain view, outdoor movement (gzip+tar for packed .boes deferred to file-upload work; items/monsters XML land with M2)
- [ ] **M2 — Towns + full 605×430 shell**: town enter/exit ✅, UI chrome ✅, pregen party ✅, GameSession/Universe ✅, sound ✅, line-of-sight fog + lighting ✅, terrain trim + roads ✅, floor items ✅, inventory panel ✅, fields overlay ✅; replay driver still open
- [ ] **M3 — Dialog toolkit + talk + shops**: talking ✅, minimal async modal dialog ✅, doors + look + signs ✅, item/equip model + inventory panel ✅, shops ✅, sell/identify/recharge ✅, training ✅, inns ✅, **item Use ✅ (2026-07-27)**; enchanting and full dialogxml still open
- [x] **M4 — Specials interpreter (breadth-first)**: VM core (pointers, queueing, messages) + all seven opcode groups; triggers wired for movement, look, town entry/exit, use-space, call-special terrain and the two talk nodes. Opcodes needing combat/fields/timers/quests report themselves and wait for M5/M6.
- [x] **M5 — Combat**: M5a ✅ (the iLiving seam, damage/status, combat mode, melee); M5b ✅ (monster turns, melee AI, town *and outdoor* encounters, the `uAbility` port, missiles on both sides, breath, summons, touch abilities, on-hit weapon abilities, **monster spellcasting**); M5c ✅ (spell patterns, `process_fields`, the 147-spell table, `pc_can_cast_spell`, town/combat/targeted/multi-target casting, and the real casting dialog). Remaining odds and ends: `record_monst` (Capture Soul/Simulacrum), `do_mindduel`, and the SPECIAL monster ability.
- [ ] **M6 — Specials depth + party ops** (valleydy completable): quests,
      job banks, special items, the three timer kinds, **item Use** ✅
      (2026-07-27) and **boats/horses** ✅ (2026-07-27); alchemy, traps,
      job-bank dialog and end-scenario open
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
- (2026-07-26) **A town's wandering monsters persist across re-entry**, because
  `end_town_mode` saves the whole population into a save slot. Fort Talrus
  therefore fills up over a long session — which broke `verify-screen.mjs`'s
  town-exit walk, since its greedy "head south" walker got wedged against the
  new arrivals. The walker now aims at the boundary square and rotates through
  every direction when blocked. The spawn rate itself is the C++'s
  (`get_ran(1,1,160 - difficulty) == 2`, every town turn) and is not the bug.
- (2026-07-26) **An outdoor fight happens in a throwaway 48×48 town**, but the
  party's `townNum` stays 200 the whole time — it is not *in* a town. So
  `worldIsTown` is false (outdoor sight and lighting rules) while `univ.town`
  is set (the arena's terrain, blocking and explored map). Everything that
  reads `univ.town` works unchanged; everything that reads `worldIsTown` gets
  the outdoor answer, which is what the C++ does.
- (2026-07-26) **A poisoned blade ticks down twice per swing.**
  `pc_attack_weapon` decrements POISONED_WEAPON when the poison lands, and
  `pc_attack` decrements it again on the way out. That's the C++, and a test
  pins it. What is *not* right — and was a slip in this port — is decrementing
  the POISON_AUGMENT-boosted `amount` instead of the status itself, which made
  a poisoned weapon get *stronger* every time it was used.
- (2026-07-26) `calc_spec_dam` hands back a damage type as well as an amount,
  and its caller **swaps** the amount into a second variable when the type came
  back set: a slayer bonus is SPECIAL damage (boom sound 5), a DAMAGING_WEAPON
  bonus is damage of its own named type (boom sound 0). Two variables, one
  value, and only the swap tells them apart.
- (2026-07-26) **`fire_missile`'s range check is not the range the targeting
  cursor was given.** `load_missile` computes `current_spell_range` including
  the ammunition's DISTANCE_MISSILE bonus, but `fire_missile` then recomputes a
  hard `range = (mode == FIRING) ? 12 : 8` and refuses anything past it. A
  distance-extended shot can therefore be aimed further than it can be fired.
  Kept as-is.
- (2026-07-26) **`isCombat`, not `mode == COMBAT`.** FIRING and THROWING are
  combat modes that sit *after* COMBAT in the enum, so the toolbar swap, the
  party-symbol drawing, `is_blocked`'s combat clause and the text bar all had
  to ask `isCombat(mode)`; a `=== GameMode.COMBAT` test makes the screen
  revert to town rendering the moment the player takes aim. Same shape as the
  `inTown`-is-false-in-combat bug above.
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
- (2026-07-27) The **monsters' turn is async too**, and for the same reason: `do_monster_turn` blocks, so this port `await`s (`animSettle`) wherever the C++ calls `pause()`. Without it the model reached its final values before the first booked frame drew, and the animation constants paced nothing. `afterCombatAction` stays synchronous and *queues* the round (`GameSession.queueTurn`); `session.busy` gates input, `session.settled()` waits. Anything driving the game from a script has to await it — see the `verify-screen.mjs` note in the log entry.
- (2026-07-27) `combat_next_step` is a **loop** — `while(pick_next_pc()) { combat_run_monst(); set_pc_moves(); ... }`. Running the monsters once is a deadlock waiting to happen: a round can legitimately hand out zero AP to everyone (`set_pc_moves` gives a slowed PC nothing on odd `party.age`), and with no moves there is no input either.
- (2026-07-27) `do_monster_turn` reads `num_monst` **before** its loop, so a monster summoned during the turn doesn't act until the next one. Iterating the live array instead is a divergence you can't see until the turn is paced.
- (2026-07-27) `monsters_going` is a **drawing** flag (`GameSession.monstersGoing`), not the same thing as `busy`: it is true for exactly the span of `do_monster_turn`. Four bits of drawing read it, the load-bearing one being `can_draw`'s explored-map bypass — without it a monster acting on unexplored ground is a sprite moving over pure black.
- (2026-07-27) **The damage functions are `async`** (`damagePc`, `damageMonst`, and everything that calls them). The awaits are where the C++ blocks — `boom_space` sleeps for the blast, and `damage_pc` only takes the health off afterwards. A new call site that forgets to `await` will not fail to compile; it will apply its damage in the wrong order. `grep -n "damagePc(\|damageMonst("` and check every hit has an `await` in front of it.
- (2026-07-27) **Adding an `await` on the monster-turn path changes the RNG stream.** One extra microtask per turn was enough to make `verify-screen` diverge from the first swing on. Its logged outputs are a fingerprint of the whole run: if they move, something in the ordering moved.

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
3. ~~**Missiles**~~ — **done** on both sides (2026-07-26):
   `game/monsterAbilities.ts` for the monsters, `game/missiles.ts` for the
   party, and `calc_spec_dam` with them. `run_a_missile`, the projectile
   animation both halves use, landed 2026-07-26 in `game/missileAnim.ts`.
4. ~~**On-hit item abilities**~~ — **done** (2026-07-26), in
   `game/weaponAbilities.ts`, along with `calc_spec_dam` in melee. Still open:
   exploding weapons, which need M5c's spell patterns.
5. ~~**Random encounters outdoors**~~ — **done** (2026-07-26), in
   `game/wandering.ts` and `game/outCombat.ts`. Not ported with it: the arena's
   `spec_on_flee` path (there's no fleeing from a fight yet) and
   `notify_out_combat_began`'s roll-call of what you're facing.
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

### Reported by the user and fixed (fourth play-test, 2026-07-26)

- **"Swamps report poisoning and make the sound, but the effect never lands."**
  It landed — `status[POISON]` was set correctly — but **nothing ever spent
  it**. `increase_age`'s upkeep had never been ported, so no status effect did
  anything over time: poison never bit, disease never rolled, acid never
  burned, wounds never closed on the road and blessings never wore off. Now in
  `game/increaseAge.ts` (`do_poison`, `handle_disease`, `handle_acid`, plus the
  healing/SP/regeneration block), called from `afterPartyTurn` and again from
  `combat_run_monst`. **The tick rates are the design**: outdoors poison bites
  every 50 turns and you heal every 100; in town it's 20 and 50; in combat it's
  every *other round*. They're `age % n === 0`, so the phase matters as much as
  the rate — don't turn them into countdowns.
- **"Spear throwing happens really fast and I only see the final effect."**
  Right diagnosis, and the cause was worse than it looked: `do_monster_turn`
  ran the entire monsters' turn in one synchronous burst with **no camera move
  and no pacing**, then drew once. The C++ centres the view on each monster
  about to act (`center = cur_monst->cur_loc; draw_terrain(0)`) and blocks
  through `run_a_missile`, so you watch one thing at a time.
  `game/anim.ts` is the non-blocking equivalent: a **shared timeline** that
  animations book slots on instead of all starting "now". A missile books its
  flight, so the next missile — and the hit's own explosion — start after it
  lands; a camera move books a frame. `main.ts` plays the queue back in one rAF
  loop and hands the view back to the party when it drains. Measured after the
  fix: three spear-throwers launch 216ms apart, each hit shows after its own
  spear arrives, and the camera visits all three.
  Two things to know: `MONSTER_PAUSE_MS` is one frame because the original's
  GameSpeed default is **0** — the dwell is the redraw, not an added pause, and
  the Preferences dialog is what raises it. And `MAX_QUEUE_MS` caps the backlog
  at 1.5s, which the C++ has no equivalent for; a crowded fight would otherwise
  queue animations long after the turn resolved.

### Reported by the user and still open (2026-07-25)

Both of the two issues left open from the first real play-test are now fixed:

- ~~**The MAP button does nothing.**~~ **Fixed 2026-07-26** — see the automap
  entry above. Still missing from it: DETECT_LIFE's green monster dots (the
  party status effect doesn't exist yet) and custom scenario graphics sheets.
- ~~**No random encounters outdoors.**~~ **Fixed 2026-07-26** — see the
  entry above. Both of the first play-test's open complaints are now closed.

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

- **The real spell-casting dialog (M3/M5c, 2026-07-26)**: `dialogs/castDialog.ts`
  ports `cast-spell.xml` and the `pick_spell` machinery around it
  (boe.party.cpp:2133, :1905). It is **one** dialog, as the original is: the six
  PCs down the left with a caster button, a target button, health, spell points
  and their status icons, and below them the spell grid — four columns of one
  level each, flipped between levels 1-4 and 5-7 by "Other Spells".
  `DialogHost` grew a `ModalScreen` interface for hand-laid-out modals like
  this one, alongside the generic auto-laid-out `Dialog`.
  - **This closes the `store_spell_target` divergence.** `GameSession.spellTarget`
    is the C++ global, set from the dialog's target buttons, and the
    single-target arms in `spellTown.ts` and `spellCombat.ts` read it instead of
    falling back to the caster. With nobody chosen it stays 6 and those arms do
    nothing at all — including not charging — exactly as `if(target < 6)` does.
  - *Gotcha*: `eLedState` is `{led_green = 0, led_red, led_off}`, and led.hpp:18
    says what they mean **in this dialog specifically**: red is "castable",
    green is "the one you picked", off is "can't cast". Not the obvious reading.
  - *Gotcha*: Simulacrum's cost is -1 because it depends on the captured
    creature; `put_spell_list` prints `?` rather than the number.
  - *Divergence, small and deliberate*: the original's dialog window is 612px
    wide — wider than this port's 605px canvas, because the C++ opens it as its
    own OS window. The four spell columns and the three buttons are pulled left
    (146px column pitch instead of ~155) so they fit. Every other coordinate is
    the original's.
  - Changing caster re-filters the grid and drops a pick the new caster can't
    cast, as `pick_spell_caster` does.

- **The real pick-up-items dialog (M3, 2026-07-26)**: `dialogs/getItemsDialog.ts`
  ports `get-items.xml` and `show_get_items` (boe.items.cpp:559). Unlike a plain
  pick-list it **stays open**: the six PC buttons (each beside that PC's
  portrait) choose who is carrying, every item click hands it over and drops it
  out of the list, `a`-`h` take the eight visible rows, the arrows scroll, and
  Done closes. Rows carry the item's graphic, its name, its weight, and
  "(not yours)" on anything the party would be stealing.
  - *Gotcha*: `cButton::btnRects` writes its frames as BoE rectangles, which are
    **`{top, left, bottom, right}`** — so BTN_UP `{69,0,92,63}` is a 63x23 frame
    at *y* 69, not x 69. Read the other way the arrows come out blank.
  - `GameSession.takeItem` returns a message on success *and* on refusal, so
    this judges success by whether the item actually left `town.items`.

- **Targeted spells in combat — `do_combat_cast` (M5c, 2026-07-26)**:
  `game/spellCombatTarget.ts` ports `start_spell_targeting` (boe.combat.cpp:4910)
  and `do_combat_cast` (:839). `combat_cast_*_spell` hands off here for anything
  with `REFER_TARGET`: the game drops into `MODE_SPELL_TARGET` and the next
  click is where the spell lands. **The offensive spell list works now** —
  Spark, Flame, Fireball, Firestorm, Ice Bolt, Icy Rain, Kill, Wound, Wrack,
  Divine Thud, Flamestrike, the field spells (web, goo, flame cloud, stink,
  sleep, ice, force, blades, antimagic, quickfire, spray fields), the barriers,
  the dispels, the summons, Flash Step, and everything that lands on a victim
  (scare, fear, slow, poison, curse, charm, dumbfound, paralyse, acid, disease,
  turn undead, ravage spirit, unholy ravaging, scry).
  - *Gotcha*: a **targeted** spell costs **5** AP, where a REFER_YES or
    REFER_IMMED one pays 6 through `combat_cast_*_spell`.
  - *Gotcha*: `level` inside `do_combat_cast` is **not** the caster's level —
    it's `1 + level/2`, a spell-power figure every damage roll leans on.
  - *Gotcha*: the spell **cost is taken before the visibility check**, so a shot
    into the dark still costs the points. The *action points* are only taken on
    a target that resolves. Both faithful.
  - *Gotcha*: both barriers scorch their square as they go up, and both do it
    with **fire** damage — the force barrier included, which reads like a slip
    and is kept.
  - *Bug found and fixed in the click wiring*: the terrain-click handler chose
    its origin with `mode === COMBAT`, but `SPELL_TARGET` and `FIRING` are
    combat modes too, so a targeting click was measured from the party's stale
    *town* square and landed somewhere else entirely. Now `isCombat(mode)`.
  - Still open: `start_fancy_spell_targeting` (:4961) — the multi-target spells
    (Smite, Sticks to Snakes, Summon Host) that collect up to eight squares
    before resolving; `record_monst` for Capture Soul/Simulacrum; and
    `do_mindduel`.

- **Multi-target spells (M5c, 2026-07-27)**: `start_fancy_spell_targeting`
  (boe.combat.cpp:4961) and `place_target` (:784) join
  `game/spellCombatTarget.ts`, and `do_combat_cast` now loops over every square
  collected rather than resolving one. `REFER_FANCY` spells — Smite, Sticks to
  Snakes, Summon Host, the three enchanted-arrow volleys, Paralyze, Spray
  Fields and the tiered summons — pick up to eight squares, clicking a chosen
  one takes it back off, and the spell fires when the last slot fills or on
  space.
  - *Gotcha*: the cost and the action points are each taken **once**, on the
    first square that gets as far as resolving — not per target, and not up
    front.
  - *Gotcha*: Arrows of Fire, Smite and Arrows of Death **hold their damage
    back** to the end of the loop (`boom_dam`), so a volley lands together
    rather than one arrow at a time. Ported as a deferred list.
  - *Gotcha*: Summon Host puts the host itself on the **first** square and
    spirits on the rest — the arm reads `(i == 0) ? 126 : 125`.
  - *Gotcha*: fancy targeting can't rotate a wall, so Spray Fields uses a plus
    and everything else a single square, whatever the spell would otherwise get.
  - This closes the spell system: every `refer` now has a route.

- **Monster spellcasting (M5b, 2026-07-27)**: `game/monsterSpells.ts` ports
  `monst_cast_mage` (boe.combat.cpp:3207) and `monst_cast_priest` (:3550) with
  their level tables (7x18 mage, 7x10 priest) and emergency columns, plus the
  four AI helpers underneath — `find_fireball_loc`, `count_levels`, `pc_near`
  and `monst_near` (:3875-3945). Wired into `doMonsterTurn` where the C++ has
  it, ahead of the missile abilities. **This closes M5b.**
  - A monster doesn't choose from the spell list: it rolls on a table indexed
    by its magic level, after four emergency checks — slowed, outnumbered,
    enemy bunched up, badly hurt. The *last* of those is tested **first**, so a
    hurt caster heals or lashes out before anything else.
  - *Gotcha*: `find_fireball_loc` has a deliberate coin-flip tie-break, which
    moves the RNG on every candidate square that ties. Kept.
  - *Gotcha*: `count_levels` scores party-*friendly* monsters positively, so in
    a town full of guards a hostile caster finds a worthwhile target even with
    the party nowhere near. This surprised a test before it surprised anyone
    else.
  - *Gotcha*: the C++ discards the return of both cast functions and counts the
    turn as spent regardless, so a monster that couldn't afford its spell still
    loses its action points (and gains 1 mp). Its own TODO asks whether that's
    right; kept.
  - *Gotcha*: Fireball and the two cheap summons are priced at a flat 4 rather
    than by spell level; the priest side prices Summon Spirit, Pestilence and
    anything level 7 at 8, and the two big summons at 10.
  - *Gotcha*: Holy Scourge hits a PC far harder than another monster (the C++
    has a TODO asking why), and a healthy caster swaps its big heals for Bless
    Party / Summon Host rather than waste them.
  - *Divergence*: the C++ tries **breath** before spells; this port folds breath
    into `pickMonsterAbility`, which runs after, so a monster that both breathes
    and casts reaches for a spell first. Noted at the call site.

## Dialog fidelity: the two screens that don't look like the original

Reported from play-testing 2026-07-26. Both are real divergences, and both are
blocked on the same thing — the dialog toolkit only does picture + text +
keyed rows + buttons, and these two screens need more than that.

**Spell casting — done 2026-07-26**, see `dialogs/castDialog.ts` above. The
original is **one** dialog (`rsrc/dialogs/cast-spell.xml`, 238 lines):

- caster buttons `1`-`6` down the left, beside each PC's name, greyed out
  where `pc_can_cast_spell(pc, type) != CAST_OK`;
- **target** buttons `shift+1`-`shift+6` to their right, with a green `->`
  marking the current pick — this is `store_spell_target`;
- each PC's HP, SP and their status icons across the row (the same
  `staticons.png` strip `draw_pc_effects` uses, already ported);
- the spell grid itself, with the level-1..7 spells laid out in columns, and a
  Cast / Cancel pair.

Doing this properly also **closes the `store_spell_target` divergence**: the
town and combat single-target arms (the heals, the protections, Bless, Envenom,
Augmentation, Nirvana) currently fall back to the caster because there is no
way to name a target. The target buttons are that way.

Note the caster column is only interactive out of combat: in combat
`can_choose_caster` is false and the active PC casts (already correct here).

**Picking up items — done 2026-07-26**, see `dialogs/getItemsDialog.ts` above.
The original is `rsrc/dialogs/get-items.xml` (70 lines):
a framed, scrolling list of what's on the ground — each row an *item graphic*
plus a name and a detail line — with PC buttons `1`-`6` along the bottom, each
next to that PC's *portrait*, to say who takes it. Up/down arrows scroll; Done
closes. The port currently uses a plain keyed-row list with no graphics and no
scrolling.

Both are now done, as hand-laid-out `ModalScreen`s rather than by building a
general dialogxml engine — the same approach the port already takes for the
talk, shop and map screens. A general engine for the remaining ~210 dialog
definitions is still the long-term M3 item.

- **Six things from the fifth play-test (2026-07-27)**, all real defects and
  all now closed:
  - **PCs placed on the far side of a wall when a fight started.** `place_party`
    was missing its third test: the C++ requires
    `can_see_light(town_loc, spot, combat_obscurity) < 1`, i.e. an
    *unobstructed straight line* from where the party stands. Only `is_blocked`
    and `sight_obscurity` were ported, and neither stops the placement table
    reaching around a corner into the next room. Measured over every open
    square of Fort Talrus: **4341 of 21575 placements crossed an obstruction
    before the fix, 0 after.**
    - `combat_obscurity` (boe.locutils.cpp:204) is new here: it is
      `sight_obscurity` plus "anything that blocks movement is opaque" plus
      lava. `find_clear_spot` passes it too, and did not before, so summoned
      creatures could land through walls as well.
    - `canSeeLight` now takes the obscurity function as an argument, as the C++
      does, and picks `combat_pt_in_light` in combat rather than `pt_in_light`
      — the C++ branches on the mode and this port only had the town half.
  - **No pointing arrows while looking around.** They were drawn (in
    `scrollableModes`), but Look was a `pending` flag rather than a mode, so
    LOOK_TOWN/LOOK_COMBAT were never entered and the arrows never showed. `L`
    now runs `handle_begin_look`: the mode switches, the arrows appear, the
    border scrolls the view, and looking (or `L`/Escape) runs `end_look`, which
    puts the camera back on the party.
    - While fixing it: the click-to-square maths measured from the party's
      square, but `handle_terrain_screen_actions` (boe.actions.cpp:301)
      measures from **`center`** in town and combat. They only differ once the
      view has been scrolled — which, before this, nothing outside targeting
      could do.
  - **No random encounters outdoors.** The machinery was all there; the
    *clock* was wrong. `increase_age` (boe.actions.cpp:3362) advances the
    outdoor clock by **ten** ticks per step (five mounted), after rounding down
    to a multiple of that — this port did `age++`. Everything outdoors is
    gated on `age % 10 == 0`: whether the wandering groups move, and whether
    the game rolls its 1-in-70 for a new group at all. So encounters were ten
    times rarer than they should be, and the whole outdoor clock (poison
    biting, wounds closing, quest deadlines, shop restocking) ran ten times
    slow. A test now walks the party until a group appears.
  - **Walking through webs didn't web anyone**, and **crates and barrels
    didn't move when pushed.** Both live in the middle of
    `check_special_terrain` (boe.specials.cpp:283-300), between the barrier
    tests and the terrain switch, and that stretch had never been ported.
    Now there, along with `push_thing`/`move_thing` (boe.town.cpp:1627, items
    inside a pushed container travel with it) and the **conveyor** refusal at
    the top of the same function. `check_fields` (:381) came with them — the
    walls of fire/force/ice/blades, quickfire, the two clouds and the fire
    barrier all announce themselves when you walk in, and damage on a combat
    move.
    - *Gotcha*: the web's race test reads the **current** PC even when the
      whole party is caught, so out of combat it is PC 1's race that decides
      whether anyone gets webbed. Kept.
    - *Gotcha*: a push against something solid returns the *pusher's* square
      from `push_loc`, so the crate swaps onto the party's square rather than
      refusing. Over water or a pit (terrain 90) it is destroyed outright,
      which `push_loc` signals by returning `x = 0`.
  - **`OUT_PLACE_ENCOUNTER` and `OUT_MAKE_WANDER` reported themselves instead
    of doing anything.** Both are one line each now that `wandering.ts` exists:
    MAKE_WANDER calls `create_wand_monst`, PLACE_ENCOUNTER drops
    `out->special_enc[ex1a]` on the party's own square with `forced`, so the
    encounter check meets it on the next turn. `ex1a` outside 0-3 prints the
    original's error and places nothing.

- **Nine things from a sixth play-test (2026-07-27)**, spanning outdoor
  specials/terrain, combat, and audio — all now closed:
  - **`AFFECT_STATUS` was a stub wearing a costume.** It nudged
    `status[which]` with a generic add-and-clamp instead of routing through
    each status's own `iLiving` method (`poison`/`disease`/`slow`/`curse`/
    `dumbfound`/`sleep`/`web`/`acid`), so a scripted "you feel ill" node
    changed the number but printed nothing, skipped the frailty/protection
    rolls, and used the wrong sign convention for several statuses. Rewritten
    as a real per-status switch mirroring `affect_spec` (boe.specials.cpp:2981).
  - **A ford across water didn't work.** `outdMoveParty` ran a destination
    square's special node and used its `blocked` return but silently dropped
    `forced` — so a `CANT_ENTER` node with `ex2a>0` (the same "walk through a
    wall" trick town scripting already used) could run and print its message,
    but the water still refused the step right after. `forced` now bypasses
    the blockage test outdoors too, the same as it always did in town.
  - **No fleeing an outdoor arena by reaching its edge.** Terrain 90 marks an
    arena's border wall, and stepping onto it during `whichCombatType===0`
    combat is a 30% roll to flee (`pc_combat_move`, boe.combat.cpp:247) —
    this port's `combatMove` had no handling for it at all.
  - **Spellcasters had infinite AP.** `combatCastSpell` and `doCombatCast` are
    free functions, not `GameSession` methods, so — unlike `attackAt`/`parry`
    — neither called `afterCombatAction` after spending AP. The turn simply
    never advanced, and nothing else gated re-casting on `ap > 0`. Both now
    call it (`afterCombatAction` is public for exactly this reason), as does
    the `NO_ENCUMBERED` refusal in `main.ts` that also takes 6 AP.
  - **Clicking your own figure on the battlefield did nothing.**
    `handle_terrain_screen_actions`'s `offset.x==0 && offset.y==0` case
    (boe.actions.cpp:323) is Pause — `char_stand_ready` in combat — and this
    port's click dispatch had no equivalent, so a self-click just fell
    through to the ordinary move code. Added in `main.ts`, ahead of the
    move/combatMove dispatch, for all three plain modes (matching the C++,
    not just combat).
  - **Nothing happened when the whole party died.** `handle_party_death`
    (boe.actions.cpp:1431) had no port at all. `Party.isAlive()` plus a
    latched `GameSession.checkPartyDeath` (called from `afterPartyTurn` and
    `afterCombatAction`, mirroring `advance_time`'s own check) now fire
    `onPartyDeath` once; the host shows an unclosable "Your entire party has
    died." dialog and reloads on acknowledgement — there's no load/new-game
    flow to offer yet without M7's save system.
  - **A charmed monster never fought its former allies.** Two separate bugs
    stacked here. First, `Creature.sleep`'s CHARM branch (already correct)
    flips `attitude` to FRIENDLY rather than touching `status[CHARM]` — the
    C++ never reads that status either, by design. But `giveMonstersMoves`
    was missing two of `do_monster_turn`'s wake-up checks (boe.combat.cpp:
    2088, 2098): a hostile monster noticing a nearby friendly one, and a
    FRIENDLY creature noticing a nearby hostile one (which also forces
    `mobile = true`, so a stationary charmed shopkeeper can actually give
    chase). Second, and bigger: `doMonsterTurn`'s whole action loop
    (spells/ranged/melee) was unconditionally gated on `!isFriendly`, where
    the C++ only gates *attacking a PC* on that — attacking another
    *creature* only needs `attitude !== DOCILE`
    (boe.combat.cpp:2405-2420). Target selection was PC-only too (a
    `TODO(M5b)` the port's own authors had left in place). Added
    `pickTargetMonst`/the `100+i` monster-target encoding `monst_pick_target`
    uses, and fixed the melee/movement gates to match the C++'s per-target-type
    rule. Spells and ranged abilities still only fire at PC targets — a
    smaller, explicitly-noted remaining gap.
  - **Terrain looked foggier than the monsters standing on it while
    Looking.** The combat draw gate already bypassed the explored map while
    aiming (a earlier fix); the plain-town gate has the same fallback for
    `MODE_LOOK_TOWN` specifically (boe.graphics.cpp:945) and this port never
    had it, so scrolling with the pointing arrows during Look kept unexplored
    ground black even where `party_can_see` said otherwise — while NPCs
    (gated on `partyCanSeeMonst`, no `isExplored` check at all) drew fine.
    Pulled the whole gate out of `Screen` into an exported `canDrawTerrainSpot`
    so it's unit-testable without a canvas.
  - **Some sounds never played — audited, found real gap: item pickup.**
    `get_item` (boe.items.cpp:483-510) plays a sound on every successful
    pickup — gold, food, and everything else each their own, plus a
    too-heavy refusal — and this port's `takeItem` played none of them.
    Fixed; shops, item-shop services (identify/recharge/sell), doors, rest,
    training and status effects were all already wired correctly, so this
    looks like the one real gap rather than a systemic problem.
  - `test/vehicles.test.ts` was unaffected; new coverage landed in
    `test/specials.test.ts`, `test/session.test.ts`, `test/spellCombat.test.ts`,
    `test/wandering.test.ts`, `test/monsterTurn.test.ts`, the new
    `test/screen.test.ts`, and `test/inventory.test.ts`.

- **Two more from the same play-test (2026-07-27): parry's free swing, and
  combat's missing beat.**
  - **Parry didn't punish a monster for closing the distance.** The C++'s
    `char_parry`/`char_stand_ready` were both already right, but
    `do_monster_turn` has its own check right after `seek_party` moves a
    monster (boe.combat.cpp:2445/2456): any PC with `parry > 99` who now
    finds that monster adjacent spends the stand-ready on a free swing at it.
    This port had nothing on the monster-movement side reading `parry` at
    all. Added as `checkParryOpportunity` in `monsterTurn.ts`, called after
    both `seek_party` sites (seeking a PC, seeking another creature) the same
    way the C++ does, including the pacifist exemption.
  - **Combat read faster than the original at every speed setting.** Two
    separate causes, both timing:
    - `do_monster_turn` has *two* pauses, and this port only ever had one.
      `pause(get_int_pref("GameSpeed"))` before centering the camera on the
      acting monster was already ported faithfully as `MONSTER_PAUSE_MS`
      (16ms, matching GameSpeed's default of 0). But `print_buf(); pause(8);`
      right after a flee/spell/ranged/melee action lands
      (boe.combat.cpp:2428) is a **fixed 8 ticks (~133ms), not gated by
      GameSpeed at all** — every action gets this beat regardless of speed
      setting, and it simply didn't exist in the port. Added as
      `ACTION_PAUSE_MS`/`bookActionPause()` in `anim.ts`, booked on the same
      shared timeline `focusOn` and the missile animations already use.
    - `combat_move_monster` (boe.monster.cpp:721) plays a footstep
      (`move_sound`, the same the party's own steps use) when a monster's
      destination is on screen — the port's `combatMoveMonster` never called
      it, so monster movement in a fight was silent. Wired up with
      `session.moveSound` (now public) gated on `pointOnScreen`.
    - Both ride the existing timeline architecture (`animBook`/transcript
      lines stamped by `animAt()`), so nothing about *how* combat paces
      itself changed — only that two real sources of pacing that existed in
      the C++ now exist here too.
    - **Follow-up, same day: tried bumping `ACTION_PAUSE_MS` to 600ms to see
      if it read as slower. It didn't — not even a little.** Root cause,
      and it's a real one, not a tuning problem: **`doMonsterTurn` resolves
      every monster's move, attack and damage roll synchronously before any
      of this pacing is ever observed.** By the time the first booked pause
      or camera move actually plays back, HP bars, monster positions and
      combat outcomes are *already* at their final values — `redraw()` is
      called once, immediately, right after the whole turn finishes.
      **Fixed 2026-07-27 by making the monsters' turn `await` the timeline;
      see the entry below.**

- **Two more bugs found re-testing the same day's fixes (2026-07-27).**
  - **Fleeing an entire outdoor fight reported a party wipe.** `isAlive()` —
    on both `Player`/`cPlayer` and `Party`/`cParty` — is `main_status ===
    ALIVE`, which is also false for FLED, not just DEAD/DUST/STONE. The
    C++'s `handle_party_death` (boe.actions.cpp:1431) accounts for this: it
    resets every FLED PC back to ALIVE *first*, then rechecks — if that
    brings the party back, it's a rout, not a death, and combat ends instead
    (`end_town_mode`); only if nobody comes back this way does it fall
    through to the actual game-over dialog. `checkPartyDeath` (from the
    entry above) skipped this reset-and-recheck step entirely, so a party
    that ran from an arena fight — everyone FLED, nobody DEAD — got the
    "Your entire party has died" dialog instead of just... having fled.
    Fixed by porting the same two-step check, and factoring `endOutdoorCombat`'s
    body into a shared `exitArenaCombat` so the automatic exit-on-flee path
    can use it without also inheriting the "Enemies are still alive!"
    refusal that only makes sense for a *voluntary* End Combat click.
  - **The outdoor "you feel ill" special (same one from the entry above)
    still did nothing after the AFFECT_STATUS fix.** The fix itself routed
    each status through the right `iLiving` method, but read the status type
    from the wrong field: `spec.ex2a` instead of `spec.ex1c`
    (boe.specials.cpp:2982 is `switch(eStatus(spec.ex1c))`, not `ex2a`). On
    a real node `ex2a` is always -1 (unused), so the range guard caught it
    and bailed before the switch ever ran — silent no-op, same symptom as
    the original bug, different cause. Found by reproducing the exact
    scenario node (valleydy `out2~0.spec` node 2, reached from node 1's
    "Do you drink some?" prompt) directly in a test rather than guessing
    further from the source alone; `test/specials.test.ts` now pins that
    exact node's data so this can't silently flip back.

- **Combat pacing: the monsters' turn now `await`s the timeline
  (2026-07-27).** This closes the handoff note above — the one that said
  raising `ACTION_PAUSE_MS` changed nothing because `doMonsterTurn` resolved
  the whole turn before any pacing was observed.
  - That note proposed deferring the *state changes* onto the timeline,
    marked-damage style. **The approach taken instead is the other one: make
    the turn block.** The C++ doesn't defer anything — `do_monster_turn`
    sleeps, and display and model advance in lockstep because nothing else
    can run in between. Deferring would have meant a second source of truth
    for HP and positions, and state landing *after* the player had control
    back. Awaiting is the faithful shape and keeps one source of truth.
  - **`animSettle()`/`setAnimWaiter()` (`anim.ts`)** is the blocking `pause()`:
    it waits for the booked queue to drain. With no waiter installed it
    returns at once, so tests, headless runs and `verify-screen` pay nothing
    — the same default-to-instant trick `Universe.transcriptClock` uses.
    `animClear()` releases anyone parked in it, or a cleared queue would
    strand the turn forever.
  - **Where the awaits go** is decided by where the C++ pauses, not by feel:
    after `focusOn` (the camera dwell, which is also what paces a monster's
    *movement* — it comes back round the loop once per square), after
    `bookActionPause` (`print_buf(); pause(8)`, boe.combat.cpp:2428), and
    inside `monstFireMissile` between `runAMissile` and the damage, which is
    `do_missile_anim` blocking. That last one also retires the monster-side
    boom-volley TODO: with a real wait there is nothing to defer.
  - **`GameSession.queueTurn`/`busy`/`settled()`** keeps the ripple contained.
    `afterCombatAction` has ~12 call sites, several of them free functions
    (`combatCastSpell`, `doCombatCast`) whose own callers would have gone
    async too. Instead it stays synchronous and *chains* the monster round;
    `busy` is what the input layer gates on and `settled()` is how a test or
    a driver waits. Checked that no caller does anything but return or
    repaint after it.
  - **Input is gated while the monsters go** (`midAction()` in `main.ts`,
    now also covering the whole key handler, which had no gate at all). The
    C++ gets this free by blocking and goes further — `flushingInput = true`
    *discards* what was typed rather than buffering it, which is what this
    matches. A round takes real time now, so this stopped being theoretical.
  - *Measured, not eyeballed*: a four-monster round takes 1264ms at
    `ACTION_PAUSE_MS = 133` and 2593ms at 400, and the party's HP steps down
    in four visible stages during it (236ms/436ms/585ms) instead of dropping
    in one lump. Before this, the constant moved nothing. Left at the
    faithful 133; it is a working knob again.
  - *Gotcha for anyone driving the game from a script*: `verify-screen.mjs`
    needed three fixes that are all the same fix — wait for the game to be
    idle. Its keypresses go through a `press()` helper that awaits
    `settled()` first (otherwise the key is dropped, correctly), the town
    encounter waits for the monsters' reply before reading damage, and the
    missile test re-pins `curPc` before firing because a round ending hands
    the turn to whoever is up next.

- **`combat_next_step`'s round loop, found reading it against this port
  (2026-07-27).** `startCombatRound` ran the monsters **once** where the C++
  loops (`while(pick_next_pc()) { combat_run_monst(); set_pc_moves(); ... }`,
  boe.combat.cpp:1789). Three consequences, all now fixed in
  `afterCombatAction`:
  - **A freeze, and a reachable one.** If no PC has AP after the monsters
    go, nothing advances and no input is accepted (`combatMove` bails on
    `ap <= 0`). `setPcMoves` hands out **zero** AP to a slowed PC on every
    odd `party.age`, so a fully-slowed party simply stopped on odd rounds;
    an asleep or paralysed party does the same. The `while` loop is what
    runs the monsters again until somebody can act, with the C++'s
    `is_alive` safety valve inside it. `test/monsterTurn.test.ts` pins it —
    and the test was checked against the old code, where it fails.
  - **A pinned PC who can't act** (X / `toggleActivePc`) burnt the whole
    party's moves every round, forever, with no way to notice or undo it.
    The C++ releases the pin itself and says so; neither half was ported.
  - **No `Active: <name> (#n, N ap.)` line**, which is the only thing that
    tells you the turn changed hands and what the new PC can do with it.
    Printed only when the party isn't pinned and `cur_pc` actually moved.
    Worth knowing when reading tests: it lands *after* the acting PC's own
    message, so `transcript.at(-1)` is no longer the move's line.
  - Also moved `syncForceCages` to the top of `afterCombatAction` — the C++
    runs it on every step, not only when the round rolls over — and dropped
    the `ap > 0` early-out, which skipped `pick_next_pc`'s AP-burning.

- **(Found, not fixed) Party statuses never decay in combat.**
  `combat_run_monst` also does `move_to_zero` on `DETECT_LIFE`, `FIREWALK`,
  `STEALTH` and `hostiles_present`; this port decays none of them, and
  `hostilesPresent` isn't ported at all. Deliberately left alone: the gap
  isn't combat-specific — `increaseAge.ts` misses them too — so fixing only
  the combat half would be half a fix.

## Next steps

M5 is closed and the first slice of **M6** landed 2026-07-27 (quests, job
banks, special items, the three timer kinds and `special_increase_age` — see
the entry above). What M6 still owes, roughly in the order the valleydy
playthrough will hit it:

1. ~~**Party ops**: boats and horses~~ — **done** (2026-07-27), see the entry
   below. `force_town_enter` + `position_party` (a scripted teleport landing
   the party on a specific town square) are still open.
2. ~~**The job-bank board**~~ — **done** (2026-07-28), see the entry below.
   What's left of the quest UI is the quest pane of the item window.
3. ~~**Alchemy** (`A`)~~ — **done** (2026-07-28), see the entry below.
4. **`increase_age`'s remaining upkeep**: the autosave (needs M7's save
   system). ~~Hunger~~ landed 2026-07-28 — see the entry below.
5. **The dialogxml toolkit** — the parser, the widget renderer and the first
   converted call site (`pc-info.xml`) landed 2026-07-28; see the entry below.
   What's left is converting more call sites: `story_dialog`'s pagination,
   `display_monst`, `display_pc`'s spell lists, and the two dialogs the job
   board and alchemy are still approximating with lists.
6. ~~Odds and ends left over from M5~~ — **done** (2026-07-28), see the entry
   below. The one thing left in that area is `AFFECT_SOUL_CRYSTAL`, which needs
   the creature-context plumbing described there.
7. M2's last leftover is the replay driver.
8. Part 2 (Exile 3) hasn't started; E3-0 (format groundwork) can proceed in
   parallel at any time.

- **Boats and horses (M6, 2026-07-27)**: `data/vehicle.ts` ports `cVehicle`
  (`loc`/`sector`/`whichTown`/`exists`/`property`/`pic`/`name`) plus
  `resizeVehicles`, a faithful port of the `std::vector::resize` the loaders
  use — it **truncates** the list if the new size is smaller, matching
  `loadOutMapData`/`loadTownMapData`'s own footgun rather than "fixing" it
  into a resize-to-at-least. Boat/horse map features (already parsed by
  `mapParse.ts` but discarded since M1) now land in `Scenario.boats`/`horses`,
  keyed by vehicle number; `Universe`'s constructor copies the existing ones
  into `Party.boats`/`horses` (`enter_scenario`, universe.cpp:1396), and
  `startTownMode` restores any a town re-entry finds missing (`start_town_mode`'s
  "check horses"/"check boats" loop, boe.town.cpp:503).
  - **Movement**: `outdMoveParty` and `townMoveParty` both got the C++'s
    leave/board/bridge logic (boe.actions.cpp:4009/4159) — leaving a boat on
    dry land, refusing a diagonal boat move, boarding a boat or horse waiting
    on the destination square (refused with "Not your boat"/"Not your horses"
    if `property` is true, i.e. the scenario hasn't given it to the party
    yet), a horse refusing dangerous terrain or terrain flagged
    `blockHorse`, and the "sail under, or come ashore?" prompt at a bridge
    (`onConfirmBoatBridge`, the same host-callback shape as
    `onConfirmAttackFriendly`). `pause()` (Space/W outside combat) gained the
    dismount/re-board half of `handle_pause`: a horse always dismounts, a
    boat only onto passable ground, and pausing again re-boards a boat you're
    stranded on.
  - **Drawing**: `Screen.drawPartySymbol` swaps to `vehicle.png` while
    mounted — directional for a boat (N/S get their own frame, the rest split
    east/west), east/west-only for a horse — porting `draw_party_symbol`'s
    vehicle half (boe.graphutil.cpp:494).
  - **Specials**: `CHANGE_HORSE_OWNER`/`CHANGE_BOAT_OWNER` now flip a
    vehicle's `property` flag instead of reporting themselves; `IF_IN_BOAT`/
    `IF_ON_HORSE` had already landed with M4. Not ported: `run_waterfalls`
    (a boat riding a waterfall down) — noted as TODO(M6) at both move sites,
    since no bundled scenario's boat sits next to one yet.
  - *Gotcha*: a vehicle's own `loc`/`sector` fields go **stale while
    boarded** — they're only written at boarding time and (for a horse, every
    step; for a boat, only on dismount/pause). That's the C++'s own shape,
    not a bug: the vehicle *is* the party's position while ridden.
  - *Found by testing, not a play-test report*: the stealth scenario's town1
    horses are placed **unowned** (`H`, not `h`) — boarding one without a
    `CHANGE_HORSE_OWNER` special first correctly refuses with "Not your
    horses.", which is what caught a first draft of the test assuming they'd
    be free to ride.
  - `test/vehicles.test.ts` covers scenario parsing (stealth's town1/town9/
    town19/town20 place 5 horses and 9 boats total), the per-party copy,
    boarding/dismounting a horse, the ownership refusal, and
    `CHANGE_HORSE_OWNER`.

- **Combat you can watch: the pace knob, `monsters_going`, and the camera
  following a shot (2026-07-27, from the tenth play-test round).** The report
  was two things — combat runs too fast to see what the enemy is doing, and in
  a town fight NPCs move around over black, unrendered ground.
  - **The pace knob (`combatPace`, `anim.ts`).** Not in the original: every
    animation length is multiplied by it, so `1` is the faithful timing and
    the default of **3** is slow motion for play-testing. `paced()` is applied
    to the monster dwell, the post-action beat, a missile's flight, a boom's
    time on screen *and* `MAX_QUEUE_MS` — a cap that didn't scale would
    silently undo the slowdown exactly when the screen is busiest. Changed at
    runtime with `-` / `=` (above the mid-action gate, so a fight can be sped
    up while it runs) or `?pace=1` in the URL.
  - **The GameSpeed dwell was the wrong end of its own range.** The camera's
    rest on the acting monster is `pause(speed == 3 ? 9 : speed)`
    (boe.combat.cpp:2213) — the *preference*, 0/1/2/9 ticks, shipped at 0.
    This port had hard-coded the shipped 0 (one frame, ~16ms), which is the
    original's own answer to "combat is too fast" left turned all the way
    down. Now `MONSTER_DWELL_TICKS = 9`, the slowest of the four.
  - **A missile carries an extra slowdown of its own** (`MISSILE_EXTRA`,
    2.5x): a projectile crosses the whole view in one hop, so at the shared
    multiplier it still read as a flicker next to a paced turn.
  - **`monsters_going` was missing entirely, and that is the black-ground
    bug.** The C++ sets it for exactly the span of `do_monster_turn`
    (boe.combat.cpp:2065) and four bits of drawing read it. The one that
    matters: `can_draw` in a town fight is
    `(is_explored || which_combat_type == 0 || monsters_going || mode !=
    MODE_COMBAT) && party_can_see < 6` (boe.graphics.cpp:940). While the
    monsters go the camera is centred on whichever monster is acting — very
    often on ground the party has never walked — and `party_can_see_monst`
    never consulted the explored map, so the monster was drawn moving over
    pure black. With the flag, the ground under it draws. Also ported with it:
    the status bar naming the monster that is going (`text_bar_text`, and with
    it the PC's `name (ap: n)` line, which was missing too), the active-PC
    ring bailing out (`frame_active_pc`, boe.graphutil.cpp:264) and the
    pointing arrows (boe.graphics.cpp:1635).
  - **The camera holds still for the whole turn.** `recentreOnParty` in
    `main.ts` used to fire whenever the animation queue drained, which is
    *between* two monsters' actions — so the view flicked back to the party
    and away again all round. Only visible once the turn is slow enough to
    watch. It now defers to `monstersGoing`, and the C++'s "if in town, need
    to restore center" (boe.combat.cpp:2620) is ported at the end of
    `doMonsterTurn` so the town half has somewhere to put it back from.
  - **The missile camera is ported now** — `do_missile_anim`'s `camera_dest`
    and `recentered` branch, which the header of `missileAnim.ts` used to say
    was left out. The view opens on `between_anchor_points(origin, dest)`
    (a new faithful port in `core/location.ts`) and swings onto the target's
    frame at the flight's halfway mark; `focusAt` books *no* time for either,
    since the flight is already paying for them. Two knowing divergences: the
    C++'s second trigger ("the tracked missile left the terrain rect") isn't
    ported, because here every shot crosses in the same time and halfway is
    where it would fire anyway; and the C++ has to offset the sprite's path by
    the camera delta by hand, where ours is drawn from world coordinates
    against the current centre and simply keeps flying while the ground slides
    under it.
  - *Gotcha, and an expensive one*: **an extra `await` layer inside
    `doMonsterTurn` changes the RNG stream.** The first draft set the flag in
    a wrapper that awaited a `monsterTurnBody` helper; `verify-screen` then
    diverged from the first swing onward (a different damage roll, a different
    party position ten steps later) and failed. One extra microtask per turn
    is enough to change how the turn interleaves with whatever is driving the
    game. The flag is set with an **inline** `try`/`finally` for that reason —
    worth knowing before refactoring anything on this path, and worth
    remembering that `verify-screen`'s outputs are a reproducible fingerprint
    of the whole run, not just a pass/fail.
  - `verify-screen` now samples from *inside* the draw path while the monsters
    go (wrapping `Screen.draw`, since polling from the driver would add the
    very awaits described above): it checks that the turn draws frames at all,
    that the bar names the monster on them, and counts the unexplored squares
    the `monsters_going` gate lets through. Unit cover: `test/screen.test.ts`
    (the gate), `test/monsterTurn.test.ts` (the flag's lifetime, including the
    early return, and the bar's wording), `test/missileAnim.test.ts` (the pace
    scaling), `test/increaseAge.test.ts` (the camera following a shot without
    lengthening it) and `test/location.test.ts` (`between_anchor_points`).

- **The blast is part of the turn now: `boom_space` books its time, and the
  party-death announcement waits (2026-07-27).** Reported from play-testing:
  "some blasts/damages are happening after the effect (death of party for
  instance)". They were — the blast was drawn on a timeline nothing waited
  for, so a consequence could arrive before the animation that explained it.
  - `boom_space` **sleeps** for the whole blast (300ms in the WASM build,
    boe.graphics.cpp:1594) and only then does `damage_pc` subtract the health,
    decide the death and call `kill_pc` (boe.party.cpp:2660-2686). This port
    drew the boom at the front of the queue without booking anything, so
    nothing downstream waited for it. `boomSpace` now books `boomMs()` — two
    blows in one turn play one after the other, as they do in the original,
    instead of sharing a frame.
  - A **volley** still books one slot for everything it collected, matching
    `do_explosion_anim`: it draws every explosion in the same frames and
    sleeps once, which is why a fireball's hits land together.
  - **`onPartyDeath` waits for the queue** (`checkPartyDeath`). The latch is
    set when the damage resolves, but the announcement goes through
    `animSettle` — the C++ reaches `handle_party_death` from the main loop,
    long after the blocking blast has played, and telling the player they are
    dead over the top of an unfinished explosion is the wrong order.
  - **`animBook`'s depth cap is gone.** It let a booking past 1500ms of
    backlog start at once — a safety valve from when the game logic ran ahead
    of the display. Once a blast books time, that valve broke the one thing
    the timeline guarantees: `verify-screen` caught an explosion being handed
    the same start as the missile it belonged to. Nothing needs the valve now
    (see the next point), and the C++ has no equivalent.
  - **Player input waits on the animation queue** (`midAction` in main.ts,
    now `acting || session.busy || animPending() > 0`). This is what makes
    "wait for the blast, then carry on" true for the party's own blows as well
    as the monsters', and it is faithful: `flushingInput = true` is set in
    `damage_pc` immediately after `boom_space` returns. It is also what keeps
    the queue shallow without a cap — the model cannot outrun the screen if
    the player cannot act. `window.__animPending` is exposed for drivers, and
    `verify-screen`'s `idle()` waits on it as well as `settled()`.
  - **Still not faithful, and knowingly so**: a PC's health *number* drops
    when the blow resolves, where the C++ subtracts it after the blast. Doing
    that properly means `damagePc`/`damageMonst` becoming async — they have
    dozens of synchronous callers across specials, fields, items and spells —
    or deferring the state change, which is the second-source-of-truth
    approach rejected when the monsters' turn was paced. Everything *after*
    the blast (the death, the "is dead" line, the next monster's move, the
    party-death dialog, the player's next key) is correctly ordered; what
    still leads is that one number.

- **The damage pipeline is async: state lands after the blast, and the turn
  waits for the blow (2026-07-27).** The follow-up to the entry above, and the
  end of the "knowingly not faithful" note it left: a PC's health used to drop
  the instant a blow resolved, where the C++ takes it off only after
  `boom_space` has finished sleeping. Play-testing also caught the same shape
  one level up — **the active PC switched the moment you swung**, before the
  blast had played.
  - **`damagePc`/`damageMonst` are `async`.** They print the line, draw the
    blast, `await animSettle()` — this port's version of `boom_space`'s sleep —
    and only then subtract the health, decide the death and call
    `kill_pc`/`kill_monst`. That is `damage_pc`'s own order
    (boe.party.cpp:2660-2686); the port had all of it except the sleep.
  - **The cascade is wide and it is the point.** ~40 functions became async:
    `damageTarget`, `pcAttack`/`pcAttackWeapon`, `fireMissile`,
    `monsterAttack`, `monsterBasicAbil`, `monstCastMage`/`monstCastPriest`,
    `doShockwave`, the `combatImmed*` casts, `doCombatCast`/`resolveOne`/
    `placeTarget`/`castCollected`, `castTownSpell`, `placeSpellPattern`/
    `placeGrid`, `hitSpace`/`hitPcsInSpace`/`processFields`/
    `monstInflictFields`, `doPoison`/`handleAcid`/`increaseAgeEffects`,
    `handleMarkedDamage`, and on the session `attackAt`, `fireMissileAt`,
    `pause`, `checkFields`, `afterPartyTurn`. Each one is a place the C++
    blocks; the awaits are where its `pause()`/`sleep` calls are.
  - **The PC switch was the visible half.** `attackAt` and `combatMove` now
    `await pcAttack(...)` before `afterCombatAction()`, so the hand-over, the
    `Active:` line and the camera move all land after the blast. *Measured in
    the browser*: blast on screen until t+901ms, turn handed over at t+934ms.
    It used to be immediate.
  - **The special queue moved onto the turn chain.** `void
    specials.drainQueue()` was fire-and-forget; a special can damage, and
    damage now waits for its blast, so a loose special would have had its
    explosions interleaving with the monsters' — two chains taking turns on
    one timeline in an order nothing decides. `queueTurn` is serial, so it
    still runs before the monsters. (Dialogs a special raises are unaffected:
    dialog input is routed ahead of the `busy` gate.)
  - **`flyMissiles` awaits the flight**, which is `do_missile_anim` blocking —
    it is what puts the deferred `hitSpace` calls after the projectiles.
  - *How this was kept honest*: `verify-screen`'s logged outputs are a
    fingerprint of the whole run (see the gotcha above), and they came back
    **identical** through the refactor — same damage rolls, same loot, same
    positions — which is the evidence that no `get_ran` call moved. The one
    deliberate exception is the special-queue change, which reorders when
    queued specials run relative to the monsters and shifts the fingerprint
    with it.
  - *Gotchas for anyone driving the game*: an action no longer returns when
    its animation starts, it returns when the animation is **over**. Three
    `verify-screen` steps had to change shape: the attack loops must `await`
    (twenty-five swings fired at once otherwise), the missile step samples
    `screen.missiles` *before* awaiting the shot (the sky is empty afterwards),
    and the fireball step records what flew through a new `window.__watchAnim`
    tap and asks `visibleTranscript(launchTime)` whether the damage text was
    *scheduled* before the projectiles landed — a sample-independent version
    of the check it used to make by looking at the screen at the right moment.
    The gate also runs at `?pace=1` now: with blasts blocking, the shipped 3x
    play-testing pace would take minutes.
  - Tests: `test/damage.test.ts` pins the two orderings directly — a PC's
    health is untouched while the blast is on screen and lands when it clears,
    a monster dies after its own blast, and the active PC does not change
    until the swing has finished playing.

- **A volley's explosion is a different animation *and* a different sound
  table (2026-07-27).** Play-test report: a fireball's impact is "not the same
  graphic or sound as in the original". Both halves were real, and both come
  from the same mistake — treating `do_explosion_anim` as a row of
  `boom_space` hits.
  - **booms.png holds two things.** Row 0 is the one-frame hit sprites, a
    column per `boom_gr` type — that is what `boom_space` draws
    (boe.graphics.cpp:1553). Rows 1..6 are **eight-frame explosions**, one row
    per boom type, and that is what `do_explosion_anim` plays
    (`28 * (t + offset)`, `36 * (1 + boom_type)`, boe.newgraph.cpp:636). This
    port drew everything with row 0, so a fireball landed like a punch. `Boom`
    now carries `animated`, and the renderer steps the frame from the blast's
    own elapsed time, drawing nothing once `t + offset` leaves 0..7 — the tail
    of the C++'s `t < 11` loop.
  - **One sound for the volley, from the other table.** `do_explosion_anim`
    plays `boom_type_sound[cur_boom_type]` = `{5,10,53,53,53,75}` once, on the
    *last* explosion's type; `add_explosion` raises nothing. This port played
    `sound_lookup[...]` per queued hit — `boom_space`'s table, indexed by
    sound type rather than boom type — so a fireball made several of the wrong
    noise. Measured after the fix: `[11, 5]`, the missile's launch and the
    fire explosion, which is what the C++ plays.
  - **The stagger, and the RNG that goes with it.** `add_explosion` rolls
    `offset = (i == 0) ? 0 : -get_ran(1,0,2)` so a dozen explosions don't
    pulse in lockstep, and `do_explosion_anim` rolls two more per `place_type
    1` explosion to scatter it around its square. Both are ported, which means
    `boomSpace`/`runBoomAnim` now take a `GameRng` — those rolls are part of
    the sequence.
  - **The fireball's own blast at the centre.** `ashes_loc` (boe.combat.cpp:
    1425) — the fire spells mark the middle of the burn and add an explosion
    there if none of the mass damage already lit it, so the scorch always has
    a blast over it. Ported for FIREBALL/FLAMESTRIKE, FIRESTORM and
    DIVINE_THUD, including the `use_unique_ran` flag the C++ passes so the
    extra roll can't shift an older replay. TODO(M6): `set_ash` itself, the
    scorch mark left on the ground.
  - Also ported while here: `add_explosion`'s `14 * (x_width - 1)` /
    `18 * (y_width - 1)` nudge, which centres a blast on a big creature
    instead of on its top-left square.

- **The pace knob is indexed to the play-tested speed, not the C++'s
  (2026-07-27).** After watching fights at several settings the one that read
  best was 0.9 of the original's timings, so `1` now *means* that: `paced()`
  multiplies by `PACE_BASELINE = 0.9` as well as the knob, and the default
  knob position is 1. The point is that the number a player sees stays
  meaningful — 1 is normal, 2 is slow motion — while the divergence from the
  original lives in one named constant. Set `PACE_BASELINE` to 1 for exactly
  the C++'s speed; every other constant in `anim.ts` is already its number.

- **Nine from the eleventh play-test round (2026-07-28).** Reported together;
  two of them turned out to be fallout from the async refactor, which is worth
  knowing on its own.
  - **Floating promises the refactor left behind.** `checkParryOpportunity`,
    `monsterTouches` and `monsterSpells`' `hit()` helper all became async and
    were still being called without `await` — the earlier audit only covered
    the exported damage functions, and these are local. Their damage was
    landing detached from the turn that caused it. The audit is now
    declaration-based (find every `async function`/`async method`/`= async`,
    then every call that isn't awaited, voided or returned) and comes back
    clean; run it again after any async change.
  - **A volley didn't wait for its own explosion.** `doCombatCast`'s tail ran
    `runBoomAnim()` and returned — `handle_marked_damage` needs no blast of
    its own, so nothing waited. The C++ blocks inside `do_explosion_anim`
    before it. That is the "camera doesn't linger on the target" report: the
    missile swings the view onto the target, the blast starts, and the caller
    immediately recentred over the top of it. *Measured after the fix*: camera
    to the target's frame at 297ms, blast until 725ms, view back at 737ms.
  - **`parry` was never cleared.** `do_monster_turn` ends with
    `for(cPlayer& pc : univ.party) pc.parry = 0` (boe.combat.cpp:2623) — a
    guard lasts one round. Without it the damage reduction and the to-hit
    bonus stayed up for the whole fight and a stand-ready PC kept its free
    swing in hand round after round, which is the "parry does damage too
    often" report. (`char_parry`, `char_stand_ready`, the `parry/4` reduction
    and the `5 * parry` to-hit penalty all matched already.)
  - **Looking around outdoors blanked the world.** `recentre()` in main.ts put
    the view back on `party.townLoc` for anything that wasn't combat — a
    coordinate left over from the last town, or from a combat arena — so the
    outdoor window drew 9x9 squares of unexplored nothing until the party
    moved. It uses `party.getLoc()` now. (The C++ never had the bug because
    `draw_terrain` takes its origin from `univ.party.out_loc` outdoors and
    only uses `center` in town.)
  - **The arena formed the party up in the wrong shape.** `outCombat.ts` had
    an invented 2x3 block where the C++ uses `hor_vert_place` — the same wedge
    town combat forms up in: one in front, two behind, three across the back.
    Now shared from `combat.ts`, and `verify-screen` pins the six offsets.
  - **A big creature took its damage number on its top-left square.**
    `boom_space` adds `14 * (x_width - 1)` / `18 * (y_width - 1)`
    (boe.graphics.cpp:1541) to centre the blast; the port only did it in the
    volley path, so a melee hit on a bear drew the number to the bear's left.
  - **"Get" did nothing in combat.** `handle_get_items` works in MODE_TOWN
    *or* MODE_COMBAT, reaching from the party's square in town and the acting
    PC's in a fight, where it also costs 4 AP (boe.actions.cpp:1389). This
    port gated the key on town alone, which is why "g" over a pile of arena
    loot said there was nothing there.
  - **Clicking your own figure did nothing.** `handle_terrain_screen_actions`
    sends a click with zero offset to `handle_pause` (boe.actions.cpp:325),
    which in combat is Stand Ready. The port had the branch but never reached
    it: the click handler discarded a centre click (`dx === 0 && dy === 0`)
    before the dispatch could see it.
  - **Stink Cloud has no projectile, and this port doesn't draw one.**
    `CLOUD_STINK`/`FOUL_VAPOR` are a bare `place_spell_pattern` in both
    `do_combat_cast` and the town cast; checked in the browser, the cast
    launches nothing. Whatever was seen flying was another spell (Flame and
    the fire family do throw one) or the targeting overlay.
  - **Resist Magic never wore off outside a fight.** `increase_age`'s
    "Protection, etc." block decays INVULNERABLE, MAGIC_RESISTANCE, INVISIBLE,
    MARTYRS_SHIELD, ASLEEP and PARALYZED **every turn** (and POISONED_WEAPON
    every fortieth); this port decayed them only in `combat_run_monst`. Ported
    with the C++'s own brace-less `if`, which decays INVULNERABLE *twice* on
    the turn any of the six is about to expire — pinned by a test so it can't
    be tidied away. The four party-wide effects (STEALTH, DETECT_LIFE,
    FIREWALK, FLIGHT) and their "your footsteps grow louder" messages are
    ported with them; FLIGHT's "you plummet to your deaths" is still TODO(M6),
    since it needs the outdoor terrain check.

- **The job board, and quests handed over by hand (M6, 2026-07-28)**:
  `game/jobBank.ts` ports `show_job_bank` / `fill_job_bank`
  (boe.dlgutil.cpp:770/794) and the `RECEIVE_QUEST` arm of `handle_talk_node`
  (:1148). The **JOB_BANK talk node opens a board** now: four offers with their
  deadline and pay, a Take beside each, the dispatcher's mood along the bottom,
  and taking one starts the quest. That was the only caller
  `generateJobBank` was missing, so the M6 quest chunk from 2026-07-27 is now
  reachable from inside the game. `RECEIVE_QUEST` — an NPC giving a quest with
  no board behind it — landed with it. The rules live in `jobBank.ts` so they
  can be tested headless; `main.ts` owns only the dialog, the same split
  training uses.
  - *Gotcha*: a board too angry to deal with the party (`anger >= 50`) doesn't
    open at all and gives the node's str2 brush-off instead. The test reads the
    list **without growing it**, so a board that has never been opened is never
    angry — and since `generate_job_bank` only runs when a board is first
    opened, anger from a missed deadline bites on the *next* refresh, not this
    one.
  - *Gotcha*: taking a job refills its slot from one of the two spares (slots 4
    and 5), and the C++'s comment says "otherwise, clear space" — but there is
    no else branch. With both spares empty, which is *every* board
    `generate_job_bank` rolls (it fills at most four of six), the taken job
    stays on the board and can be taken again. Kept; the second take just
    rewrites the same job with today's date.
  - *Gotcha*: the source recorded on a job taken from a board is the
    **personality** of whoever is being talked to, not the board number — even
    though `special_increase_age` then indexes `job_banks` with that source when
    a deadline is missed. On any scenario with more than one board it angers the
    wrong dispatcher. Kept, and commented at both ends.
  - *Gotcha*: `RECEIVE_QUEST` on a quest the party has already **failed**
    returns without touching the reply at all, so the previous line stays on
    screen. The C++ has a TODO there wondering what it should do.
  - *Worth knowing when reading the C++*: `show_job_bank` asks the resource
    manager for a dialog named `job-bank` while the file that ships is
    `job-board.xml`, and writes its mood line into a control called `prompt`
    where that file's field is `feedback`. Neither could work as written; the
    port does what the code plainly means.
  - **A dialog fix went with it**: `Dialog`'s single-column rows never measured
    or wrapped their labels — the panel was sized from its text and buttons
    alone, so a prose row (a board's offer) ran off the side of the box. Rows
    now wrap to the same width the text does and grow their own height, with
    the two-column dense path (the training list) untouched. TODO(M3): the real
    `job-board.xml` is a picture, a title and four framed blocks with their own
    buttons; this is the same rules as a list, pending the dialogxml toolkit.
  - Tests: `test/quests.test.ts` covers the offer text (both deadline
    spellings), the four bands of the mood line, the lazy roll, the spare-slot
    swap, and both talk nodes — driven through synthetic talk nodes, since
    valleydy has neither type. `verify-screen.mjs` opens the board in the real
    UI, takes the job with a keypress and checks the quest started; it pins the
    offer rather than letting the board roll itself, because
    `generate_job_bank` offers each quest on a 50% roll and an unpinned board
    is empty half the time.

- **Alchemy (M6, 2026-07-28)**: `data/alchemy.ts` ports `eAlchemy`, `cAlchemy`
  and all twenty recipes from alchemy.cpp verbatim, plus `fail_chance`,
  `charges`, `can_make` and `cItem(eAlchemy)` (item.cpp:364) — the potion a
  recipe produces. `game/alchemy.ts` ports `do_alchemy` (boe.party.cpp:2284)
  with `cPlayer::has_abil` and `has_space` under it, and the eligibility half of
  `alch_choice` (:2345); `main.ts` ports `handle_alchemy`'s mode gates
  (boe.actions.cpp:1224) and runs the two dialogs. **`A` in town now makes
  potions**: pick who mixes, pick what, and the plants in their pack turn into
  a potion the USE button can drink.
  - An ingredient is just an item whose *ability* is the plant
    (`ItemAbil.HOLLY` … `MANDRAKE`), so `has_abil` — the unequipped counterpart
    of `has_abil_equip`, which this port didn't have — is the whole search. It
    requires a charge left, so a spent rechargeable plant sitting in the pack
    isn't an ingredient.
  - *Gotcha*: `fail_chance`'s guard is `skill - difficulty > fail_chances.size()`
    on a nine-entry table, so a PC exactly nine above the difficulty indexes one
    past the end — undefined in the C++. Read as 0 here, which is what the next
    step up gives anyway.
  - *Gotcha*: `do_alchemy` sets the new potion's `charges` but not
    `max_charges`, which `cItem(ITEM_POTION)` left at 1 — so a two- or
    three-dose potion reads as over-full. Kept, and pinned by a test.
  - *Gotcha*: the two-ingredient path removes the **higher slot first**,
    because `remove_charge` can take an emptied item out of the pack and
    everything below it shifts up. The C++ has its own comment saying so.
  - Ingredients are spent before the roll, so a failed mixing still eats them;
    the refusals before that point (no space, no ingredients) spend nothing.
  - The shop's alchemy line now names the ingredients instead of saying
    "Alchemical recipe" — and *keeps the C++'s off-by-one*: it looks the names
    up at `int(ingredient) + 1` in a 1-based table (boe.newgraph.cpp:827) where
    the scenario editor uses no offset, so a holly recipe advertises comfrey
    root. Cosmetic; the recipe itself uses the right plant. `item-abilities` is
    now one of the string tables the game loads.
  - TODO(M3): `pick-potion.xml` is a grid of twenty labelled buttons with the
    mixer's name and skill along the top, and `display_alchemy` (the paginated
    help text behind the shop's Info button) is still unported. Both want the
    dialogxml toolkit.
  - Tests: `test/alchemy.test.ts` (13) covers the table, the fail/charge curves
    including the off-the-end read, the choice list's `can_make` marking, and
    `do_alchemy`'s five outcomes. `verify-screen.mjs` gained a step that mixes a
    Weak Healing Potion through both dialogs with real keypresses.

- **Hunger (M6, 2026-07-28)**: `increaseAge.ts` gains the "Food" block
  (boe.actions.cpp:3467) and `take_food` (boe.items.cpp:82). Every thousandth
  turn the party eats one ration per **living** PC; if the larder is short,
  everyone takes `get_ran(3,1,6)` as SPECIAL damage under a "Starving!" line,
  and the food reserve the status bar has always shown finally means something.
  - *Worth knowing*: the shortfall isn't per hungry PC — one missing ration
    starves the **whole party** through `hit_party`, at one shared roll. That's
    the C++'s own broad brush.
  - Placed **before** poison, disease and acid, which is where the C++ has it;
    all four consume the RNG, so the order is part of the sequence. The two
    blocks this port already had out of order (the party's spell effects and
    the protections, which sit at the end here and at the start there) consume
    none, so they can't move it.
  - `try_auto_save("Eat")` is the one thing left in `increase_age` — eating is
    the C++'s autosave point, so it waits for M7's save system. Marked
    TODO(M7) in place.

- **The M5 leftovers: soul crystals, petrification, mindduel (2026-07-28).**
  The list of odds and ends M5 left behind, cleared in one pass.
  - **The soul crystal** — `game/soulCrystal.ts` ports `record_monst`
    (boe.monster.cpp:1084), `has_trapped_monst` and `pick_trapped_monst`
    (boe.party.cpp:2444/2450); `Party.imprisonedMonst` is the four slots.
    **Capture Soul now catches things** (in town and in combat) and
    **Simulacrum summons them**: `combatCastSpell` runs the C++'s preamble —
    the crystal has to hold something, the host opens the picker, and the spell
    is refused if the caster can't afford the monster's *level*, which is what
    it costs (the spell's own cost is -1 in the table). `session.sumMonst` /
    `sumMonstCost` are `store_sum_monst` / `store_sum_monst_cost`.
    - *Gotcha*: the catching roll is `get_ran(1,1,100) * 7 / 10` against
      `charm_odds[level / 2]` — the same table charm and sleep use — so nothing
      much above level 14 can ever be caught. A monster that splits, or one the
      scenario marked IMPORTANT, never can.
    - *Gotcha*: the slot is **rolled, not searched for**. One roll for a slot;
      if it's occupied, a second roll picks one of the four to overwrite. A full
      crystal loses a soul at random.
    - *Gotcha*: Mindduel and Simulacrum are both excluded from
      `do_combat_cast`'s ordinary "take the cost on the first target" line —
      Mindduel is free (it spends a smoky crystal instead) and Simulacrum pays
      its own price.
  - **Petrification** — `petrifyPc`/`petrifyMonst` (boe.party.cpp:2694,
    boe.specials.cpp:1583) in `damage.ts`, wired into the PETRIFY monster
    ability, which reaches it both as a gaze and as a touch. The strength is a
    *percentage of the monster's own level*.
    - *Gotcha*: stone is not death — `kill_pc(STONE)` skips the life-saving
      item (the C++ says so in as many words) but the **luck** save still runs,
      so a lucky PC can shrug off a gaze inside `kill_pc`.
    - *Gotcha*: the monster test is `r1 > 14 || resist[MAGIC] === 0`, and a
      resistance of **0** means it takes no magic damage at all — so only a
      magic-proof monster is immune, and an ordinary one is stoned on a low
      roll. The C++ has its own TODO wondering about this; kept.
  - **Mindduel** — `game/mindduel.ts` ports `do_mindduel` (boe.party.cpp:1497),
    wired into the combat cast with its smoky crystal. Ten rounds of tug of war
    over spell points, and the only spell in the game that can kill its own
    caster: at zero points the loser takes two dumbfounding a round and eight
    is lethal. Duelling a friendly creature turns the town hostile first.
    - *Gotcha*: both dumbfounding counters are written **straight into the
      status**, not through `dumbfound()`, so nothing resists and nothing
      clamps. The winner's spell points aren't capped at their maximum either;
      `increase_age` bleeds the excess off afterwards.
  - **`drain_pc` needed nothing.** The note that said it "also takes a level
    away, which needs the level-down path" was wrong: CBoE's `drain_pc`
    (boe.party.cpp:390) clamps experience at zero and prints the note, full
    stop. There is no level-down path to write, and the TODOs claiming
    otherwise are gone.
    - **But a real bug fell out of reading it**: `handle_disease`'s roll of 5 is
      `drain_pc(pc, 5)`, and this port printed "unaffected" instead — the same
      line rolls 9 and 10 print. Disease now drains five experience there.
  - **The SPECIAL monster ability** (boe.combat.cpp:2393) — a scenario node the
    monster runs itself, at most once a round, with the odds in thousandths.
    It sits *inside* the special-attacks block, so a monster that has already
    shot can still call it; the node reads its target through the reserved
    pointers (21/22 the square, 20 the target, a PC passed as `11 + index`
    ready for a SELECT_TARGET node), and a node that reports a positive value
    has taken the action points itself.
  - **Still open in this area**: `AFFECT_SOUL_CRYSTAL`, the special node that
    catches or releases a soul. Its C++ arm starts `if(pc_num < 100) break;` —
    it only works on the *creature* a monster-context special is running
    against — and `SpecialCtx` has no creature target yet, only `curTarget` for
    PCs. That plumbing is the job, not the opcode.
  - Tests: `test/soulCrystal.test.ts` (16) covers all five areas.

- **The dialogxml toolkit (M3's long-term item, 2026-07-28).** The game ships
  **211 dialog definitions** in `data/dialogs`, and until now this port drew its
  own approximations of them. Three files replace that:
  - **`dialogs/dialogXml.ts`** parses one definition into a `DialogDef` —
    `<text>`, `<button>`, `<pict>`, `<led>`, `<group>`, `<field>` and `<line>`,
    with their rects, fonts, colours, frames and `def-key`s, and the `<br/>`
    breaks inside a label. **All 211 parse**, pinned by a test that reads every
    file in the directory. (`stack`/`page`/`pane`/`tilemap` are skipped: they
    only appear in the scenario editor's dialogs, which this port doesn't run.)
  - **`dialogs/xmlDialog.ts`** draws and runs one. It is a `ModalScreen`, so it
    slots into the `DialogHost` the rest of the game already uses; the API is
    written to read like the C++ call sites (`me["day"].setTextToNum(n)` →
    `dlg.setNum('day', n)`, `me["take1"].hide()` → `dlg.hide('take1')`).
    Buttons draw from their real sheets at `cButton::btnRects`' geometry, LEDs
    from `cLed::ledRects`, and the pict kinds the player's dialogs use (dlog,
    pc, monst, item, ter, talk, scen, status) from theirs.
  - **`dialogs/dialogStore.ts`** is `ResMgr::dialogs`: definitions are
    registered by name up front, because opening a dialog is a synchronous
    lookup in the code that does it.
  - **`pc-info.xml` is the first real call site**, replacing the transcript
    stand-in: `give_pc_info` / `display_pc_info` (boe.infodlg.cpp:476/:360) with
    all nineteen skills, the weight and health lines, both weapon blocks with
    their to-hit and damage adjustments, and arrows that step through the
    *living* party members without closing the sheet.
  - *Gotcha, and it is load-bearing*: `cControl::relocateRelative`
    (control.cpp:78) places a `neg`-positioned control's **top-left corner** at
    the computed point — the C++ negates the offset and hands it to `relocate`,
    which never allows for the control's own width or height. So a `neg`
    control overlaps its anchor instead of sitting beside it. Kept, and pinned
    by a test.
  - *Gotcha*: `btnRects` are `{top, left, bottom, right}`, not x/y/w/h. The
    tiny button's `{0,42,10,56}` means **x=42**, and reading it the other way
    put it off the bottom of a 26px-tall sheet — caught by looking at the
    screenshot, not by a test.
  - *Gotcha*: a control positioned `neg` with **no anchor** is placed against
    the *dialog's* edges, and that can only happen after the window has been
    measured — `cDialog::recalcRect` (dialog.cpp:425) sizes the window to its
    furthest control plus 6px, deliberately ignoring those controls, then
    places them. `XmlDialog`'s constructor does the same two passes.
  - *Gotcha*: `<group>` carries no `top`/`left` even though the schema marks
    them required, so the rect parser has to tolerate their absence.
  - **The arrow keys had to be re-routed.** `InputRouter` turns them into
    movement before `onKey` is ever called, so a dialog whose buttons carry
    `def-key='left'`/`'right'` — pc-info's do — never saw them. `onMove` now
    offers them to an open dialog first.
  - Tests: `test/dialogXml.test.ts` (20) covers parsing all 211, the four
    relative-positioning modes, window sizing, click and key dispatch,
    handlers that hold the dialog open, hidden controls, LED groups, and
    pc-info itself. `verify-screen.mjs` opens the sheet through the real "?"
    button, checks it filled, steps a PC with the arrow key and closes it.

- **The item window's other two pages (M6, 2026-07-28)**: the panel on the
  middle right has three kinds of page, and until now this port drew one of
  them. `game/itemWindow.ts` ports `eItemWinMode`, `set_stat_window`
  (boe.text.cpp:564) and the `spec_item_array` it builds; `render/scrollbar.ts`
  ports `cScrollbar`; `put_item_screen`'s two other branches and
  `place_item_bottom_buttons` (:499) land in `render/screen.ts`. **The bottom
  row of the item panel is real now** — six portraits, a Spec tab, a Jobs tab
  and the help button — and **9** and **0** (or those tabs) open the Special
  Items and Quests pages. A special item's Info opens `put_spec_item_info`'s
  description, a useable one grows a Use button that runs its
  `USE_SPEC_ITEM` node, and a quest's Info opens **`quest-info.xml`**, the
  second call site on the dialogxml toolkit.
  - **A PC's own pack scrolls now too.** The scrollbar was the missing piece:
    a pack holds 24 items, the panel shows eight, and only the first eight had
    ever been reachable. `item_sbar` is drawn at its own absolute rect
    (boe.main.cpp:71) because it is a control on the main window rather than
    part of the panel, and `item_hit = item_sbar->getPosition() + i`
    (boe.actions.cpp:1811) is why `Screen.inventoryHit` now returns an index
    into the list rather than a row on screen.
  - *Gotcha*: the Use button on a special item is placed **where Drop would
    go**, "so there's no gap between Use and Info" — so a click in the Drop
    slot on that page is a Use, and `handleClick` has to know which page it is
    looking at. It is also hidden in combat.
  - *Gotcha*: `set_stat_window` asked for a **dead** PC's page quietly gives
    the first living one instead, and `put_pc_screen` re-runs that test from
    inside the *drawing* code ("sometimes this gets called when a character is
    slain"). Both kept where the C++ has them.
  - *Gotcha*: the Jobs tab isn't drawn at all in a scenario with no quests,
    which is every scenario bundled here — so it only appears once something
    puts one in the list. The Spec tab is always drawn.
  - *Gotcha*: a quest's status rides in its `spec_item_array` entry as
    `+10000` completed, `+20000` failed, read back with `/ 10000`. A completed
    quest is struck through in green across the width of its own name; a
    failed one is drawn in red.
  - Not ported with it: dragging the scrollbar's thumb (the C++ runs its own
    event loop inside `handleClick` to do it; the arrows and the track work),
    the mouse wheel (`InputRouter` has no wheel event yet), and
    `show_dialog_action("help-inventory")` behind the "?" button.
  - **A dialogxml sizing bug went with it**: `cDialog::recalcRect` measures the
    window against controls whose frames the *parser* has already sized, and
    this port kept the definition as read — so a button carrying only a `top`
    and a `left`, which is exactly what quest-info's Done does, measured as
    nothing and the window closed above it. `controlSize` now answers the
    question in the one place both the measuring pass and the hit test ask.
  - Tests: `test/itemWindow.test.ts` (14) covers the three pages, the dead-PC
    substitution, the quest status tags and the scrollbar's clamping, stepping
    and paging. `verify-screen.mjs` gained a step that opens both pages with
    their keys, scrolls the special items with the real scrollbar arrow,
    checks the row under the pointer follows the scroll, and reads a quest
    through `quest-info.xml`.

- **Five from the twelfth play-test round (2026-07-28).** Four were real gaps;
  one turned out to be the original's own behaviour.
  - **The shadow past your vision** — `apply_unseen_mask`
    (boe.newgraph.cpp:138) had never been ported, so the edge of the lit area
    was a hard black wall. Every square of the view the party hasn't explored
    now gets `bw_pats[3]`, the 50% dither out of bwpats.png, tiled over it.
    - *The detail that makes it work*: the rect stamped is **8px wider and
      taller than a tile and sits 4px up and left of it**, so the shadow bleeds
      over the ground you *can* see. That overlap is the whole effect, and it
      is why the mask is a separate pass over the finished terrain rather than
      part of drawing each square — it goes over the monsters and the party
      symbol too.
    - `unexplored_area` is 13x13 around the view centre and the mask reads
      indices 1..11, so it covers one square *more* than the 9x9 view in each
      direction and clips the overhang; that extra ring is what lets the bleed
      reach the outermost visible squares.
    - Skipped in an outdoor arena and in a dark town, which uses
      `apply_light_mask` instead — an elliptical region around each light
      source, still unported (TODO).
  - **Bookshelves you couldn't search** — `adj_town_look` (boe.specials.cpp:
    1292) was inlined into `lookAt` as "run the square's special", and its
    other half was missing. A town item can be marked `contained`, which hides
    it from `do_look` and from Get; a bookshelf, dresser, crate or barrel is a
    **container**, and looking at one is what opens it. `session.isContainer`
    and `session.adjTownLook` port the real function, and Look now puts the
    contents in the same get-items dialog Get uses ("Looking in container:").
    The three messages that go with it — the find, the "(Use this space…)"
    hint and "Search: You don't find anything." — landed with it.
    - *Gotcha*: the "Not close enough to search." branch only skips the
      *special*; it leaves `can_open` alone, so a distant container would still
      open. Dead in play, since `handle_look` only calls the function for an
      adjacent square. Kept, and pinned.
    - *Gotcha*: the C++'s return value is always `false` — the `need_redraw`
      it feeds is never set.
    - While here: the C++ has a standing TODO saying an **OUT_LOOK** special
      ought to fire when you look at something outdoors, and never fires one.
      This port does. Noted in place; it is the one thing here the original
      doesn't do.
  - **Bash worked anywhere** — `handle_keystroke`'s `b`, `u`, `L` and `t` all
    require **MODE_TOWN exactly** (boe.actions.cpp:3019-3049, :3087), not
    merely "in a town": mid-conversation, mid-shop, mid-look or mid-spell the
    answer is "Finish what you're doing first." This port checked only
    "not in combat, not outdoors", so B armed a bash while a shopkeeper was
    waiting. All four now go through `selectSpace`/`beginTalk`, which also
    ports the **toggle** — pressing the same key again cancels — and the
    "Select a space." line each one prints.
    - **Pick Lock (`L`) works now.** It was a stub saying it had no key;
      `handle_bash_pick` is one function with an `isBash` flag, so the pick
      side came with the fix, including `ONLY_CAN_LOCKPICK`'s "no picks" /
      "picks not equipped" refusals, which `selectPcOptions` already had.
    - Both now check `adjacent` and `is_unlockable` before asking who does it,
      as `handle_bash_pick` does: "  Must be adjacent." / "  Wrong terrain
      type."
  - **The automap window drags now.** The original opens it as a second OS
    window, which the OS lets you move; the exile-wasm build draws it over the
    canvas and re-implements the dragging (boe.main.cpp:1615-1720). Ported:
    press anywhere on the window to pick it up, at least 50px stays on the
    canvas, and the top edge is clamped to 0 so the title is always reachable.
    `MAP_WINDOW` is gone in favour of `MapScreen.pos` and `MapScreen.window`.
    - `InputRouter` gained `onDrag`/`onRelease` on **window** rather than the
      canvas, because a drag has to keep tracking once the pointer leaves —
      the same reason the C++ routes every mouse event to the map handler while
      `map_dragging` is set.
    - The position is not persisted between reloads; the WASM build keeps it
      in preferences, which this port has no equivalent of until M7's saves.
  - **Webbed by a square you can't walk into: that is the original.**
    `check_special_terrain` runs the fields, the webs and the pushables
    *before* `town_move_party` ever tests `is_blocked` (boe.specials.cpp:274
    vs boe.actions.cpp:4223), so walking into a blocked square with a web on
    it webs the party and uses the web up. This port already had that order,
    and `web_space` has no blocking test either. What *does* limit it is
    placement: `place_spell_pattern` refuses any square with
    `sight_obscurity >= 5`, so no spell puts a web on a solid wall — only on
    blocked-but-see-through terrain (a fence, a counter) or wherever the
    scenario preset one. Left alone.
