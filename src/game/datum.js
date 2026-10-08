// Datum v českém čase (Europe/Prague). Dříve se používalo UTC (toISOString), takže piva
// zapsaná mezi půlnocí a 2:00 padala do předchozího dne — série, denní úkoly a kraje (B05).

const PRAHA = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "YYYY-MM-DD" daného okamžiku v českém čase */
export function datumPraha(d = new Date()) { return PRAHA.format(d); }

/** "YYYY-MM" daného okamžiku v českém čase (kolo krajské války) */
export function mesicPraha(d = new Date()) { return datumPraha(d).slice(0, 7); }

/** Dnešní datum v českém čase, "YYYY-MM-DD" */
export function dnesniDatum() { return datumPraha(); }

/** Předchozí kalendářní den k "YYYY-MM-DD" (bez závislosti na letním čase) */
export function predchoziDen(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function isoTyden(d = new Date()) {
    // ISO 8601 týden ve formátu "2026-W27" (podle českého data)
    const [y, m, den0] = datumPraha(d).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, den0));
    const den = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - den + 3);
    const prvniCtvrtek = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const tyden = 1 + Math.round(((dt - prvniCtvrtek) / 86400000 - 3 + (prvniCtvrtek.getUTCDay() + 6) % 7) / 7);
    return `${dt.getUTCFullYear()}-W${tyden}`;
}

export function hashRetezce(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h;
}
