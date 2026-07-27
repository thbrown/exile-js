/**
 * Who may cast what — `pc_can_cast_spell` in both its forms
 * (boe.party.cpp:1598 and :1651).
 *
 * The two overloads answer different questions. The `Skill` one asks "can this
 * PC cast *anything* of this kind right now", and is what greys out the caster
 * buttons; it returns a reason, because the UI prints it. The `Spell` one asks
 * about one particular spell and answers yes or no.
 */

import { FieldType } from '../data/fields';
import {
  NUM_NORMAL_SPELLS, Spell, SpellSelect, SpellWhen, SPELLS, isMage, isPriest,
} from '../data/spell';
import { Player } from '../universe/player';
import { MainStatus, Skill, Status, Trait } from '../universe/skills';
import { Universe } from '../universe/universe';
import { totalEncumbrance } from './combat';
import { GameMode, isCombat } from './modes';
import type { GameSession } from './session';

/** eCastStatus (boe.party.hpp:30) — why a PC can't cast, for the UI to print. */
export enum CastStatus {
  OK = 0,
  /** Immutable reasons: not worth printing once per PC. */
  NO_SKILL = 1,
  NO_ANAMA = 2,
  /** Worth printing once, however many PCs were checked. */
  NO_ANTIMAGIC = 3,
  /** Worth printing per PC. */
  NO_SP = 4,
  NO_ENCUMBERED = 5,
  NO_DUMBFOUNDED = 6,
  NO_PARALYZED = 7,
  NO_ASLEEP = 8,
  /**
   * The C++ notes that any reachable path here deserves its own value. Kept as
   * the same catch-all.
   */
  NO_UNKNOWN = 9,
}

/** `dead_statuses` (damage.hpp:102) — what Raise Dead and friends look for. */
const DEAD_STATUSES = [MainStatus.DEAD, MainStatus.STONE, MainStatus.DUST];

/**
 * `pc_can_cast_spell(pc, spell)` (:1651) — may this PC cast this one spell?
 *
 * Note `effective_skill`: a *negative* DUMB status is enlightenment, and it
 * raises the skill rather than lowering it, since subtracting a negative adds.
 */
export function pcCanCastSpell(
  session: GameSession, pc: Player, spellNum: Spell,
): boolean {
  if (spellNum === Spell.NONE) return false;
  const spell = SPELLS[spellNum];
  if (!spell) return false;
  const { univ } = session;

  // A spell that raises the dead needs someone dead to raise, and one that
  // unstones needs someone stoned; without a subject it isn't castable at all.
  if (spell.select === SpellSelect.DEAD) {
    if (!univ.party.pcs.some((p) => DEAD_STATUSES.includes(p.mainStatus))) return false;
  } else if (spell.select === SpellSelect.STONE) {
    if (!univ.party.pcs.some((p) => p.mainStatus === MainStatus.STONE)) return false;
  }

  const type = spell.type;
  const level = spell.level ?? 0;
  let effectiveSkill = type === undefined ? 0 : pc.skill(type);
  const dumb = pc.status[Status.DUMB] ?? 0;
  if (dumb < 0) effectiveSkill -= dumb;

  // Mid-conversation or mid-shop nothing can be cast. The C++ takes this from
  // the Windows version and notes the function shouldn't be reached there.
  if (session.mode >= GameMode.TALKING) return false;
  // The special (scenario-granted) spells are cast by their own machinery, not
  // by a PC choosing them from the list.
  if (!isMage(spellNum) && !isPriest(spellNum)) return false;
  if (pc.traits[Trait.PACIFIST] && !spell.peaceful) return false;
  if (effectiveSkill < level) return false;
  if (pc.mainStatus !== MainStatus.ALIVE) return false;
  if (pc.curSp < (spell.cost ?? 0)) return false;
  if (type === Skill.MAGE_SPELLS && !pc.mageSpells[spellNum]) return false;
  if (type === Skill.PRIEST_SPELLS && !pc.priestSpells[spellNum - 100]) return false;
  // Dumbfounding takes the high-level spells away first: at DUMB 7 only a
  // level-1 spell is left, and at 8 nothing is.
  if (dumb >= 8 - level) return false;
  if ((pc.status[Status.PARALYZED] ?? 0) !== 0) return false;
  if ((pc.status[Status.ASLEEP] ?? 0) > 0) return false;

  const when = spell.when ?? 0;
  if (session.isOutdoors && !(when & SpellWhen.OUTDOORS)) return false;
  if (session.mode === GameMode.TOWN && !(when & SpellWhen.TOWN)) return false;
  if (isCombat(session.mode) && !(when & SpellWhen.COMBAT)) return false;
  return true;
}

