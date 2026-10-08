// Definice odznaků a výpočet osobních statistik ze záznamů.
import { datumPraha, predchoziDen } from './datum.js';
export const ACHIEVEMENTY_DEF = [
    // ── BRONZ ──
    { id:'prvni_pivo',    stupen:'bronz',  ikona:'ic-mug',       nazev:'První doušek',    popis:'Zapsal jsi své první pivo',             podminka: s => s.celkemPiv >= 1    },
    { id:'deset_piv',     stupen:'bronz',  ikona:'ic-mug-stamp', nazev:'Žíznivý hrdina',  popis:'Celkem 10 piv zapsáno',                 podminka: s => s.celkemPiv >= 10   },
    { id:'pet_hospod',    stupen:'bronz',  ikona:'ic-map',       nazev:'Průzkumník',      popis:'5 různých hospod navštíveno',           podminka: s => s.hospod >= 5       },
    { id:'verny_host',    stupen:'bronz',  ikona:'ic-home',      nazev:'Věrný host',       popis:'Jednu hospodu navštívil 5× nebo více',  podminka: s => s.maxNavstev >= 5   },
    { id:'deset_druhu',   stupen:'bronz',  ikona:'ic-bag',       nazev:'Ochutnávač',      popis:'10 různých druhů piv vyzkoušeno',       podminka: s => s.ruznych >= 10     },
    { id:'socialni',      stupen:'bronz',  ikona:'ic-clink',     nazev:'Sociální pijan',  popis:'Pil s kamarádem 10× nebo více',         podminka: s => s.spolecne >= 10    },
    { id:'nocni_pijan',   stupen:'bronz',  ikona:'ic-bell',      nazev:'Noční hlídka',    popis:'Zapis po půlnoci (00:00–04:00)',        podminka: s => s.nocniZapis        },
    // ── STŘÍBRO ──
    { id:'padesatpiv',    stupen:'stribro', ikona:'ic-shield',   nazev:'Pivní veterán',  popis:'Celkem 50 piv zapsáno',                 podminka: s => s.celkemPiv >= 50   },
    { id:'deset_hospod',  stupen:'stribro', ikona:'ic-map',      nazev:'Dobrodruh',       popis:'10 různých hospod navštíveno',          podminka: s => s.hospod >= 10      },
    { id:'stamgast',      stupen:'stribro', ikona:'ic-home',     nazev:'Štamgast',        popis:'Jednu hospodu navštívil 10× nebo více', podminka: s => s.maxNavstev >= 10  },
    { id:'dvacet_druhu',  stupen:'stribro', ikona:'ic-bag',      nazev:'Degustátor',      popis:'25 různých druhů piv vyzkoušeno',       podminka: s => s.ruznych >= 25     },
    { id:'pivni_banda',   stupen:'stribro', ikona:'ic-clink',    nazev:'Pivní banda',     popis:'Pil s kamarádem 30× nebo více',         podminka: s => s.spolecne >= 30    },
    { id:'streak_7',      stupen:'stribro', ikona:'ic-streak',   nazev:'Týdenní série',   popis:'7 dní v řadě se zápisem piva',          podminka: s => s.streakMax >= 7    },
    // ── ZLATO ──
    { id:'sto_piv',       stupen:'zlato',  ikona:'ic-trophy',    nazev:'Stý džbán',       popis:'Celkem 100 piv zapsáno',                podminka: s => s.celkemPiv >= 100  },
    { id:'dvacet_hospod', stupen:'zlato',  ikona:'ic-crown',     nazev:'Velký průzkumník', popis:'20 různých hospod navštíveno',          podminka: s => s.hospod >= 20      },
    { id:'somelier',      stupen:'zlato',  ikona:'ic-chest',     nazev:'Pivní someliér',  popis:'50 různých druhů piv vyzkoušeno',       podminka: s => s.ruznych >= 50     },
];

export function vypoctiStatsZLogy(logDocs, dungeony = {}) {
    const poctyPiv = {}, dny = new Set();
    let spolecne = 0, nocniZapis = false;

    logDocs.forEach(d => {
        const z = d.data();
        if (z.pivo) poctyPiv[z.pivo] = (poctyPiv[z.pivo] || 0) + 1;
        if (z.spolecne_s) spolecne++;
        if (z.cas) {
            const dt = z.cas.toDate ? z.cas.toDate() : new Date(z.cas);
            dny.add(datumPraha(dt));
            const h = dt.getHours();
            if (h >= 0 && h < 4) nocniZapis = true;
        }
    });

    // Streak
    const serazene = [...dny].sort();
    let streakMax = serazene.length > 0 ? 1 : 0, aktStreak = 1;
    for (let i = 1; i < serazene.length; i++) {
        const diff = (new Date(serazene[i]) - new Date(serazene[i-1])) / 86400000;
        aktStreak = diff === 1 ? aktStreak + 1 : 1;
        streakMax = Math.max(streakMax, aktStreak);
    }

    // Aktuální streak (od dneška zpět)
    let streakAkt = 0;
    const dnesStr = datumPraha();
    const vcerStr = predchoziDen(dnesStr);
    if (dny.has(dnesStr) || dny.has(vcerStr)) {
        let den = dny.has(dnesStr) ? dnesStr : vcerStr;
        while (dny.has(den)) {
            streakAkt++;
            den = predchoziDen(den);
        }
    }

    // Nejaktivnější den v týdnu
    const dnyTydne = [0,0,0,0,0,0,0];
    logDocs.forEach(d => {
        const z = d.data();
        if (z.cas) {
            const dt = z.cas.toDate ? z.cas.toDate() : new Date(z.cas);
            dnyTydne[dt.getDay()]++;
        }
    });
    const dnyNazvy = ['Ne','Po','Út','St','Čt','Pá','So'];
    const nejDenIdx = dnyTydne.indexOf(Math.max(...dnyTydne));

    // Průměr piv / týden — od prvního zápisu do DNEŠKA (inaktivita průměr snižuje)
    let prumerTyden = 0;
    if (serazene.length >= 1) {
        const prvni = new Date(serazene[0]);
        const tydny = Math.max(1, (Date.now() - prvni) / (7 * 86400000));
        prumerTyden = (logDocs.length / tydny).toFixed(1);
    }

    return {
        celkemPiv:  logDocs.length,
        ruznych:    Object.keys(poctyPiv).length,
        hospod:     Object.keys(dungeony || {}).length,
        maxNavstev: Math.max(0, ...Object.values(dungeony || {})),
        spolecne,
        streakMax,
        streakAkt,
        nocniZapis,
        nejDen:     dnyNazvy[nejDenIdx],
        prumerTyden,
        poctyPiv
    };
}
