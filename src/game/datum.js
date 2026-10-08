// Datum a pomocné výpočty. POZOR: dnesniDatum() je zatím v UTC (oprava B05 ve fázi 1).
export function dnesniDatum() { return new Date().toISOString().slice(0, 10); } // "2026-07-02"

export function isoTyden(d = new Date()) {
    // ISO 8601 týden ve formátu "2026-W27"
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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
