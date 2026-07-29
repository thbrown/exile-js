/**
 * `cItem::getAbilName` (item.cpp:978) — the one-line description of an item's
 * ability that the item-info dialog and the scenario editor both print.
 *
 * Most abilities have a fixed name; a dozen build theirs from `abil_data`,
 * which is a union read as a damage type, a race, a status, a party status, a
 * skill or a spell depending on the ability. `harmful` and `group` come from
 * the item's `magic_use_type`, so the same ability reads "Cure Poison" or
 * "Cause Poison" depending on which way it points.
 */

import { DamageType } from './monster';
import { PartyStatus, Race, Status } from '../universe/skills';
import { Item, ItemAbil, abilGroup, abilHarms } from './item';
import { getStr } from './strings';
import { SPELLS, Spell, spellName } from './spell';

/** The fixed-name abilities, straight down the C++'s switch. */
const SIMPLE: Partial<Record<ItemAbil, string>> = {
  [ItemAbil.NONE]: 'No ability',
  [ItemAbil.HEALING_WEAPON]: 'Heals target',
  [ItemAbil.RETURNING_MISSILE]: 'Returning missile',
  [ItemAbil.DISTANCE_MISSILE]: 'Farflight missile',
  [ItemAbil.SEEKING_MISSILE]: 'Seeking missile',
  [ItemAbil.ANTIMAGIC_WEAPON]: 'Manasucker',
  [ItemAbil.SOULSUCKER]: 'Soulsucker',
  [ItemAbil.DRAIN_MISSILES]: 'Drain Missiles',
  [ItemAbil.WEAK_WEAPON]: 'Weak Weapon',
  [ItemAbil.HP_DAMAGE]: 'Damage Linked to Health',
  [ItemAbil.HP_DAMAGE_REVERSE]: "Berserker's Weapon",
  [ItemAbil.SP_DAMAGE]: 'Damage Linked to Spell Points',
  [ItemAbil.SP_DAMAGE_REVERSE]: "Wildmage's Weapon",
  [ItemAbil.CAUSES_FEAR]: 'Causes Fear',
  [ItemAbil.WEAPON_CALL_SPECIAL]: 'Unusual Attack Effect',
  [ItemAbil.FULL_PROTECTION]: 'Full Protection',
  [ItemAbil.EVASION]: 'Evasion',
  [ItemAbil.MARTYRS_SHIELD]: "Martyr's Shield",
  [ItemAbil.ENCUMBERING]: 'Awkward Weapon',
  [ItemAbil.SKILL]: 'Skill',
  [ItemAbil.BOOST_WAR]: "Warrior's Mantle",
  [ItemAbil.BOOST_MAGIC]: "Mage's Mantle",
  [ItemAbil.ACCURACY]: 'Accuracy',
  [ItemAbil.THIEVING]: 'Thieving',
  [ItemAbil.MAGERY]: 'Magery',
  [ItemAbil.GIANT_STRENGTH]: 'Giant Strength',
  [ItemAbil.LIGHTER_OBJECT]: 'Lighter Object',
  [ItemAbil.HEAVIER_OBJECT]: 'Heavier Object',
  [ItemAbil.HIT_CALL_SPECIAL]: 'Unusual Defense Effect',
  [ItemAbil.DROP_CALL_SPECIAL]: 'Unusual Effect When Dropped',
  [ItemAbil.LIFE_SAVING]: 'Life Saving',
  [ItemAbil.PROTECT_FROM_PETRIFY]: 'Protect from Petrify',
  [ItemAbil.REGENERATE]: 'Regenerate',
  [ItemAbil.POISON_AUGMENT]: 'Poison Augment',
  [ItemAbil.RADIANT]: 'Radiance',
  [ItemAbil.WILL]: 'Will',
  [ItemAbil.FREE_ACTION]: 'Free Action',
  [ItemAbil.SPEED]: 'Speed',
  [ItemAbil.SLOW_WEARER]: 'Slow Wearer',
  [ItemAbil.LOCKPICKS]: 'Lockpicks',
  [ItemAbil.POISON_WEAPON]: 'Poison Weapon',
  [ItemAbil.CALL_SPECIAL]: 'Unusual Ability',
  [ItemAbil.QUICKFIRE]: 'Quickfire',
  [ItemAbil.HOLLY]: 'Holly/Toadstool',
  [ItemAbil.COMFREY]: 'Comfrey Root',
  [ItemAbil.NETTLE]: 'Glowing Nettle',
  [ItemAbil.WORMGRASS]: 'Crypt Shroom/Wormgrass',
  [ItemAbil.ASPTONGUE]: 'Asptongue Mold',
  [ItemAbil.EMBERF]: 'Ember Flower',
  [ItemAbil.GRAYMOLD]: 'Graymold',
  [ItemAbil.MANDRAKE]: 'Mandrake Root',
  [ItemAbil.SAPPHIRE]: 'Sapphire',
  [ItemAbil.SMOKY_CRYSTAL]: 'Smoky Crystal',
  [ItemAbil.RESURRECTION_BALM]: 'Resurrection Balm',
  [ItemAbil.MESSAGE]: 'Readable',
};

