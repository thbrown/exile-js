# Blades of Exile Play-Testing Guide

## Quick Start

The development server runs on **http://localhost:5199**.

```bash
npm run dev
```

This starts the Vite dev server. The game loads automatically in your browser. The default scenario is **Valley of Dying Things** (valleydy). To load a different scenario, add a query parameter:

```
http://localhost:5199/?scenario=stealth
http://localhost:5199/?scenario=zakhazi
http://localhost:5199/?scenario=busywork
```

## Keyboard Controls

### Movement
- **Arrow keys** or **Keypad (8/4/6/2)** — move in a direction
- **Home/End/PgUp/PgDn** — move diagonally

### Combat
- **C** or **SWORD button** — start or end a fight
- **Space** or **W** — wait / stand ready in combat
- **D** or **SHIELD button** — parry (defensive stance)
- **S** — shoot (in combat: pick a target; outside: aim a missile weapon)
- **E** — end combat

### Combat speed (a play-testing knob, not in the original)
- **-** — slower, **=** — faster. Works mid-fight, even while the monsters are
  going; the transcript reports the new pace (`1.00x` is the original's own
  timing).
- **`?pace=1`** in the URL starts at a given speed, e.g.
  `http://localhost:5199/?pace=1`.
- It ships at **3x** while combat is being play-tested: the view rests on each
  monster before it acts, the bar above the map names it (`Guard (ap: 4)`) and
  a projectile is slow enough to follow — the camera swings onto its target
  half way through the flight.

### Actions
- **F** — fight / attack at close range
- **T** — talk to someone (then click a direction)
- **L** — look at an object (then click a direction)
- **U** — use an object (then click a direction)
- **B** — bash a door or obstacle
- **G** — get / pick up an item
- **R** — rest / recover at an inn
- **A** — open the automap
- **X** — hold the turn on one PC (prevent auto-advance)

### Party & Inventory
- **1–6** — switch whose inventory pack is showing
- **Click on a PC row** — select that PC as active; click their name to equip/unequip items

### Spells & Magic
- **M** — cast a mage spell (opens spell picker)
- **P** — cast a priest spell (opens spell picker)
- **Escape** — cancel targeting / close dialogs

### Shops & Conversation
- **A–H** — buy items in a shop (A = first item, B = second, etc.)
- **Arrow keys** — scroll through shop inventory or dialog options
- **Escape** — leave a shop or conversation

## What's Implemented

✅ **Walking & Exploration**
- Move around the 605×430 world with line-of-sight fog and lighting
- Terrain, floor items, signs, doors (locked and bashable)
- Automap shows explored areas

✅ **Combat & Encounters**
- Town-mode combat (monsters attack when you're nearby)
- Outdoor random encounters
- Party spread across 6 action points, monster AI, projectiles
- Monster abilities: missiles, breath, touch attacks, summons, fields
- Spellcasting in combat (Flame, Spark, Heal, etc.)
- Status effects: poison, paralysis, sleep, haste, curse, bless

✅ **Inventory & Items**
- Pick up, equip, give, and drop items
- Identify and recharge from NPCs
- **Use items**: drink potions, fire wands, read books, cast from scrolls
- Skill-based equipment bonuses

✅ **Talking & Shops**
- NPC conversations with personality and keyword matching
- Buy/sell/trade with shopkeepers
- Training to improve skills and abilities

✅ **Spells**
- 147 spells in the spell list
- Cast spells in town and combat
- Town spells: Light, Healing, Dispel Magic, barriers, summons, etc.
- Combat spells with targeting and projectiles

✅ **Scenario Features**
- Scripted events (special nodes)
- Quest tracking and job banks
- Timed events and deadlines
- Party status effects (Stealth, Flight, Detect Life)

## Known Limitations

The game is in active development. Some features are still being implemented:

- ⏳ **Alchemy** (coming M6)
- ⏳ **Boats & horses** (coming M6)
- ⏳ **Spell targeting dialogs** (partial)
- ⏳ **Save/load** (coming M7)
- ⏳ **Some scenario scripts** may say "not implemented yet"

See `PROGRESS.md` for the detailed development status.

## Testing & Verification

To run the full test suite:

```bash
npm test
```

To run a headless verification (screenshots, console checks):

```bash
# Terminal 1: Start the dev server
npm run dev

# Terminal 2: Run the verification script
node scripts/verify-screen.mjs
```

Set the screenshot directory:

```bash
SHOTS_DIR=/tmp/exile-shots node scripts/verify-screen.mjs
```

## Scenario Files

Each `.boes` file is a gzip'd tar archive containing XML and map data:

- **valleydy** (Valley of Dying Things) — introductory scenario, about 3–4 hours
- **stealth** — stealth-focused puzzle scenario
- **zakhazi** — mid-level outdoor wilderness
- **busywork** — test scenario with various features

Load via `?scenario=name` or choose from the main menu (when implemented).

## Reporting Issues

If something crashes or behaves unexpectedly:

1. Open the **browser console** (F12) and check for errors
2. Look at `PROGRESS.md` — search for the feature name to see if it's still being implemented
3. Check `PLAN.md` for the architecture and known gotchas

Most features have a `TODO(Mn)` comment marking where they're waiting on a future milestone.

## Performance Tips

- The game runs at 60 FPS; smooth scrolling during targeting is normal
- Status icons animate; take up to a few frames to display
- Sounds start playing on the first user gesture (browser requirement)
- Missile animations are synchronized to game time, not real time

---

**Have fun testing!** 🎮
