// B05: datum se počítá v českém čase, ne v UTC.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { datumPraha, mesicPraha, predchoziDen, dnesniDatum } from '../../src/game/datum.js';
import { vypoctiStatsZLogy } from '../../src/game/odznaky.js';

const zapis = (iso) => ({ data: () => ({ pivo: 'Kozel 11°', cas: { toDate: () => new Date(iso) } }) });
afterEach(() => vi.useRealTimers());

describe('český čas', () => {
  it('pivo v 0:30 SELČ patří do nového dne', () => {
    expect(datumPraha(new Date('2026-10-08T22:30:00Z'))).toBe('2026-10-09');
    expect(datumPraha(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16'); // zimní čas UTC+1
  });
  it('nové kolo krajů začíná o půlnoci českého času', () => {
    expect(mesicPraha(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11');
  });
  it('předchozí den přes přechod na letní čas', () => {
    expect(predchoziDen('2026-03-30')).toBe('2026-03-29');
    expect(predchoziDen('2026-03-01')).toBe('2026-02-28');
    expect(predchoziDen('2026-01-01')).toBe('2025-12-31');
  });
  it('dnesniDatum v 1:00 v noci', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T23:00:00Z'));
    expect(dnesniDatum()).toBe('2026-10-09');
  });
  it('série se nepřeruší pivem po půlnoci', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T20:00:00Z'));
    // 7. 10. večer, 8. 10. v 0:30 (UTC ještě 7. 10.!), 9. 10. večer
    const s = vypoctiStatsZLogy([zapis('2026-10-07T18:00:00Z'), zapis('2026-10-07T22:30:00Z'), zapis('2026-10-09T18:00:00Z')], {});
    expect(s.streakAkt).toBe(3);
  });
});