/** DAMAGING_WEAPON's adjective. SPECIAL and UNBLOCKABLE share "Dark". */
const DAMAGE_ADJECTIVE: Partial<Record<DamageType, string>> = {
  [DamageType.FIRE]: 'Flaming',
  [DamageType.MAGIC]: 'Shocking',
  [DamageType.COLD]: 'Frosty',
  [DamageType.POISON]: 'Slimy',
  [DamageType.WEAPON]: 'Enhanced',
  [DamageType.UNDEAD]: 'Necrotic',
  [DamageType.DEMON]: 'Unholy',
  [DamageType.ACID]: 'Acid',
  [DamageType.SPECIAL]: 'Dark',
  [DamageType.UNBLOCKABLE]: 'Dark',
};

/** SLAYER_WEAPON's race word. */
const SLAYER_RACE: Partial<Record<Race, string>> = {
  [Race.DEMON]: 'Demon', [Race.UNDEAD]: 'Undead', [Race.REPTILE]: 'Lizard',
  [Race.GIANT]: 'Giant', [Race.MAGE]: 'Mage', [Race.PRIEST]: 'Priest',
  [Race.BUG]: 'Bug', [Race.HUMAN]: 'Human', [Race.NEPHIL]: 'Nephil',
  [Race.SLITH]: 'Slith', [Race.VAHNATAI]: 'Vahnatai', [Race.HUMANOID]: 'Humanoid',
  [Race.BEAST]: 'Beast', [Race.IMPORTANT]: 'VIP', [Race.SLIME]: 'Slime',
  [Race.STONE]: 'Golem', [Race.DRAGON]: 'Dragon', [Race.MAGICAL]: 'Magical Beast',
  [Race.PLANT]: 'Plant', [Race.BIRD]: 'Bird', [Race.SKELETAL]: 'Skeleton',
  [Race.GOBLIN]: 'Goblin',
};

/** PROTECT_FROM_SPECIES's race word — plural, and not the slayer list. */
const PROTECT_RACE: Partial<Record<Race, string>> = {
  [Race.UNDEAD]: 'Undead', [Race.DEMON]: 'Demons', [Race.HUMANOID]: 'Humanoids',
  [Race.REPTILE]: 'Reptiles', [Race.GIANT]: 'Giants', [Race.HUMAN]: 'Humans',
  [Race.NEPHIL]: 'Nephilim', [Race.SLITH]: 'Sliths', [Race.VAHNATAI]: 'Vahnatai',
  [Race.BEAST]: 'Beasts', [Race.IMPORTANT]: 'VIPs', [Race.MAGE]: 'Mages',
  [Race.PRIEST]: 'Priests', [Race.SLIME]: 'Slimes', [Race.STONE]: 'Golems',
  [Race.BUG]: 'Bugs', [Race.DRAGON]: 'Dragons', [Race.MAGICAL]: 'Magical Beasts',
  [Race.PLANT]: 'Plants', [Race.BIRD]: 'Birds', [Race.SKELETAL]: 'Skeleton',
  [Race.GOBLIN]: 'Goblin',
};

/** EXPLODING_WEAPON. UNDEAD is the one that replaces the whole string. */
const EXPLODE: Partial<Record<DamageType, string>> = {
  [DamageType.FIRE]: 'Explodes in flames',
  [DamageType.COLD]: 'Explodes into frost',
  [DamageType.MAGIC]: 'Explodes in sparks',
  [DamageType.POISON]: 'Explodes into slime',
  [DamageType.WEAPON]: 'Explodes in shrapnel',
  [DamageType.ACID]: 'Explodes with acid',
  [DamageType.SPECIAL]: 'Explodes in darkness',
  [DamageType.UNBLOCKABLE]: 'Explodes in darkness',
  // `sout.str("Implodes")` throws away the "Explodes " already written.
  [DamageType.DEMON]: 'Explodes into corruption',
  [DamageType.UNDEAD]: 'Implodes',
};

