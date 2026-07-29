/**
 * `uAbility::to_string` (monster.cpp:483) — the one-line description of a
 * monster ability that the monster-info dialog prints.
 *
 * The shape is the union's: `getMonstAbilCategory` picks the arm, and the
 * general arm then builds its phrase in three parts — an adjective from the
 * ability's `extra` field, a delivery word from `gen.type` ("ray", "touch",
 * "gaze", "breath", "spit"), and a strength suffix that depends on the key.
 */

import { FieldType } from './fields';
import { DamageType } from './monster';
import {
  Ability, MonstAbil, MonstAbilCat, MonstGen, MonstMissile, MonstSummon, abilityCategory,
} from './monsterAbility';
import { SpellPat } from './pattern';
import { Race, Status } from '../universe/skills';

const MISSILE_VERB: Record<MonstMissile, string> = {
  [MonstMissile.DART]: 'Throws darts',
  [MonstMissile.ARROW]: 'Shoots arrows',
  [MonstMissile.RAPID_ARROW]: 'Good archer',
  [MonstMissile.BOLT]: 'Shoots bolts',
  [MonstMissile.SPEAR]: 'Throws spears',
  [MonstMissile.ROCK]: 'Throws stones',
  [MonstMissile.BOULDER]: 'Throws rocks',
  [MonstMissile.RAZORDISK]: 'Throws razordisks',
  [MonstMissile.SPINE]: 'Shoots spines',
  [MonstMissile.KNIFE]: 'Throws knives',
};

/** The fixed-word general abilities. */
const GENERAL_WORD: Partial<Record<MonstAbil, string>> = {
  [MonstAbil.STUN]: 'Stunning',
  [MonstAbil.PETRIFY]: 'Petrifying',
  [MonstAbil.DRAIN_SP]: 'Spell point drain',
  [MonstAbil.DRAIN_XP]: 'Draining',
  [MonstAbil.KILL]: 'Death',
  [MonstAbil.STEAL_FOOD]: 'Steals food',
  [MonstAbil.STEAL_GOLD]: 'Steals gold',
};

/** FIELD's adjective, by the field it lays. */
const FIELD_WORD: Partial<Record<FieldType, string>> = {
  [FieldType.CLOUD_SLEEP]: 'Sleep',
  [FieldType.CLOUD_STINK]: 'Foul',
  [FieldType.WALL_FIRE]: 'Fiery',
  [FieldType.WALL_FORCE]: 'Charged',
  [FieldType.WALL_ICE]: 'Frosted',
  [FieldType.WALL_BLADES]: 'Thorny',
  [FieldType.FIELD_ANTIMAGIC]: 'Null',
  [FieldType.FIELD_WEB]: 'Web',
  [FieldType.FIELD_QUICKFIRE]: 'Incendiary',
  [FieldType.BARRIER_CAGE]: 'Entrapping',
  [FieldType.BARRIER_FIRE]: 'Barrier',
  [FieldType.BARRIER_FORCE]: 'Barrier',
  [FieldType.FIELD_DISPEL]: 'Dispelling',
  [FieldType.FIELD_SMASH]: 'Smashing',
  [FieldType.OBJECT_BARREL]: 'Barrel',
  [FieldType.OBJECT_BLOCK]: 'Stone Block',
  [FieldType.OBJECT_CRATE]: 'Crate',
  [FieldType.SFX_ASH]: 'Littering',
  [FieldType.SFX_BONES]: 'Littering',
  [FieldType.SFX_RUBBLE]: 'Littering',
  [FieldType.SFX_SMALL_BLOOD]: 'Littering',
  [FieldType.SFX_MEDIUM_BLOOD]: 'Littering',
  [FieldType.SFX_LARGE_BLOOD]: 'Littering',
  [FieldType.SFX_SMALL_SLIME]: 'Littering',
  [FieldType.SFX_LARGE_SLIME]: 'Littering',
};

/** DAMAGE / DAMAGE2's adjective. */
const DAMAGE_WORD: Partial<Record<DamageType, string>> = {
  [DamageType.FIRE]: 'Fiery',
  [DamageType.COLD]: 'Icy',
  [DamageType.MAGIC]: 'Shock',
  [DamageType.ACID]: 'Acid',
  [DamageType.SPECIAL]: 'Wounding',
  [DamageType.UNBLOCKABLE]: 'Wounding',
  [DamageType.POISON]: 'Pain',
  [DamageType.WEAPON]: 'Stamina drain',
  [DamageType.DEMON]: 'Unholy',
  [DamageType.UNDEAD]: 'Necrotic',
};

