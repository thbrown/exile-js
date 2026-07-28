/**
 * Using an item — `use_item` (boe.specials.cpp:585), with `poison_weapon`
 * (boe.party.cpp:442) and `drain_pc` (:390) under it.
 *
 * This is what the USE button on an inventory row does: potions, wands,
 * scrolls, rings with a charge, and the special items a scenario hands out. The
 * shape of the function is the C++'s — a `takeCharge` flag that starts true and
 * any refusal turns off, so a use that couldn't happen doesn't spend a charge.
 *
 * It is `async` because two of the branches block in the C++: MESSAGE puts a
 * dialog up, and the spells that need a target PC ask `select_pc`.
 */

import { Location } from '../core/location';
import { Attitude } from '../data/monster';
import { FieldType } from '../data/fields';
import { blocksMove } from '../data/terrain';
import {
  Item, ItemAbil, ItemType, ItemUse,
  abilGroup, abilHarms, canUse, useInCombat, useInTown, useMagic, useOutdoors,
} from '../data/item';
import { DamageType } from '../data/monster';
import { SPELLS, Spell, SpellRefer, SpellSelect, spellName } from '../data/spell';
import { removeCharge } from '../universe/inventory';
import { Player } from '../universe/player';
import {
  MainStatus, PartyStatus, Race, Skill, Status, Trait,
} from '../universe/skills';
import { SpellNote } from '../universe/living';
import { Universe } from '../universe/universe';
import { damagePc, hitParty } from './damage';
import { awardPartyXp, awardXp } from './damage';
import { GameMode } from './modes';
import { summonMonster } from './monsterPlace';
import { processForceCage } from './processFields';
import type { GameSession } from './session';
import type { SpecialHost } from './specials/context';
import { SpecCtx, SpecCtxType } from './specials/context';
import { combatImmedMageCast, combatImmedPriestCast } from './spellCombat';
import { startFancySpellTargeting, startSpellTargeting } from './spellCombatTarget';
import { doMageSpell, doPriestSpell, increaseLight } from './spellTown';

/**
 * drain_pc (boe.party.cpp:390) — experience lost, and nothing else. Worth
 * saying plainly because the name suggests otherwise and an earlier note here
 * claimed it took a level too: it doesn't. CBoE's `drain_pc` clamps the
 * experience at zero and prints the note, so a drained PC keeps every level
 * they have already been given. There is no level-down path to write.
 */
export function drainPc(pc: Player, howMuch: number): void {
  if (pc.mainStatus !== MainStatus.ALIVE) return;
  pc.experience = Math.max(pc.experience - howMuch, 0);
  pc.spellNote(SpellNote.DRAINED_XP);
}

/** is_poisonable_weap (boe.party.cpp:485) — melee weapons and ammunition. */
function isPoisonableWeap(item: Item): boolean {
  return item.variety === ItemType.ONE_HANDED || item.variety === ItemType.TWO_HANDED
    || item.variety === ItemType.ARROW || item.variety === ItemType.BOLTS;
}

/**
 * p_chance (boe.party.cpp:444) — the odds of applying poison cleanly, indexed
 * by the PC's Poison skill. Note the table only reaches 21 entries because the
 * skill is capped at 20.
 */
const POISON_CHANCE = [
  40, 72, 81, 85, 88, 89, 90,
  91, 92, 93, 94, 94, 95, 95, 96, 97, 98, 100, 100, 100, 100,
];

/**
 * poison_weapon (boe.party.cpp:442) — smear a dose on the first *equipped*
 * poisonable weapon. `safe` skips both the botch roll and the sound, which is
 * how a group-use item applies poison without anyone nicking themselves.
 *
 * The C++ walks the pack with `find_if` and, when the match isn't equipped,
 * steps past it and searches again — so an unequipped dagger in slot 0 doesn't
 * stop it finding the equipped sword in slot 3. (Its loop reads `equip[...]`
 * one past the end when nothing matches at all, which is undefined there; here
 * the search simply runs out and reports no weapon.)
 */
