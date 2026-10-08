# Pivní Dungeon

Zaznamenávej piva, dobývej hospody, bojuj v cechovních válkách.

## Spuštění

```bash
npm install
npm run demo        # celá hra se simulovaným Firebase a ukázkovými daty (nic nemění v produkci)
npm run dev         # vývojový server proti skutečnému Firebase projektu
npm run build       # produkční sestavení do dist/
```

Demo účet: `demo@pivnidungeon.cz` / `pivo123` (přihlášen automaticky). Data dema leží v `localStorage`;
smažeš je v konzoli prohlížeče příkazem `localStorage.clear()`.

## Testy

```bash
npm test            # unit testy pravidel hry (src/game)
npm run test:layout # Playwright: žádná obrazovka nepřetéká do strany na 320–430 px
npx eslint src      # kontrola kódu
```

## Struktura

```
index.html, admin.html   jen markup
src/main.js              hra (obrazovky se postupně přesouvají do src/ui/screens)
src/firebase.js          inicializace Firebase
src/game/                čistá pravidla hry bez Firebase (XP, datum, úkoly, odznaky)
src/ui/                  DOM pomocníci, sdílecí obrázky
src/styles/              styly; Tailwind se generuje při sestavení
src/dev/mock/            simulace Firebase pro demo režim a testy
public/                  manifest a ikony
```

Plán přestavby a seznam chyb (ID B01…) je v dokumentu „Pivní Dungeon — plán přestavby“.