/** STATUS / STATUS2's adjective — not the same vocabulary as an item's. */
const STATUS_WORD: Partial<Record<Status, string>> = {
  [Status.POISON]: 'Poison',
  [Status.DISEASE]: 'Infectious',
  [Status.DUMB]: 'Dumbfounding',
  [Status.WEBS]: 'Glue',
  [Status.ASLEEP]: 'Sleep',
  [Status.PARALYZED]: 'Paralysis',
  [Status.ACID]: 'Acid',
  [Status.HASTE_SLOW]: 'Slowing',
  [Status.BLESS_CURSE]: 'Curse',
  [Status.CHARM]: 'Charming',
  [Status.FORCECAGE]: 'Entrapping',
  [Status.INVISIBLE]: 'Revealing',
  [Status.INVULNERABLE]: 'Piercing',
  [Status.MAGIC_RESISTANCE]: 'Overwhelming',
  [Status.MARTYRS_SHIELD]: "Anti-martyr's",
  [Status.POISONED_WEAPON]: 'Poison-draining',
};

const DELIVERY: Record<MonstGen, string> = {
  [MonstGen.RAY]: ' ray',
  [MonstGen.TOUCH]: ' touch',
  [MonstGen.GAZE]: ' gaze',
  [MonstGen.BREATH]: ' breath',
  [MonstGen.SPIT]: ' spit',
};

/** The die a status/stun ability rolls, by how it is delivered. */
const DELIVERY_DIE: Record<MonstGen, string> = {
  [MonstGen.RAY]: 'd6',
  [MonstGen.TOUCH]: 'd10',
  [MonstGen.GAZE]: 'd6',
  [MonstGen.BREATH]: 'd8',
  [MonstGen.SPIT]: 'd10',
};

const PATTERN_WORD: Partial<Record<SpellPat, string>> = {
  [SpellPat.SMALL_SQUARE]: 'small square',
  [SpellPat.SQUARE]: 'square',
  [SpellPat.OPEN_SQUARE]: 'open square',
  [SpellPat.PLUS]: 'plus',
  [SpellPat.RADIUS_2]: 'small circle',
  [SpellPat.RADIUS_3]: 'big circle',
  [SpellPat.WALL]: 'line',
  [SpellPat.PROT]: 'protective circle',
  [SpellPat.CUSTOM]: 'unusual shape',
};

const SPECIAL_WORD: Partial<Record<MonstAbil, string>> = {
  [MonstAbil.MARTYRS_SHIELD]: "Permanent martyr's shield",
  [MonstAbil.ABSORB_SPELLS]: 'Absorbs spells',
  [MonstAbil.MISSILE_WEB]: 'Throws webs',
  [MonstAbil.SPECIAL]: 'Unusual ability (active)',
  [MonstAbil.DEATH_TRIGGER]: 'Unusual ability (death)',
  [MonstAbil.HIT_TRIGGER]: 'Unusual ability (passive)',
};

/** SUMMON's SPECIES arm — plural race names, and its own vocabulary again. */
const SUMMON_RACE: Partial<Record<Race, string>> = {
  [Race.BEAST]: 'beasts', [Race.BIRD]: 'birds', [Race.BUG]: 'bugs',
  [Race.DEMON]: 'demons', [Race.DRAGON]: 'dragons', [Race.GIANT]: 'giants',
  [Race.GOBLIN]: 'goblins', [Race.HUMAN]: 'humans', [Race.HUMANOID]: 'humanoids',
  [Race.IMPORTANT]: 'VIPs', [Race.MAGE]: 'mages', [Race.MAGICAL]: 'magical beings',
  [Race.NEPHIL]: 'nephilim', [Race.PLANT]: 'plants', [Race.PRIEST]: 'priests',
  [Race.REPTILE]: 'reptiles', [Race.SKELETAL]: 'skeletal undead',
  [Race.SLIME]: 'slimes', [Race.SLITH]: 'sliths', [Race.STONE]: 'mineral beings',
  [Race.UNDEAD]: 'undead', [Race.UNKNOWN]: 'monsters', [Race.VAHNATAI]: 'vahnatai',
};

/** SUMMON's LEVEL arm — five summoning classes. */
const SUMMON_LEVEL = [
  'cannon fodder', 'minor allies', 'allies', 'major allies', 'protectors',
];

