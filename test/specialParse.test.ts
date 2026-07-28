import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SpecType, PIC_DLOG } from '../src/data/special';
import { SpecParseError, buildOpcodeTable, parseSpecials } from '../src/fileio/specialParse';

const opcodes = buildOpcodeTable(
  readFileSync(new URL('../public/data/strings/specials-opcodes.txt', import.meta.url), 'utf8'),
);

describe('buildOpcodeTable', () => {
  it('maps names to the numeric SpecType values (1-based lines)', async () => {
    expect(opcodes.get('set-sdf')).toBe(SpecType.SET_SDF);
    expect(opcodes.get('block-move')).toBe(SpecType.CANT_ENTER);
    expect(opcodes.get('once-disp-msg')).toBe(SpecType.ONCE_DISPLAY_MSG);
    expect(opcodes.get('out-move-party')).toBe(SpecType.OUT_MOVE_PARTY);
  });
});

describe('parseSpecials', () => {
  it('parses a full block with all fields', async () => {
    const src = [
      '@once-disp-msg = 0',
      '\tsdf 349, 0',
      '\tmsg 0, -1, -1',
      '\tpic 0, 4',
      '\tex1 -1, -1, -1',
      '\tex2 -1, -1, -1',
      '\tgoto -1',
      '',
    ].join('\n');
    const nodes = parseSpecials(src, opcodes, 'inline');
    expect(nodes.size).toBe(1);
    const n = nodes.get(0)!;
    expect(n.type).toBe(SpecType.ONCE_DISPLAY_MSG);
    expect(n.sd1).toBe(349);
    expect(n.sd2).toBe(0);
    expect(n.m1).toBe(0);
    expect(n.jumpto).toBe(-1);
  });

  it('auto-increments node indices and honors explicit ones', async () => {
    const src = '@disp-msg\n@disp-msg = 7\n@disp-msg\n';
    const nodes = parseSpecials(src, opcodes);
    expect([...nodes.keys()].sort((a, b) => a - b)).toEqual([0, 7, 8]);
  });

  it('applies init_block defaults (pictype = PIC_DLOG, others -1)', async () => {
    const nodes = parseSpecials('@disp-msg = 3\nmsg 5\n', opcodes);
    const n = nodes.get(3)!;
    expect(n.pictype).toBe(PIC_DLOG);
    expect(n.pic).toBe(-1);
    expect(n.m1).toBe(5);
    expect(n.m2).toBe(-1);
    expect(n.ex2c).toBe(-1);
  });

  it('resolves def symbols', async () => {
    const src = 'def my-flag = 42\n@set-sdf\nsdf my-flag, 1\n';
    const n = parseSpecials(src, opcodes).get(0)!;
    expect(n.sd1).toBe(42);
    expect(n.sd2).toBe(1);
  });

  it('rejects symbol redefinition', async () => {
    expect(() => parseSpecials('def a = 1\ndef a = 2\n', opcodes)).toThrow(SpecParseError);
  });

  it('rejects unknown opcodes and too many values', async () => {
    expect(() => parseSpecials('@not-a-real-opcode\n', opcodes)).toThrow(SpecParseError);
    expect(() => parseSpecials('@disp-msg\ngoto 1, 2\n', opcodes)).toThrow(SpecParseError);
    expect(() => parseSpecials('@disp-msg\nsdf 1, 2, 3\n', opcodes)).toThrow(SpecParseError);
  });

  it('parses every .spec file in the four bundled scenarios', async () => {
    const base = new URL('../public/scenarios/', import.meta.url);
    for (const scen of ['valleydy', 'stealth', 'zakhazi', 'busywork']) {
      for (const dir of ['', 'towns/', 'out/']) {
        const path = new URL(`${scen}/${dir}`, base);
        for (const f of readdirSync(path).filter((f) => f.endsWith('.spec'))) {
          const text = readFileSync(new URL(f, path), 'utf8');
          const nodes = parseSpecials(text, opcodes, `${scen}/${dir}${f}`);
          for (const [id, node] of nodes) {
            expect(id).toBeGreaterThanOrEqual(0);
            expect(node.type in SpecType).toBe(true);
          }
        }
      }
    }
  });

  it('valleydy town1.spec matches known first nodes', async () => {
    const text = readFileSync(
      new URL('../public/scenarios/valleydy/towns/town1.spec', import.meta.url),
      'utf8',
    );
    const nodes = parseSpecials(text, opcodes, 'town1.spec');
    expect(nodes.get(1)!.type).toBe(SpecType.CANT_ENTER);
    expect(nodes.get(2)!.type).toBe(SpecType.DISPLAY_MSG);
    expect(nodes.get(2)!.jumpto).toBe(3);
    expect(nodes.get(3)!.type).toBe(SpecType.DAMAGE);
    expect(nodes.get(3)!.ex1a).toBe(1);
  });
});