/** STATUS_WEAPON's adjective. */
const STATUS_WEAPON: Partial<Record<Status, string>> = {
  [Status.POISONED_WEAPON]: 'Poison-draining',
  [Status.INVULNERABLE]: 'Piercing',
  [Status.MAGIC_RESISTANCE]: 'Overwhelming',
  [Status.INVISIBLE]: 'Anti-sanctuary',
  [Status.ACID]: 'Acidic',
  [Status.POISON]: 'Poisoned',
  [Status.BLESS_CURSE]: 'Cursing',
  [Status.HASTE_SLOW]: 'Slowing',
  [Status.WEBS]: 'Webbing',
  [Status.DISEASE]: 'Infectious',
  [Status.DUMB]: 'Dumbfounding',
  [Status.MARTYRS_SHIELD]: 'Martyr Draining',
  [Status.ASLEEP]: 'Soporific',
  [Status.PARALYZED]: 'Paralytic',
  [Status.FORCECAGE]: 'Entrapping',
  [Status.CHARM]: 'Charming',
};

/** DAMAGE_PROTECTION. WEAPON deliberately contributes nothing. */
const DAMAGE_PROTECTION: Partial<Record<DamageType, string>> = {
  [DamageType.FIRE]: 'Fire', [DamageType.COLD]: 'Cold', [DamageType.MAGIC]: 'Magic',
  [DamageType.DEMON]: 'Demon', [DamageType.UNDEAD]: 'Undead', [DamageType.POISON]: 'Poison',
  [DamageType.ACID]: 'Acid', [DamageType.SPECIAL]: 'Darkness',
  [DamageType.UNBLOCKABLE]: 'Darkness',
};

/**
 * STATUS_PROTECTION. The five omitted statuses "have no negative aspect, so
 * protection from them isn't implemented" — they print "Protect From " alone.
 */
const STATUS_PROTECTION: Partial<Record<Status, string>> = {
  [Status.POISON]: 'Poison', [Status.ACID]: 'Acid', [Status.DISEASE]: 'Disease',
  [Status.BLESS_CURSE]: 'Curses', [Status.HASTE_SLOW]: 'Slowing',
  [Status.MAGIC_RESISTANCE]: 'Magic Vulnerability', [Status.WEBS]: 'Webbing',
  [Status.DUMB]: 'Dumbfounding', [Status.ASLEEP]: 'Sleep',
  [Status.PARALYZED]: 'Paralysis', [Status.FORCECAGE]: 'Forcecage',
};

const PARTY_STATUS: Partial<Record<PartyStatus, string>> = {
  [PartyStatus.STEALTH]: 'Stealth',
  [PartyStatus.FLIGHT]: 'Flight',
  [PartyStatus.DETECT_LIFE]: 'Life Detection',
  [PartyStatus.FIREWALK]: 'Firewalk',
};

/** OCCASIONAL_STATUS: the harmful word, then the helpful one. */
function occasional(status: Status, harmful: boolean): string {
  switch (status) {
    case Status.CHARM:
    case Status.FORCECAGE: return harmful ? 'Entrapment' : 'Release';
    case Status.DISEASE: return harmful ? 'Disease' : 'Cure Disease';
    case Status.HASTE_SLOW: return harmful ? 'Slow' : 'Haste';
    case Status.BLESS_CURSE: return harmful ? 'Curse' : 'Bless';
    case Status.POISON: return harmful ? 'Poison' : 'Cure';
    case Status.WEBS: return harmful ? 'Webbing' : 'Cleansing';
    case Status.DUMB: return harmful ? 'Dumbfounding' : 'Enlightening';
    case Status.MARTYRS_SHIELD: return `${harmful ? 'Lose' : 'Gain'} Martyr's Shield`;
    case Status.INVULNERABLE: return `${harmful ? 'Lose' : 'Gain'} Invulnerability`;
    case Status.MAGIC_RESISTANCE: return `Magic ${harmful ? 'Vulnerability' : 'Resistance'}`;
    case Status.INVISIBLE: return `${harmful ? 'Lose' : 'Gain'} Sanctuary`;
    case Status.POISONED_WEAPON: return `${harmful ? 'Lose' : 'Gain'} Weapon Poison`;
    case Status.ASLEEP: return harmful ? 'Sleep' : 'Hyperactivity';
    // Note the sense flips here: harmful *gains* paralysis.
    case Status.PARALYZED: return `${harmful ? 'Gain' : 'Lose'} Paralysis`;
    case Status.ACID: return `${harmful ? 'Gain' : 'Neutralize'} Acid`;
    default: return '';
  }
}