const RADIATE_WORD: Partial<Record<FieldType, string>> = {
  [FieldType.WALL_BLADES]: 'blade fields',
  [FieldType.WALL_FIRE]: 'fire fields',
  [FieldType.WALL_FORCE]: 'shock fields',
  [FieldType.WALL_ICE]: 'ice fields',
  [FieldType.CLOUD_STINK]: 'stinking clouds',
  [FieldType.CLOUD_SLEEP]: 'sleep fields',
  [FieldType.FIELD_ANTIMAGIC]: 'antimagic fields',
  [FieldType.FIELD_WEB]: 'webs',
  [FieldType.FIELD_QUICKFIRE]: 'quickfire',
  [FieldType.BARRIER_CAGE]: 'forcecages',
  [FieldType.BARRIER_FIRE]: 'barriers',
  [FieldType.BARRIER_FORCE]: 'barriers',
  [FieldType.OBJECT_BARREL]: 'barrels',
  [FieldType.OBJECT_BLOCK]: 'stone blocks',
  [FieldType.OBJECT_CRATE]: 'crates',
  [FieldType.SFX_ASH]: 'litter',
  [FieldType.SFX_BONES]: 'litter',
  [FieldType.SFX_RUBBLE]: 'litter',
  [FieldType.SFX_SMALL_BLOOD]: 'litter',
  [FieldType.SFX_MEDIUM_BLOOD]: 'litter',
  [FieldType.SFX_LARGE_BLOOD]: 'litter',
  [FieldType.SFX_SMALL_SLIME]: 'litter',
  [FieldType.SFX_LARGE_SLIME]: 'litter',
};

/** `std::setprecision(1)` on a tenths-of-a-percent field. */
function tenths(n: number): string {
  return (n / 10).toFixed(1);
}

export function abilityName(key: MonstAbil, abil: Ability): string {
  switch (abilityCategory(key)) {
    case MonstAbilCat.MISSILE:
      return `${MISSILE_VERB[abil.missile.type] ?? ''} (${abil.missile.dice}d${abil.missile.sides})`;

    case MonstAbilCat.GENERAL: {
      let out = GENERAL_WORD[key] ?? '';
      if (key === MonstAbil.FIELD) out = FIELD_WORD[abil.gen.extra as FieldType] ?? '';
      else if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2)
        out = DAMAGE_WORD[abil.gen.extra as DamageType] ?? '';
      else if (key === MonstAbil.STATUS || key === MonstAbil.STATUS2)
        out = STATUS_WORD[abil.gen.extra as Status] ?? '';
      // The delivery word is appended whatever the key was, which is why a
      // "Steals gold touch" reads the way it does.
      out += DELIVERY[abil.gen.type] ?? '';
      if (key === MonstAbil.DAMAGE || key === MonstAbil.DAMAGE2) {
        out += ` (${abil.gen.strength})`;
      } else if (key === MonstAbil.STATUS || key === MonstAbil.STATUS2
        || key === MonstAbil.STUN) {
        out += ` (${abil.gen.strength}${DELIVERY_DIE[abil.gen.type] ?? ''})`;
      } else if (key === MonstAbil.FIELD && abil.gen.strength !== SpellPat.SINGLE) {
        out += ` (${PATTERN_WORD[abil.gen.strength as SpellPat] ?? ''})`;
      } else if (key === MonstAbil.KILL) {
        out += ` (${abil.gen.strength * 20}d10)`;
      } else if (key === MonstAbil.STEAL_FOOD || key === MonstAbil.STEAL_GOLD) {
        out += ` (${abil.gen.strength}-${abil.gen.strength * 2})`;
      }
      return out;
    }

    case MonstAbilCat.SPECIAL:
      if (key === MonstAbil.SPLITS)
        return `Splits when hit (${tenths(abil.special.extra1)}% chance)`;
      if (key === MonstAbil.RAY_HEAT) return `Heat ray (${abil.special.extra3}d6)`;
      return SPECIAL_WORD[key] ?? '';

    case MonstAbilCat.SUMMON: {
      let what: string;
      if (abil.summon.type === MonstSummon.TYPE) what = '%s';
      else if (abil.summon.type === MonstSummon.SPECIES)
        what = SUMMON_RACE[abil.summon.what as Race] ?? '';
      else what = SUMMON_LEVEL[abil.summon.what] ?? '';
      return `Summons ${abil.summon.min}-${abil.summon.max} ${what}`
        + ` (${tenths(abil.summon.chance)}% chance)`;
    }

    case MonstAbilCat.RADIATE:
      // Two field kinds replace the whole string rather than adding to it
      // (`sout.str(...)` in the C++), so they lose the "Radiates " prefix.
      if (abil.radiate.type === FieldType.FIELD_DISPEL) return 'Dispels surrounding fields';
      if (abil.radiate.type === FieldType.FIELD_SMASH) return 'Wall-smashing aura';
      return `Radiates ${RADIATE_WORD[abil.radiate.type as FieldType] ?? ''}`;

    default:
      return '';
  }
}
