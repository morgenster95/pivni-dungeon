// Demo režim: ukázková data (vymyšlení hráči, cechy a hospody).
import { Timestamp } from './firestore.js';

const PIVA = ['Pilsner Urquell', 'Kozel 11°', 'Bernard 11°', 'Radegast 12°', 'Budvar 12°', 'Birell', 'Koníček Jantar 13°', 'Gambrinus 12°'];
const HOSPODY = ['U Zlatého soudku', 'Pivnice Na Rynku', 'Restaurace Sokolovna', 'Hostinec U Lípy', 'Pivovar Koníček'];

// Deterministický pseudonáhodný generátor, aby demo vypadalo pokaždé stejně
function rng(seed) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; }

export function seed() {
  const now = Date.now();
  const day = 86400000;
  const ts = (ms) => Timestamp.fromMillis(ms);
  const mesic = new Date().toISOString().slice(0, 7);
  const out = {};

  // ── Zápisy Vojty: 46 piv za posledních 60 dní ──
  const r = rng(42);
  const dungeony = {};
  const ochutnana = new Set();
  const pocty = {};
  for (let i = 0; i < 46; i++) {
    const kdy = now - Math.floor(r() * 60) * day - Math.floor(r() * 5 + 17) * 3600000;
    const pivo = PIVA[Math.floor(r() * r() * PIVA.length)];
    const hospoda = HOSPODY[Math.floor(r() * r() * HOSPODY.length)];
    const zapis = { pivo, hospoda, cas: ts(kdy) };
    if (r() < 0.2) { zapis.spolecne_s = 'Petr Pěnivý'; zapis.spolecne_uids = ['demo-petr']; }
    out[`hraci/demo-vojta/log_piv/z${String(i).padStart(3, '0')}`] = zapis;
    dungeony[hospoda] = (dungeony[hospoda] || 0) + 1;
    ochutnana.add(pivo);
    pocty[pivo] = (pocty[pivo] || 0) + 1;
    out[`global_log/g${String(i).padStart(3, '0')}`] = { pivo, hospoda, hrac_uid: 'demo-vojta', hrac_prezdivka: 'Vojta Žíznivý', cas: ts(kdy) };
  }
  // Dnešní zápis, ať je série a Krčma živá
  out['hraci/demo-vojta/log_piv/z999'] = { pivo: 'Kozel 11°', hospoda: 'U Zlatého soudku', cas: ts(now - 2 * 3600000) };
  dungeony['U Zlatého soudku'] += 1;

  const dnes = new Date().toISOString().slice(0, 10);
  out['hraci/demo-vojta'] = {
    email: 'demo@pivnidungeon.cz', prezdivka: 'Vojta Žíznivý', xp: 4700, dungeony, cech_id: 'cech-sud', cech_zakladatel: false,
    avatar: '🍺', bio: 'Štamgast na zkoušku.', kraj: 'Moravskoslezský', sledovani: ['demo-petr'], registraci_cas: ts(now - 70 * day),
    tolary: 142, ochutnana_piva: [...ochutnana], hospoda_tolary_datum: {}, tolary_denni: { datum: dnes, pocet_piv: 1, pocet_hodnoceni: 0 },
    denni_ukol: null, tydenni_vyzva: null, verze_schematu: 5,
    achievementy: [{ id: 'prvni_pivo', ziskano: new Date(now - 69 * day).toISOString() }, { id: 'deset_piv', ziskano: new Date(now - 40 * day).toISOString() }],
    hodnoceni_piv: { 'Kozel 11°': 4, 'Pilsner Urquell': 5 },
  };

  const hrac = (uid, prezdivka, xp, cech, avatar, kraj, extra = {}) => {
    out[`hraci/${uid}`] = {
      email: `${uid}@example.com`, prezdivka, xp, dungeony: { 'U Zlatého soudku': 3 }, cech_id: cech, cech_zakladatel: false, avatar, bio: '', kraj,
      sledovani: [], registraci_cas: ts(now - 100 * day), tolary: 60, ochutnana_piva: [], hospoda_tolary_datum: {},
      tolary_denni: { datum: '', pocet_piv: 0, pocet_hodnoceni: 0 }, denni_ukol: null, tydenni_vyzva: null, verze_schematu: 5, ...extra,
    };
  };
  hrac('demo-petr', 'Petr Pěnivý', 9800, 'cech-sud', '🛡️', 'Moravskoslezský', { cech_zakladatel: true });
  hrac('demo-jana', 'Jana Chmelová', 6100, 'cech-sud', '👑', 'Jihomoravský');
  hrac('demo-karel', 'Karel Ječmen', 12400, 'cech-pena', '🐉', 'Praha', { cech_zakladatel: true });
  hrac('demo-eva', 'Eva Sladová', 2300, null, '🍺', 'Plzeňský');
  out['hraci/demo-petr/log_piv/p001'] = { pivo: 'Pilsner Urquell', hospoda: 'U Zlatého soudku', cas: ts(now - 3 * 3600000) };

  out['cechy/cech-sud'] = { nazev: 'Železný sud', zakladatel: 'demo-petr', skore: 412, zalozen: ts(now - 90 * day) };
  out['cechy/cech-pena'] = { nazev: 'Zlatá pěna', zakladatel: 'demo-karel', skore: 388, zalozen: ts(now - 80 * day) };
  out['valky/valka-1'] = {
    utocnik_id: 'cech-sud', obrance_id: 'cech-pena', utocnik_bodu: 23, obrance_bodu: 18, stav: 'aktivni', cil_bodu: 50,
    zahajeno: ts(now - 4 * day), konec: ts(now + 3 * day),
  };

  for (const [pivo, n] of Object.entries(pocty)) out[`statistiky_piv/${pivo}`] = { pocet: n + 20, hodnoceni_prumerne: 4.1, hodnoceni_pocet: 12 };
  for (const h of HOSPODY) out[`statistiky_hospod/${h}`] = { pocet: (dungeony[h] || 0) + 15, nazev: h };
  out['vsechna_piva/v1'] = { nazev: 'Koníček Jantar 13°' };

  const kraje = { 'Moravskoslezský': 61, 'Praha': 74, 'Jihomoravský': 52, 'Plzeňský': 33 };
  for (const [kraj, piv] of Object.entries(kraje)) out[`kralovstvi/${mesic}_${kraj}`] = { kraj, mesic, piv };
  out[`kralovstvi_hraci/${mesic}_demo-vojta`] = { uid: 'demo-vojta', kraj: 'Moravskoslezský', mesic, piv: 9 };

  out['hraci/demo-vojta/notifikace/n1'] = { typ: 'odznak', text: 'Nový odznak: Žíznivý hrdina', cas: ts(now - 40 * day), precteno: true };
  out['hraci/demo-vojta/notifikace/n2'] = { typ: 'valka', text: 'Zlatá pěna přijala vaši výzvu k válce!', cas: ts(now - 4 * day), precteno: false };
  out['hraci/demo-vojta/tolary_transakce/t1'] = { mnozstvi: 15, duvod: 'Nová hospoda: Pivovar Koníček', cas: ts(now - 9 * day) };
  out['hraci/demo-vojta/tolary_transakce/t2'] = { mnozstvi: 5, duvod: 'První pivo dne', cas: ts(now - 2 * 3600000) };
  return out;
}