export function poisonWeapon(
  univ: Universe, pcNum: number, howMuch: number, safe: boolean,
  sound?: (which: number) => void,
): boolean {
  const pc = univ.party.pcs[pcNum];
  if (!pc) return false;

  for (let slot = 0; slot < pc.items.length; slot++) {
    const item = pc.items[slot]!;
    if (!isPoisonableWeap(item)) continue;
    if (!pc.equip[slot]) continue;

    let pLevel = howMuch;
    univ.addStringToBuf('  You poison your weapon.');
    let r1 = univ.rng.getRan(1, 1, 100);
    if (pc.traits[Trait.NIMBLE]) r1 -= 6;
    const skill = POISON_CHANCE[pc.skill(Skill.POISON)] ?? 100;
    if (r1 > skill && !safe) {
      univ.addStringToBuf('  Poison put on badly.');
      pLevel = Math.trunc(pLevel / 2);
      r1 = univ.rng.getRan(1, 1, 100);
      if (r1 > skill + 10) {
        univ.addStringToBuf('  You nick yourself.');
        // Written straight into the status, not through poison() — so this
        // dose ignores resistances and the frailty trait alike.
        pc.status[Status.POISON] = (pc.status[Status.POISON] ?? 0) + pLevel;
      }
    }
    if (!safe) sound?.(55);
    // The C++ records the slot; this port records the item itself, which is
    // what `pc_attack_weapon` and `fire_missile` already compare against.
    pc.weapPoisoned = item;
    pc.status[Status.POISONED_WEAPON] = Math.max(
      pc.status[Status.POISONED_WEAPON] ?? 0, pLevel);
    return true;
  }

  univ.addStringToBuf('  No weapon equipped.');
  return false;
}

/** The four select_pc flavours a CAST_SPELL item may ask for. */
const SELECT_PROMPTS: Record<SpellSelect, string> = {
  [SpellSelect.NO]: '',
  [SpellSelect.ACTIVE]: 'Cast this spell on whom?',
  [SpellSelect.ANY]: 'Cast this spell on whom?',
  [SpellSelect.DEAD]: 'Cast this spell on whom?',
  [SpellSelect.STONE]: 'Cast this spell on whom?',
};

/**
 * The wand and staff flavour text (boe.specials.cpp:1096). Anything not listed
 * falls back to naming the spell, as the C++'s default arm does.
 */
const SPELL_FLAVOUR: Partial<Record<Spell, string>> = {
  [Spell.FLAME]: '  It fires a bolt of flame.',
  [Spell.FIREBALL]: '  It shoots a fireball.',
  [Spell.FIRESTORM]: '  It shoots a huge fireball. ',
  [Spell.KILL]: '  It shoots a black ray.',
  [Spell.ICE_BOLT]: '  It fires a ball of ice.',
  [Spell.SLOW]: '  It fires a purple ray.',
  [Spell.DISPEL_UNDEAD]: '  It shoots a white ray.',
  [Spell.RAVAGE_SPIRIT]: '  It shoots a golden ray.',
  [Spell.ACID_SPRAY]: '  Acid sprays from the tip!',
  [Spell.FOUL_VAPOR]: '  It creates a cloud of gas.',
  [Spell.CLOUD_SLEEP]: '  It creates a shimmering cloud.',
  [Spell.POISON]: '  A green ray emerges.',
  [Spell.SHOCKSTORM]: '  Sparks fly.',
  [Spell.PARALYZE_BEAM]: '  It shoots a silvery beam.',
  [Spell.GOO_BOMB]: '  It explodes!',
  [Spell.STRENGTHEN_TARGET]: '  It shoots a fiery red ray.',
  [Spell.CHARM_MASS]: 'It throbs, and emits odd rays.',
  [Spell.DISPEL_BARRIER]: '  It fires a blinding ray.',
  [Spell.WALL_ICE_BALL]: '  It shoots a blue sphere.',
  [Spell.CHARM_FOE]: '  It fires a lovely, sparkling beam.',
  [Spell.ANTIMAGIC]: '  Your hair stands on end.',
};

/**
 * use_item (boe.specials.cpp:585). `pcNum` is whose pack the item is in and
 * `slot` where in it; the host is only needed for the two blocking branches.
 */
