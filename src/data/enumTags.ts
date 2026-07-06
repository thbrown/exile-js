/**
 * Enum ↔ string-tag tables from ../exile-wasm/src/fileio/estreams.cpp
 * (cEnumLookup): the array index IS the enum's numeric value.
 */

export const terTypes = [
  'none', 'step-change', 'dmg', 'bridge', 'bed', 'danger', '', 'fragile', 'lock', 'unlock',
  '', 'sign', 'step-spec', '', 'box', 'wild-cave', 'wild-wood', 'falls-cave', 'falls-mntn', 'belt',
  'monst-block', 'town', 'use-change', 'use-spec',
] as const;

export const terTrims = [
  'none', 'wall', 's', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw',
  'ne-inner', 'se-inner', 'sw-inner', 'nw-inner', 'frills', 'road', 'walkway', 'waterfall', 'city',
] as const;

export const terBlocks = [
  'none', 'sight', 'monsters', 'move', 'move-and-shoot', 'move-and-sight',
] as const;

export const stepSounds = ['step', 'squish', 'crunch', 'none', 'splash'] as const;

export const lightTypes = ['lit', 'dark', 'drains', 'none'] as const;

export const skillNames = [
  'str', 'dex', 'int', 'edged', 'bashing', 'pole', 'thrown', 'archery', 'defense',
  'mage', 'priest', 'mage-lore', 'alchemy', 'item-lore', 'traps', 'lockpick', 'assassin',
  'poison', 'luck', 'hp', 'sp',
] as const;

export const traitNames = [
  'tough', 'magic-apt', 'ambidex', 'nimble', 'cave-lore', 'wood-lore', 'const', 'alert',
  'strong', 'regen', 'slow', 'magic-inept', 'frail', 'sickly', 'bad-back', 'pacifist', 'anama',
] as const;

export const itemTypes = [
  'none', 'weapon-1hand', 'weapon-2hand', 'gold', 'bow', 'arrow', 'thrown-missile', 'potion',
  'scroll', 'wand', 'tool', 'food', 'shield', 'armor', 'helm', 'gloves', 'shield2', 'boots',
  'ring', 'necklace', 'poison', 'object', 'pants', 'crossbow', 'bolts', 'missile', 'special',
  'quest',
] as const;

export const itemUses = ['help-one', 'harm-one', 'help-all', 'harm-all'] as const;

export const itemAbils = [
  'none', 'weap-dmg', 'weap-slay', 'weap-heal', 'weap-explode', 'weap-return', 'weap-dist',
  'weap-seek', 'weap-antimagic', 'weap-status',
  'weap-soulsuck', '', 'weap-weak', 'weap-fear', 'spec-weap', 'hp-dmg', 'hp-dmg-rev', 'sp-dmg',
  'sp-dmg-rev', '',
  '', '', '', '', '', '', '', '', '', '',
  'prot-dmg', 'prot-full', 'magery', 'evade', 'martyr', 'encumber', 'prot-status', 'skill',
  'boost-stat', 'boost-war',
  'boost-magic', 'accuracy', 'thief', 'giant', 'light', 'heavy', 'status', 'spec-hit',
  'save-life', 'prot-petrify',
  'regen', 'poison-aug', 'radiant', 'will', 'freedom', 'speed', 'slow', 'prot-race', 'lockpick',
  'missile-drain',
  'spec-drop', '', '', '', '', '', '', '', '', '',
  'use-poison', 'use-status', 'use-spell', 'bliss-doom', 'use-xp', 'use-skillpt', 'use-hp',
  'use-sp', 'use-light', 'use-party-stat',
  'major-heal', 'spec-use', 'use-summon', 'use-summon-mass', 'use-quickfire', 'use-read',
  '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
  'holly', 'comfrey', 'nettle', 'wormgrass', 'asptongue', 'ember', 'graymold', 'mandrake',
  'sapphire', 'smoky', 'balm',
] as const;

export const pcStatus = [
  'poison-weap', 'bless-curse', 'poison', 'haste-slow', 'invuln', 'magic', 'web', 'disease',
  'invis', 'dumb-smart', 'martyr', 'sleep', 'paralysis', 'acid', 'cage', 'charm',
] as const;

export const raceNames = [
  'human', 'nephil', 'slith', 'vahnatai', 'reptile', 'beast', 'important', 'mage', 'priest',
  'humanoid', 'demon', 'undead', 'giant', 'slime', 'stone', 'bug', 'dragon', 'magic', 'plant',
  'bird', 'skeletal', 'goblin',
] as const;

export const monstTimes = [
  'always', 'after-day', 'until-day', 'travel-a', 'travel-b', 'travel-c', 'after-event',
  'until-event', 'after-death',
] as const;

export const dirTags = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw', '?'] as const;

export const fieldNames = [
  'explored', 'wall-force', 'wall-fire', 'field-antimagic', 'cloud-stink', 'wall-ice',
  'wall-blades', 'cloud-sleep', 'obj-block', 'spec-spot', 'field-web', 'obj-crate', 'obj-barrel',
  'barr-fire', 'barr-force', 'field-quickfire', 'sfx-sm-bld', 'sfx-med-bld', 'sfx-lg-bld',
  'sfx-sm-slm', 'sfx-lg-slm', 'sfx-ash', 'sfx-bone', 'sfx-rock', 'barr-cage', 'spec-road',
  '', '', '', '', '', '', 'dispel', 'smash',
] as const;

export const dmgNames = [
  'weap', 'fire', 'poison', 'magic', 'weird', 'cold', 'undead', 'demon', 'acid', 'spec',
] as const;

export const monstAbils = [
  'none', 'missile', 'dmg', 'status', 'field', 'petrify', 'drain-sp', 'drain-xp', 'kill',
  'steal-food', 'steal-gold', 'stun', 'dmg2', 'status2', 'splits', 'martyr', 'absorb', 'old-web',
  'old-heat', 'spec-act', 'spec-hit', 'spec-death', 'radiate', 'summon',
] as const;

export const monstAbilTypes = ['ray', 'touch', 'gaze', 'breath', 'spit'] as const;

export const monstMelee = [
  'swing', 'claw', 'bite', 'slime', 'punch', 'sting', 'club', 'burn', 'harm', 'stab',
] as const;

export const monstMissiles = [
  'dart', 'arrow', 'spear', 'stone', 'star', 'spine', 'knife', 'bolt', 'boulder', 'arrow++',
] as const;

export const attitudeStrs = ['docile', 'hostile-a', 'friendly', 'hostile-b'] as const;

export const talkNodes = [
  'reg', 'if-sdf', 'set-sdf', 'inn', 'if-time', 'if-event', 'if-town', 'shop', 'train', 'jobs',
  '', '', 'recharge', 'sell-weap', 'sell-prot', 'sell-any', 'id', 'ench', 'buy-info', 'buy-sdf',
  'buy-ship', 'buy-horse', 'buy-spec-item', 'quest', 'buy-town', 'end-force', 'end-fight',
  'end-alarm', 'end-die', 'call-local', 'call-global',
] as const;

/**
 * readEnum: tag string → numeric enum value. Throws on unknown tags, like
 * the C++ stream operators setting failbit.
 */
export function readEnumTag(tags: readonly string[], value: string, what: string): number {
  const idx = tags.indexOf(value);
  if (idx < 0) throw new Error(`unknown ${what} tag '${value}'`);
  return idx;
}