/**
 * `pc_can_cast_spell(pc, type)` (:1598) — can this PC cast anything of this
 * kind, and if not, why not?
 *
 * The shape is worth reading twice. Rather than reason about it, the C++ finds
 * a spell the PC definitely knows and asks about *that*; only if the answer is
 * no does it go looking for a reason to report. Note the mage branch checks the
 * first known spell and gives up (`break`), while the priest branch keeps
 * trying every one — an asymmetry that is kept here.
 *
 * Careful: this consumes RNG, because encumbrance is rolled rather than
 * computed (`total_encumbrance` rolls per item). The C++ does the same, so the
 * `get_ran` call order matches, but it means asking "can they cast?" is not a
 * free question.
 */
export function pcCanCastType(
  session: GameSession, pc: Player, type: Skill,
): CastStatus {
  const { univ } = session;
  if (type === Skill.MAGE_SPELLS && pc.traits[Trait.ANAMA]) return CastStatus.NO_ANAMA;
  if (pc.skill(type) === 0) return CastStatus.NO_SKILL;
  if (pc.curSp === 0) return CastStatus.NO_SP;

  if (isCombat(session.mode)
    && univ.town?.hasField(pc.combatPos.x, pc.combatPos.y, FieldType.FIELD_ANTIMAGIC)) {
    return CastStatus.NO_ANTIMAGIC;
  }
  // Armour stops a mage gesturing, but never troubles a priest.
  if (isCombat(session.mode) && type === Skill.MAGE_SPELLS
    && totalEncumbrance(univ, pc) > 1) {
    return CastStatus.NO_ENCUMBERED;
  }

  // The two level-1 spells everybody starts with are the cheap test.
  if (type === Skill.MAGE_SPELLS && pcCanCastSpell(session, pc, Spell.LIGHT)) {
    return CastStatus.OK;
  }
  if (type === Skill.PRIEST_SPELLS && pcCanCastSpell(session, pc, Spell.HEAL_MINOR)) {
    return CastStatus.OK;
  }

  if (type === Skill.MAGE_SPELLS && pc.mageSpells.some(Boolean)) {
    for (let i = 0; i < NUM_NORMAL_SPELLS; i++) {
      if (!pc.mageSpells[i]) continue;
      if (pcCanCastSpell(session, pc, i as Spell)) return CastStatus.OK;
      // The C++ gives up after the first spell it finds here, unlike the
      // priest branch below. Kept.
      break;
    }
  }
  if (type === Skill.PRIEST_SPELLS && pc.priestSpells.some(Boolean)) {
    for (let i = 0; i < NUM_NORMAL_SPELLS; i++) {
      if (!pc.priestSpells[i]) continue;
      if (pcCanCastSpell(session, pc, (i + 100) as Spell)) return CastStatus.OK;
    }
  }

  if ((pc.status[Status.DUMB] ?? 0) > 0) return CastStatus.NO_DUMBFOUNDED;
  if ((pc.status[Status.PARALYZED] ?? 0) !== 0) return CastStatus.NO_PARALYZED;
  if ((pc.status[Status.ASLEEP] ?? 0) > 0) return CastStatus.NO_ASLEEP;
  return CastStatus.NO_UNKNOWN;
}

/** Every spell of `type` this PC could cast right now, in list order. */
export function castableSpells(
  session: GameSession, pc: Player, type: Skill,
): Spell[] {
  const base = type === Skill.PRIEST_SPELLS ? 100 : 0;
  const out: Spell[] = [];
  for (let i = 0; i < NUM_NORMAL_SPELLS; i++) {
    const spell = (base + i) as Spell;
    if (pcCanCastSpell(session, pc, spell)) out.push(spell);
  }
  return out;
}