/** AFFECT_STATUS: the same idea with a different vocabulary. */
function affectStatus(status: Status, harmful: boolean): string {
  switch (status) {
    case Status.FORCECAGE: return harmful ? 'Entrapping' : 'Cage Break';
    case Status.CHARM: return ''; // "TODO: Not implemented"
    case Status.POISONED_WEAPON: return `${harmful ? 'Increase' : 'Decrease'} Weapon Poison`;
    case Status.BLESS_CURSE: return harmful ? 'Curse' : 'Bless';
    case Status.POISON: return `${harmful ? 'Cause' : 'Cure'} Poison`;
    case Status.HASTE_SLOW: return harmful ? 'Slow' : 'Haste';
    case Status.INVULNERABLE: return `${harmful ? 'Lose' : 'Add'} Invulnerability`;
    case Status.MAGIC_RESISTANCE: return `${harmful ? 'Lose' : 'Add'} Magic Resistance`;
    // No space before "Webs" — the C++ writes `<< "Webs"` without one. Kept.
    case Status.WEBS: return `${harmful ? 'Lose' : 'Add'}Webs`;
    case Status.DISEASE: return `${harmful ? 'Cause' : 'Cure'} Disease`;
    case Status.INVISIBLE: return `${harmful ? 'Lose' : 'Add'} Sanctuary`;
    // And the sense flips here too: harmful *adds* dumbfounding.
    case Status.DUMB: return `${harmful ? 'Add' : 'Lose'} Dumbfounding`;
    case Status.MARTYRS_SHIELD: return `${harmful ? 'Lose' : 'Add'} Martyr's Shield`;
    case Status.ASLEEP: return `${harmful ? 'Cause' : 'Cure'} Sleep`;
    case Status.PARALYZED: return `${harmful ? 'Cause' : 'Cure'} Paralysis`;
    case Status.ACID: return `${harmful ? 'Cause' : 'Cure'} Acid`;
    default: return '';
  }
}

export function getAbilName(item: Item): string {
  const harmful = abilHarms(item);
  const party = abilGroup(item);
  const data = item.abilData;

  const simple = SIMPLE[item.ability];
  if (simple !== undefined) return simple;

  switch (item.ability) {
    case ItemAbil.DAMAGING_WEAPON:
      return `${DAMAGE_ADJECTIVE[data as DamageType] ?? ''} Weapon`;
    case ItemAbil.SLAYER_WEAPON:
      return `${SLAYER_RACE[data as Race] ?? ''} Slayer`;
    case ItemAbil.EXPLODING_WEAPON:
      return EXPLODE[data as DamageType] ?? 'Explodes ';
    case ItemAbil.STATUS_WEAPON:
      return `${STATUS_WEAPON[data as Status] ?? ''} Weapon`;
    case ItemAbil.DAMAGE_PROTECTION:
      return `${DAMAGE_PROTECTION[data as DamageType] ?? ''} Protection`;
    case ItemAbil.STATUS_PROTECTION:
      return `Protect From ${STATUS_PROTECTION[data as Status] ?? ''}`;
    case ItemAbil.BOOST_STAT:
      return getStr('skills', data * 2 + 1);
    case ItemAbil.OCCASIONAL_STATUS:
      return `Occasional ${occasional(data as Status, harmful)}${party ? ' Party' : ' Wearer'}`;
    case ItemAbil.PROTECT_FROM_SPECIES:
      return `Protection from ${PROTECT_RACE[data as Race] ?? ''}`;
    case ItemAbil.AFFECT_STATUS:
      return affectStatus(data as Status, harmful);
    case ItemAbil.CAST_SPELL:
      return `Spell: ${SPELLS[data as Spell] ? spellName(data as Spell) : ''}`;
    case ItemAbil.BLISS_DOOM:
      return `${party ? 'Party ' : ''}${harmful ? 'Doom' : 'Bliss'}`;
    case ItemAbil.AFFECT_EXPERIENCE:
      return `${harmful ? 'Drain' : 'Gain'} Experience`;
    case ItemAbil.AFFECT_SKILL_POINTS:
      return `${harmful ? 'Drain' : 'Gain'} Skill Points`;
    case ItemAbil.AFFECT_HEALTH:
      return harmful ? 'Drain Health' : 'Heal';
    case ItemAbil.AFFECT_SPELL_POINTS:
      return `${harmful ? 'Drain' : 'Restore'} Spell Points`;
    case ItemAbil.LIGHT:
      return `${harmful ? 'Drain' : 'Increase'} Light`;
    case ItemAbil.AFFECT_PARTY_STATUS:
      return `${harmful ? 'Lose ' : 'Gain '}${PARTY_STATUS[data as PartyStatus] ?? ''}`;
    case ItemAbil.HEALTH_POISON:
      return `Major ${harmful ? 'Poison' : 'Healing'}${party ? ' All' : ''}`;
    // The %s is filled in by the caller, which has the scenario's monster list.
    case ItemAbil.SUMMONING:
      return 'Summons %s';
    case ItemAbil.MASS_SUMMONING:
      return 'Mass summon %s';
    default:
      return '';
  }
}

/** The skill a weapon rolls against, named — `get_str("skills", n*2+1)`. */
export function weaponSkillName(weapType: number): string {
  return getStr('skills', weapType * 2 + 1);
}
