// Testy čistých pravidel hry (bez Firebase). Zachycují DNEŠNÍ chování, aby přestavba nic nerozbila.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { xpLevel, titulPostavy } from '../../src/game/xp.js';
import { isoTyden, hashRetezce } from '../../src/game/datum.js';
import { DENNI_UKOLY_DEF, TYDENNI_VYZVY_DEF } from '../../src/game/ukoly.js';
import { ACHIEVEMENTY_DEF, vypoctiStatsZLogy } from '../../src/game/odznaky.js';

const zapis = (iso, pivo, extra = {}) => ({ data: () => ({ pivo, cas: { toDate: () => new Date(iso) }, ...extra }) });

describe('xp', () => {
  it('úroveň roste každých 1000 XP', () => {
    expect(xpLevel(0)).toEqual({ lvl: 1, prog: 0 });
    expect(xpLevel(999).lvl).toBe(1);
    expect(xpLevel(1000)).toEqual({ lvl: 2, prog: 0 });
    expect(xpLevel(4700).prog).toBeCloseTo(70);
  });
  it('tituly podle úrovně', () => {
    expect(titulPostavy(1)).toContain('Nováček');
    expect(titulPostavy(5)).toContain('Zdatný');
    expect(titulPostavy(10)).toContain('Rytíř');
    expect(titulPostavy(20)).toContain('Legenda');
  });
});

describe('datum', () => {
  it('ISO týden', () => {
    expect(isoTyden(new Date(2026, 0, 1))).toBe('2026-W1');
    expect(isoTyden(new Date(2026, 9, 8))).toBe('2026-W41');
    expect(isoTyden(new Date(2027, 0, 1))).toBe('2026-W53');
  });
  it('hash je deterministický a nezáporný', () => {
    expect(hashRetezce('abc')).toBe(hashRetezce('abc'));
    expect(hashRetezce('uid2026-10-08')).toBeGreaterThanOrEqual(0);
  });
  it('úkol i výzva se vždy vyberou z definic', () => {
    for (const s of ['a', 'uid-1', 'x'.repeat(50)]) {
      expect(DENNI_UKOLY_DEF[hashRetezce(s) % DENNI_UKOLY_DEF.length]).toBeTruthy();
      expect(TYDENNI_VYZVY_DEF[hashRetezce(s) % TYDENNI_VYZVY_DEF.length]).toBeTruthy();
    }
  });
});

describe('statistiky a odznaky', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T18:00:00Z')); });

  it('počty, druhy, hospody a série', () => {
    const logy = [
      zapis('2026-10-08T17:00:00Z', 'Kozel 11°'),
      zapis('2026-10-07T17:00:00Z', 'Pilsner Urquell', { spolecne_s: 'Petr' }),
      zapis('2026-10-06T17:00:00Z', 'Kozel 11°'),
      zapis('2026-10-01T17:00:00Z', 'Birell'),
    ];
    const s = vypoctiStatsZLogy(logy, { 'U Soudku': 6, 'Na Rynku': 1 });
    expect(s.celkemPiv).toBe(4);
    expect(s.ruznych).toBe(3);
    expect(s.hospod).toBe(2);
    expect(s.maxNavstev).toBe(6);
    expect(s.spolecne).toBe(1);
    expect(s.streakAkt).toBe(3);
    expect(s.streakMax).toBe(3);
  });

  it('prázdný deník', () => {
    const s = vypoctiStatsZLogy([], {});
    expect(s.celkemPiv).toBe(0);
    expect(s.streakAkt).toBe(0);
    expect(s.hospod).toBe(0);
  });

  it('odznaky mají unikátní ID a platnou podmínku', () => {
    const ids = ACHIEVEMENTY_DEF.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = vypoctiStatsZLogy([zapis('2026-10-08T17:00:00Z', 'Kozel 11°')], { 'U Soudku': 1 });
    const ziskane = ACHIEVEMENTY_DEF.filter((a) => a.podminka(s)).map((a) => a.id);
    expect(ziskane).toContain('prvni_pivo');
    expect(ziskane).not.toContain('deset_piv');
  });
});
