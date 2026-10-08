// B01: data od hráčů (přezdívka, pivo, hospoda, cech) se nesmí nikde vykonat jako kód.
import { test, expect } from '@playwright/test';

const PAYLOAD = `<img src=x onerror="window.__xss=(window.__xss||0)+1">');window.__xss=1;//"`;

test('škodlivé názvy se zobrazí jako text a nespustí se', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => localStorage.getItem('pd-demo-db'));
  await page.evaluate((x) => {
    const db = new Map(JSON.parse(localStorage.getItem('pd-demo-db')));
    const now = { __ts: Date.now() };
    db.set('global_log/xss', { pivo: x, hospoda: x, hrac_uid: x, hrac_prezdivka: x, cas: now });
    db.set('hraci/demo-jana', { ...db.get('hraci/demo-jana'), prezdivka: x, avatar: x, xp: 99999 });
    db.set('cechy/cech-pena', { ...db.get('cechy/cech-pena'), nazev: x });
    db.set('hraci/demo-vojta/log_piv/xss', { pivo: x, hospoda: x, spolecne_s: x, cas: now });
    db.set('statistiky_piv/' + x.replace(/\//g, ''), { pocet: 999999, hodnoceni_prumerne: 5, hodnoceni_pocet: 3 });
    localStorage.setItem('pd-demo-db', JSON.stringify([...db.entries()]));
  }, PAYLOAD);
  await page.reload();
  await page.waitForFunction(() => typeof window.switchTab === 'function');
  for (const z of ['krcma', 'mapa', 'denik', 'piva', 'cech', 'kralovstvi', 'sin']) {
    await page.evaluate((z) => window.switchTab(z), z);
    await page.waitForTimeout(700);
  }
  // Odkaz na profil se škodlivým uid musí jen otevřít profil, ne spustit kód
  await page.evaluate(() => window.switchTab('mapa'));
  await page.waitForTimeout(700);
  const odkaz = page.locator('#global-log-box [data-profil]').first();
  if (await odkaz.count()) await odkaz.click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#global-log-box')).toContainText('<img src=x');
});