export async function useItem(
  session: GameSession, pcNum: number, slot: number, host?: SpecialHost,
): Promise<void> {
  const univ = session.univ;
  const party = univ.party;
  const pc = party.pcs[pcNum];
  if (!pc) return;
  const item = pc.items[slot];
  if (!item || item.variety === ItemType.NO_ITEM) return;

  const say = (line: string): void => univ.addStringToBuf(line);
  const sound = (which: number): void => host?.sound(which);
  let takeCharge = true;

  const abil = item.ability;
  // A magically inept PC can still use anything that isn't magic.
  const ineptOk = !useMagic(item);

  let userLoc: Location = { x: 0, y: 0 };
  if (session.isOutdoors) userLoc = { ...party.outLoc };
  if (session.inTown) userLoc = { ...party.townLoc };
  if (session.mode === GameMode.COMBAT) userLoc = { ...univ.currentPc.combatPos };

  if (!canUse(item)) {
    say("Use: Can't use this item.");
    takeCharge = false;
  }
  if (item.rechargeable && item.charges === 0) {
    say('Use: No charges left.');
    takeCharge = false;
  }
  if (pc.traits[Trait.MAGICALLY_INEPT] && !ineptOk) {
    say("Use: Can't - magically inept.");
    takeCharge = false;
  }

  // The mode gates. Note the second one reads "only outdoors" but fires when
  // the item works *neither* in town nor in combat, which amounts to the same.
  if (takeCharge) {
    if (session.mode === GameMode.OUTDOORS && !useOutdoors(item)) {
      say('Use: Not while outdoors.');
      takeCharge = false;
    }
    if (session.mode !== GameMode.OUTDOORS && !useInTown(item) && !useInCombat(item)) {
      say('Use: Only outdoors.');
      takeCharge = false;
    }
    if (session.mode === GameMode.TOWN && !useInTown(item)) {
      say('Use: Not while in town.');
      takeCharge = false;
    }
    if (session.mode === GameMode.COMBAT && !useInCombat(item)) {
      say('Use: Not in combat.');
      takeCharge = false;
    }
  }

  if (takeCharge) {
    say(`Use: ${item.ident ? item.fullName : item.name}`);
    if (item.variety === ItemType.POTION) sound(56);

    // `str` is mutated by several branches (the sign flips for a beneficial
    // status), which is why it is a local rather than read from the item.
    let str = item.abilStrength;
    const itemSpellLevel = str;
    const type = item.magicUseType;
    const harms = abilHarms(item);
    const group = abilGroup(item);

    switch (abil) {
      case ItemAbil.POISON_WEAPON:
        takeCharge = poisonWeapon(univ, pcNum, str, false, sound);
        break;

      case ItemAbil.AFFECT_STATUS: {
        const status = item.abilData as Status;
        switch (status) {
          case Status.MAIN:
          case Status.CHARM:
            // "These don't make any sense in this context" — the C++'s words.
            break;

          case Status.POISONED_WEAPON:
            if (harms) {
              say('  Weapon poison lost.');
              if (group) party.applyStatusAll(Status.POISONED_WEAPON, -str);
              else pc.applyStatus(Status.POISONED_WEAPON, -str);
            } else if (group) {
              // Note the `||`: once one PC succeeds the rest are short-circuited
              // and never get poisoned at all. That's the C++ as written.
              for (let i = 0; i < 6; i++)
                takeCharge = takeCharge || poisonWeapon(univ, i, str, true, sound);
            } else takeCharge = poisonWeapon(univ, pcNum, str, true, sound);
            break;

          case Status.BLESS_CURSE:
            sound(4);
            if (!harms) {
              say('  You feel blessed.');
              str = -str;
            } else say('  You feel awkward.');
            if (group) party.curseAll(str);
            else pc.curse(str);
            break;

          case Status.HASTE_SLOW:
            sound(75);
            if (!harms) {
              say('  You feel speedy.');
              str = -str;
            } else say('  You feel sluggish.');
            if (group) party.slowAll(str);
            else pc.slow(str);
            break;

          case Status.INVULNERABLE:
            sound(68);
            if (harms) {
              say('  You feel odd.');
              str = -str;
            } else say('  You feel protected.');
            if (group) party.applyStatusAll(status, str);
            else pc.applyStatus(status, str);
            break;

          case Status.MAGIC_RESISTANCE:
            sound(51);
            if (harms) {
              say('  You feel odd.');
              str = -str;
            } else say('  You feel protected.');
            if (group) party.applyStatusAll(status, str);
            else pc.applyStatus(status, str);
            break;

          case Status.WEBS:
            if (harms) say('  You feel sticky.');
            else {
              say('  Your skin tingles.');
              str = -str;
            }
            if (group) party.webAll(str);
            else pc.web(str);
            break;

          case Status.INVISIBLE:
            sound(43);
            if (harms) {
              say('  You feel exposed.');
              str = -str;
            } else say('  You feel obscure.');
            if (group) party.applyStatusAll(status, str);
            else pc.applyStatus(status, str);
            break;

          case Status.MARTYRS_SHIELD:
            sound(43);
            if (harms) {
              say('  You feel dull.');
              str = -str;
            } else say('  You start to glow slightly.');
            if (group) party.applyStatusAll(status, str);
            else pc.applyStatus(status, str);
            break;

          case Status.POISON:
            // From here down the four use types are spelled out one by one,
            // because curing is not "applying a negative dose" for every status.
            switch (type) {
              case ItemUse.HELP_ONE:
                say('  You feel better.');
                pc.cure(str);
                break;
              case ItemUse.HARM_ONE:
                say('  You feel ill.');
                pc.poison(str, univ.rng);
                break;
              case ItemUse.HELP_ALL:
                say('  You all feel better.');
                party.cureAll(str);
                break;
              case ItemUse.HARM_ALL:
                say('  You all feel ill.');
                party.poisonAll(str, univ.rng);
                break;
            }
            break;

          case Status.DISEASE:
            switch (type) {
              case ItemUse.HELP_ONE:
                say('  You feel healthy.');
                pc.applyStatus(Status.DISEASE, -str);
                break;
              case ItemUse.HARM_ONE:
                say('  You feel sick.');
                pc.disease(str, univ.rng);
                break;
              case ItemUse.HELP_ALL:
                say('  You all feel healthy.');
                party.applyStatusAll(Status.DISEASE, -str);
                break;
              case ItemUse.HARM_ALL:
                say('  You all feel sick.');
                party.diseaseAll(str, univ.rng);
                break;
            }
            break;

          case Status.DUMB:
            switch (type) {
              case ItemUse.HELP_ONE:
                say('  You feel clear headed.');
                pc.applyStatus(Status.DUMB, -str);
                break;
              case ItemUse.HARM_ONE:
                say('  You feel confused.');
                pc.dumbfound(str, univ.rng);
                break;
              case ItemUse.HELP_ALL:
                say('  You all feel clear headed.');
                party.applyStatusAll(Status.DUMB, -str);
                break;
              case ItemUse.HARM_ALL:
                say('  You all feel confused.');
                party.dumbfoundAll(str, univ.rng);
                break;
            }
            break;

          case Status.ASLEEP:
            switch (type) {
              case ItemUse.HELP_ONE:
                say('  You feel alert.');
                pc.applyStatus(Status.ASLEEP, -str);
                break;
              case ItemUse.HARM_ONE:
                say('  You feel very tired.');
                // 200 is the "no saving roll" adjustment; see the sleep gotcha.
                pc.sleep(Status.ASLEEP, str + 1, 200, univ.rng);
                break;
              case ItemUse.HELP_ALL:
                say('  You all feel alert.');
                party.applyStatusAll(Status.ASLEEP, -str);
                break;
              case ItemUse.HARM_ALL:
                say('  You all feel very tired.');
                party.sleepAll(Status.ASLEEP, str + 1, 200, univ.rng);
                break;
            }
            break;

          case Status.PARALYZED:
            switch (type) {
              case ItemUse.HELP_ONE:
                // Paralysis is counted in turns, so curing it is ×100.
                say('  You find it easier to move.');
                pc.applyStatus(Status.PARALYZED, -str * 100);
                break;
              case ItemUse.HARM_ONE:
                say('  You feel very stiff.');
                pc.sleep(Status.PARALYZED, str * 20 + 10, 200, univ.rng);
                break;
              case ItemUse.HELP_ALL:
                say('  You all find it easier to move.');
                party.applyStatusAll(Status.PARALYZED, -str * 100);
                break;
              case ItemUse.HARM_ALL:
                say('  You all feel very stiff.');
                party.sleepAll(Status.PARALYZED, str * 20 + 10, 200, univ.rng);
                break;
            }
            break;

          case Status.ACID:
            switch (type) {
              case ItemUse.HELP_ONE:
                say('  Your skin tingles pleasantly.');
                pc.applyStatus(Status.ACID, -str);
                break;
              case ItemUse.HARM_ONE:
                say('  Your skin burns!');
                pc.acid(str);
                break;
              case ItemUse.HELP_ALL:
                say('  You all tingle pleasantly.');
                party.applyStatusAll(Status.ACID, -str);
                break;
              case ItemUse.HARM_ALL:
                say("  Everyone's skin burns!");
                party.acidAll(str);
                break;
            }
            break;

          case Status.FORCECAGE:
            // The only status whose "help" arm isn't a status change at all —
            // it runs the cage's own break-out attempt.
            switch (type) {
              case ItemUse.HELP_ONE:
                processForceCage(session, pc.getLoc(), pcNum, str);
                break;
              case ItemUse.HARM_ONE:
                pc.sleep(Status.FORCECAGE, str, Math.trunc(str / 2), univ.rng);
                break;
              case ItemUse.HELP_ALL:
                for (let i = 0; i < 6; i++) {
                  const other = party.pcs[i];
                  if (other) processForceCage(session, other.getLoc(), i, str);
                }
                break;
              case ItemUse.HARM_ALL:
                party.sleepAll(Status.FORCECAGE, str, Math.trunc(str / 2), univ.rng);
                break;
            }
            break;
        }
        break;
      }

      case ItemAbil.BLISS_DOOM:
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel wonderful!');
            pc.heal(str * 20);
            pc.applyStatus(Status.BLESS_CURSE, str);
            break;
          case ItemUse.HARM_ONE:
            say('  You feel terrible.');
            drainPc(pc, str * 5);
            await damagePc(univ, pc, 20 * str, DamageType.UNBLOCKABLE, Race.HUMAN);
            pc.disease(2 * str, univ.rng);
            pc.dumbfound(2 * str, univ.rng);
            break;
          case ItemUse.HELP_ALL:
            say('  Everyone feels wonderful!');
            party.healAll(str * 20);
            party.applyStatusAll(Status.BLESS_CURSE, str);
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel terrible.');
            for (const other of party.pcs) {
              drainPc(other, str * 5);
              await damagePc(univ, other, 20 * str, DamageType.UNBLOCKABLE, Race.HUMAN);
              other.disease(2 * str, univ.rng);
              other.dumbfound(2 * str, univ.rng);
            }
            break;
        }
        break;

      case ItemAbil.AFFECT_EXPERIENCE:
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel much smarter.');
            awardXp(univ, pcNum, str * 5);
            break;
          case ItemUse.HARM_ONE:
            say('  You feel forgetful.');
            drainPc(pc, str * 5);
            break;
          case ItemUse.HELP_ALL:
            say('  You all feel much smarter.');
            awardPartyXp(univ, str * 5);
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel forgetful.');
            for (const other of party.pcs) drainPc(other, str * 5);
            break;
        }
        break;

      case ItemAbil.AFFECT_SKILL_POINTS:
        sound(68);
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel much smarter.');
            pc.skillPts += str;
            break;
          case ItemUse.HARM_ONE:
            say('  You feel forgetful.');
            pc.skillPts = Math.max(0, pc.skillPts - str);
            break;
          case ItemUse.HELP_ALL:
            say('  You all feel much smarter.');
            for (const other of party.pcs) other.skillPts += str;
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel forgetful.');
            for (const other of party.pcs) other.skillPts = Math.max(0, other.skillPts - str);
            break;
        }
        break;

      case ItemAbil.AFFECT_HEALTH:
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel better.');
            pc.heal(str * 20);
            break;
          case ItemUse.HARM_ONE:
            say('  You feel sick.');
            await damagePc(univ, pc, 20 * str, DamageType.UNBLOCKABLE, Race.HUMAN);
            break;
          case ItemUse.HELP_ALL:
            say('  You all feel better.');
            party.healAll(str * 20);
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel sick.');
            await hitParty(univ, 20 * str, DamageType.UNBLOCKABLE);
            break;
        }
        break;

      case ItemAbil.AFFECT_SPELL_POINTS:
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel energized.');
            pc.restoreSp(str * 5);
            break;
          case ItemUse.HARM_ONE:
            say('  You feel drained.');
            // Straight at the pool, not through drain_sp — no caster resistance.
            pc.curSp = Math.max(0, pc.curSp - str * 5);
            break;
          case ItemUse.HELP_ALL:
            say('  You all feel energized.');
            party.restoreSpAll(str * 5);
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel drained.');
            for (const other of party.pcs) other.curSp = Math.max(0, other.curSp - str * 5);
            break;
        }
        break;

      case ItemAbil.LIGHT:
        if (!harms) {
          say('  You have more light.');
          increaseLight(session, 50 * str);
        } else {
          say('  It gets darker.');
          increaseLight(session, -50 * str);
        }
        break;

      case ItemAbil.AFFECT_PARTY_STATUS: {
        const which = item.abilData as PartyStatus;
        if (harms) {
          const current = party.partyStatus[which] ?? 0;
          switch (which) {
            case PartyStatus.STEALTH:
              say('  Your footsteps become louder.');
              str *= 5;
              break;
            case PartyStatus.FIREWALK:
              say('  The chill recedes from your feet.');
              str *= 2;
              break;
            case PartyStatus.DETECT_LIFE:
              say('  Your vision of life becomes blurry.');
              break;
            case PartyStatus.FLIGHT:
              // Cancelling flight is the one arm that can kill the party: come
              // down over something solid and there is nowhere to land.
              if (current <= str) {
                const ter = univ.out.at(party.outLoc.x, party.outLoc.y);
                const info = univ.scenario.terTypes[ter];
                if (info && blocksMove(info)) {
                  say('  You plummet to your deaths.');
                  for (const other of party.pcs) other.mainStatus = MainStatus.DEAD;
                } else if (current > 1) {
                  say('  You plummet to the ground.');
                  await hitParty(univ, univ.rng.getRan(current, 1, 12), DamageType.SPECIAL);
                } else say('  You land safely.');
              } else say('  You start to descend.');
              break;
          }
          // Never take off more than is there, then flip the sign.
          if (str > current) str = current;
          str = -str;
        } else {
          switch (which) {
            case PartyStatus.STEALTH:
              say('  Your footsteps become quieter.');
              str *= 5;
              break;
            case PartyStatus.FIREWALK:
              say('  You feel chilly.');
              str *= 2;
              break;
            case PartyStatus.DETECT_LIFE:
              say('  You detect life.');
              break;
            case PartyStatus.FLIGHT:
              if ((party.partyStatus[PartyStatus.FLIGHT] ?? 0) > 0) {
                say('  Not while already flying.');
                takeCharge = false;
              } else if (party.inBoat >= 0) {
                say('  Leave boat first.');
                takeCharge = false;
              } else if (party.inHorse >= 0) {
                say('  Leave horse first.');
                takeCharge = false;
              } else say('  You rise into the air!');
              break;
          }
        }
        if (takeCharge) party.partyStatus[which] = (party.partyStatus[which] ?? 0) + str;
        break;
      }

      case ItemAbil.HEALTH_POISON:
        switch (type) {
          case ItemUse.HELP_ONE:
            say('  You feel wonderful.');
            pc.heal(str * 25);
            pc.cure(str);
            break;
          case ItemUse.HARM_ONE:
            say('  You feel terrible.');
            await damagePc(univ, pc, str * 25, DamageType.UNBLOCKABLE, Race.UNKNOWN);
            pc.poison(str, univ.rng);
            break;
          case ItemUse.HELP_ALL:
            say('  You all feel wonderful.');
            party.healAll(str * 25);
            party.cureAll(str);
            break;
          case ItemUse.HARM_ALL:
            say('  You all feel terrible.');
            await hitParty(univ, str * 25, DamageType.UNBLOCKABLE);
            party.poisonAll(str, univ.rng);
            break;
        }
        break;

      case ItemAbil.CALL_SPECIAL: {
        // The chain can refuse the use by returning a in its first slot.
        const { blocked } = await session.runSpecial(
          SpecCtx.USE_SPEC_ITEM, SpecCtxType.SCEN, str, userLoc);
        if (blocked) takeCharge = false;
        break;
      }

      case ItemAbil.CAST_SPELL: {
        if (univ.town?.hasField(userLoc.x, userLoc.y, FieldType.FIELD_ANTIMAGIC)) {
          say('  Not in antimagic field.');
          takeCharge = false;
          break;
        }
        const spell = item.abilData as Spell;
        say(SPELL_FLAVOUR[spell] ?? `  It casts a spell: ${spellName(spell)}`);

        // A spell that names a PC asks now, before it is cast — this is the
        // `store_spell_target` the town spell arms read back.
        const select = SPELLS[spell]?.select ?? SpellSelect.NO;
        if (select !== SpellSelect.NO && host) {
          session.spellTarget = await host.selectPc(SELECT_PROMPTS[select]);
        }

        // `true` is the C++'s `freebie`: an item never charges spell points,
        // and the spell's level comes from the item's strength instead of the
        // caster's own level.
        const priest = isPriestSpell(spell);
        if (session.mode === GameMode.COMBAT) {
          switch (SPELLS[spell]?.refer ?? SpellRefer.YES) {
            case SpellRefer.YES:
              if (priest) doPriestSpell(session, univ.curPc, spell, true, itemSpellLevel);
              else doMageSpell(session, univ.curPc, spell, true, itemSpellLevel);
              break;
            case SpellRefer.TARGET:
              startSpellTargeting(session, spell, true, itemSpellLevel);
              break;
            case SpellRefer.FANCY:
              startFancySpellTargeting(session, spell, true, itemSpellLevel);
              break;
            case SpellRefer.IMMED:
              if (priest) await combatImmedPriestCast(session, univ.curPc, spell, true, itemSpellLevel);
              else await combatImmedMageCast(session, univ.curPc, spell, true, itemSpellLevel);
              break;
          }
        } else if (priest) doPriestSpell(session, univ.curPc, spell, true, itemSpellLevel);
        else doMageSpell(session, univ.curPc, spell, true, itemSpellLevel);
        break;
      }

      case ItemAbil.SUMMONING:
        if (!summonMonster(session, item.abilData, userLoc, str, Attitude.FRIENDLY, true))
          say('  Summon failed.');
        break;

      case ItemAbil.MASS_SUMMONING: {
        // The first roll's result is thrown away — the C++ has its own "why is
        // this here?" comment — but it moves the RNG, so it is kept.
        univ.rng.getRan(str, 1, 4);
        const count = univ.rng.getRan(1, 3, 5);
        // Note the duration passed is `count`, not the item's strength.
        for (let i = 0; i < count; i++)
          if (!summonMonster(session, item.abilData, userLoc, count, Attitude.FRIENDLY, true))
            say('  Summon failed.');
        break;
      }

      case ItemAbil.QUICKFIRE:
        say('Fire pours out!');
        univ.town?.setField(userLoc.x, userLoc.y, FieldType.FIELD_QUICKFIRE, true);
        break;

      case ItemAbil.MESSAGE: {
        // Reading a book never costs a charge, which is why the count is
        // suppressed in the inventory list too.
        takeCharge = false;
        const [str1, str2] = bookText(item);
        await host?.message(str1, str2, `Reading ${item.name}`, item.graphicNum, PIC_ITEM);
        break;
      }

      default:
        // Every remaining ability is passive — worn, not used. The C++ lists
        // all sixty of them explicitly so the compiler catches a new one; here
        // `abil_chart` has already refused them in `can_use` above.
        break;
    }
  }

  if (takeCharge && item.charges > 0) removeCharge(pc, slot);
}

/** PIC_ITEM — the picture-type constant a book's dialog uses. */
const PIC_ITEM = 4;

/**
 * A book's text lives in its description after a `|||` marker, with a second
 * `|||` splitting it into two paragraphs (boe.specials.cpp:1168).
 */
export function bookText(item: Item): [string, string] {
  const first = item.desc.indexOf('|||');
  let str1 = first < 0 ? item.desc : item.desc.slice(first + 3);
  let str2 = '';
  const second = str1.indexOf('|||');
  if (second >= 0) {
    str2 = str1.slice(second + 3);
    str1 = str1.slice(0, second);
  }
  return [str1, str2];
}

/** Which list a spell number belongs to; the priest list starts at 100. */
function isPriestSpell(spell: Spell): boolean {
  const info = SPELLS[spell];
  if (info?.type === Skill.PRIEST_SPELLS) return true;
  return info?.type === undefined && spell >= 100;
}
