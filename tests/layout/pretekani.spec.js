// Žádná obrazovka nesmí jít posouvat do strany (obsah mimo kontejner) a nesmí hodit chybu v konzoli.
import { test, expect } from '@playwright/test';

const SIRKY = [320, 360, 390, 430];
const ZALOZKY = ['krcma', 'mapa', 'denik', 'piva', 'cech', 'kralovstvi', 'sin'];

for (const sirka of SIRKY) {
  test(`šířka ${sirka}px: žádné vodorovné přetékání ani chyby`, async ({ page }) => {
    const chyby = [];
    page.on('pageerror', (e) => chyby.push(e.message));
    page.on('console', (m) => {
      // Dlaždice mapy a fonty z internetu v testu nevadí
      if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) chyby.push(m.text());
    });
    await page.setViewportSize({ width: sirka, height: 844 });
    await page.goto('/');
    await page.waitForFunction(() => typeof window.switchTab === 'function' && !document.getElementById('app-screen').classList.contains('hidden'));

    for (const z of ZALOZKY) {
      await page.evaluate((z) => window.switchTab(z), z);
      await page.waitForTimeout(600);
      const { sw, cw, vycniva } = await page.evaluate(() => {
        const de = document.documentElement;
        const vycniva = [...document.querySelectorAll('body *')]
          .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > de.clientWidth + 1 && !el.closest('.leaflet-container'); })
          .slice(0, 3).map((el) => `${el.tagName}#${el.id}.${el.className}`);
        return { sw: de.scrollWidth, cw: de.clientWidth, vycniva };
      });
      expect(sw, `záložka ${z}: obsah přetéká (${vycniva.join(', ')})`).toBeLessThanOrEqual(cw);
    }
    expect(chyby).toEqual([]);
  });
}
