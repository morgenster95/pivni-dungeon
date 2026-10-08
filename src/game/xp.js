// XP level (každých 1000 XP = 1 level)
export function xpLevel(xp) {
    const lvl = Math.floor(xp / 1000) + 1;
    const prog = (xp % 1000) / 1000 * 100;
    return { lvl, prog };
}

// Titul postavy odvozený z levelu (bez nutnosti nového pole)
export function titulPostavy(lvl) {
    if (lvl >= 20) return '⚜ Pivní Legenda';
    if (lvl >= 10) return '⚜ Rytíř Zlatého Ležáku';
    if (lvl >= 5)  return '🍺 Zdatný Pijan';
    return '🌱 Nováček';
}
