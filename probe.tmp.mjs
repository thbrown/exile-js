import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage();
p.on('console', m => { if (m.type()==='error') console.log('ERR', m.text()); });
await p.goto('http://localhost:5199/');
await p.waitForFunction(() => window.__session);
const out = await p.evaluate(async () => {
  const s = window.__session;
  const ctxmod = await import('/src/game/specials/context.ts');
  const town = s.univ.town;
  const spot = town.record.specialLocs.find(l => l.spec === 6);
  const node = town.record.specials.get(6);
  s.univ.party.townLoc = { x: spot.x, y: spot.y + 1 };
  // Answer every dialog with the last button and PC 1.
  const res = await s.runSpecial(ctxmod.SpecCtx.TOWN_LOOK, ctxmod.SpecCtxType.TOWN, 6, spot);
  return {
    node: { sd1: node.sd1, sd2: node.sd2, type: node.type, ex1a: node.ex1a, jumpto: node.jumpto },
    res,
    sdf: s.univ.party.getSdf(node.sd1, node.sd2),
    tail: s.univ.transcript.slice(-4),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
