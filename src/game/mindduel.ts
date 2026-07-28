/**
 * Mindduel — `do_mindduel` (boe.party.cpp:1497).
 *
 * A ten-round tug of war over spell points: each round one side drains the
 * other, and whoever runs dry starts taking dumbfounding instead. Eight points
 * of dumbfounding kills. It is the one spell that can kill its caster.
 */

import { Attitude } from '../data/monster';
import { Creature } from '../universe/creature';
import { ItemAbil } from '../data/item';
import { SpellNote, livingSound } from '../universe/living';
import { MainStatus, Skill, Status } from '../universe/skills';
import { getProtLevel } from '../universe/inventory';
import { killMonst, killPc } from './damage';
import { makeTownHostile } from './townAttitude';
import type { GameSession } from './session';

/**
 * The duel itself. `adjust` is fixed before the first round — the caster's
 * level and intelligence against twice the monster's, plus five per point of
 * WILL protection — and `balance` swings it back and forth as the duel runs,
 * so a side that is winning finds it harder to keep winning.
 *
 * *Gotcha*: duelling a friendly creature turns the whole town hostile first,
 * so there is no quiet way to try it on a townsperson.
 */
export function doMindduel(session: GameSession, pcNum: number, monst: Creature): void {
  const univ = session.univ;
  const pc = univ.party.pcs[pcNum];
  if (!pc) return;

  let adjust = Math.trunc((pc.level + pc.skill(Skill.INTELLIGENCE)) / 2) - monst.mon.level * 2;
  adjust += getProtLevel(pc, ItemAbil.WILL) * 5;
  if (monst.isFriendly) {
    makeTownHostile(session);
    monst.attitude = Attitude.HOSTILE_A;
  }

  let balance = 0;
  univ.addStringToBuf('Mindduel!');
  for (let i = 0; i < 10 && pc.mainStatus === MainStatus.ALIVE && monst.isAlive; i++) {
    livingSound(1);
    let r1 = univ.rng.getRan(1, 1, 100) + adjust;
    r1 += 5 * ((monst.status[Status.DUMB] ?? 0) - (pc.status[Status.DUMB] ?? 0));
    r1 += 5 * balance;
    const r2 = univ.rng.getRan(1, 1, 6);
    // Under 30 the monster wins the round; over 70 the caster does; in
    // between nothing happens at all, which is most of the duel.
    if (r1 < 30) {
      univ.addStringToBuf(`  ${pc.name} is drained ${r2}.`);
      monst.mp += r2;
      balance++;
      if (pc.curSp === 0) {
        // Written straight into the status rather than through `dumbfound`,
        // so nothing resists it and nothing clamps it.
        pc.status[Status.DUMB] = (pc.status[Status.DUMB] ?? 0) + 2;
        univ.addStringToBuf(`  ${pc.name} is dumbfounded.`);
        if ((pc.status[Status.DUMB] ?? 0) > 7) {
          univ.addStringToBuf(`  ${pc.name} is killed!`);
          killPc(univ, pc, MainStatus.DEAD);
        }
      } else {
        pc.curSp = Math.max(0, pc.curSp - r2);
      }
    }
    if (r1 > 70) {
      univ.addStringToBuf(`  ${pc.name} drains ${r2}.`);
      // The caster's pool is *not* capped at its maximum here; the every-turn
      // upkeep bleeds the excess off again afterwards.
      pc.curSp += r2;
      balance--;
      if (monst.mp === 0) {
        monst.status[Status.DUMB] = (monst.status[Status.DUMB] ?? 0) + 2;
        monst.spellNote(SpellNote.DUMBFOUNDED);
        if ((monst.status[Status.DUMB] ?? 0) > 7) killMonst(univ, monst, pcNum, MainStatus.DEAD, session);
      } else {
        monst.mp = Math.max(0, monst.mp - r2);
      }
    }
  }
}
