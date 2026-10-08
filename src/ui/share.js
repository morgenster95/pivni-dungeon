// Sdílecí obrázky (karta zápisu, Wrapped) a modal pro sdílení.
import { $ } from './dom.js';
import { xpLevel } from '../game/xp.js';

function kresliZaokrRekt(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y); ctx.arcTo(x+w, y, x+w, y+r, r);
    ctx.lineTo(x+w, y+h-r); ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h); ctx.arcTo(x, y+h, x, y+h-r, r);
    ctx.lineTo(x, y+r); ctx.arcTo(x, y, x+r, y, r);
    ctx.closePath();
}

function fitText(ctx, text, maxW, maxSize) {
    ctx.font = `bold ${maxSize}px Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW) return;
    const scale = maxW / ctx.measureText(text).width;
    ctx.font = `bold ${Math.floor(maxSize * scale)}px Arial, sans-serif`;
}

export async function vygenerujPivniKartu(pubName, beerName, userData) {
    const W = 1080, H = 1080;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Pozadí
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0f2e'); bg.addColorStop(0.5, '#160f08'); bg.addColorStop(1, '#0a0618');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Záře nahoře
    const glow = ctx.createRadialGradient(W/2, 80, 20, W/2, 80, 500);
    glow.addColorStop(0, 'rgba(255,168,30,0.3)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Rám zlatý
    ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 10;
    ctx.strokeRect(20, 20, W-40, H-40);
    ctx.strokeStyle = 'rgba(255,211,90,0.22)'; ctx.lineWidth = 2;
    ctx.strokeRect(38, 38, W-76, H-76);

    ctx.textAlign = 'center';

    // Header
    ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 62px Arial, sans-serif';
    ctx.fillText('PIVNÍ DUNGEON', W/2, 112);
    ctx.fillStyle = 'rgba(255,211,90,0.45)'; ctx.font = '28px Arial, sans-serif';
    ctx.fillText('pivnidungeon.cz', W/2, 155);

    // Dělicí čára
    ctx.strokeStyle = 'rgba(255,211,90,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 180); ctx.lineTo(W-80, 180); ctx.stroke();

    // Velký emoji piva
    ctx.font = '210px serif'; ctx.fillStyle = '#fff';
    ctx.fillText('🍺', W/2, 420);

    // "PRÁVĚ PIJU"
    ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText('P R Á V Ě   P I J U', W/2, 555);

    // Název piva
    ctx.fillStyle = '#ffffff';
    fitText(ctx, beerName, 900, 74);
    ctx.fillText(beerName, W/2, 648);

    // "v hospodě"
    ctx.fillStyle = 'rgba(243,168,30,0.65)'; ctx.font = '32px Arial, sans-serif';
    ctx.fillText('v hospodě', W/2, 708);

    // Název hospody
    ctx.fillStyle = '#f3a81e';
    fitText(ctx, pubName, 900, 54);
    ctx.fillText(pubName, W/2, 772);

    // Dělicí čára
    ctx.strokeStyle = 'rgba(255,211,90,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 812); ctx.lineTo(W-80, 812); ctx.stroke();

    // Hráčské info
    const av  = userData?.avatar      || '⚔️';
    const nik = userData?.prezdivka   || 'Hrdina';
    const xp  = userData?.xp          || 0;
    const { lvl } = xpLevel(xp);

    ctx.font = '54px serif'; ctx.fillStyle = '#fff';
    ctx.fillText(av, W/2, 892);
    ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 40px Arial, sans-serif';
    ctx.fillText(nik, W/2, 946);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.font = '26px Arial, sans-serif';
    ctx.fillText(`Úroveň ${lvl}  ·  ${xp} XP`, W/2, 988);

    // Datum
    const now = new Date();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.font = '22px Arial, sans-serif';
    ctx.fillText(
        now.toLocaleDateString('cs-CZ') + ' ' +
        now.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}),
        W/2, 1038
    );
    return c;
}

export async function vygenerujWrappedCanvas(s) {
    const W = 1080;
    const tW = 458, tH = 172, gap = 16, startY = 355;

    // Sestav tiles nejdřív — výška canvasu se spočítá z jejich počtu
    const tiles = [
        { emoji:'🍺', value: s.celkemPiv.toString(), label: 'piv celkem'        },
        { emoji:'🌈', value: s.ruznych.toString(),   label: 'různých druhů'     },
        { emoji:'🏰', value: s.hospod.toString(),    label: 'hospod navštíveno' },
        { emoji:'⭐', value: `Úr. ${s.lvl}`,        label: `${s.xp} XP celkem` },
        { emoji:'🥇', value: s.oblPivo ? s.oblPivo.nazev : '—',
                       label: s.oblPivo ? `${s.oblPivo.pocet}× vypito`    : 'oblíbené pivo'    },
        { emoji:'🏠', value: s.oblHosp ? s.oblHosp.nazev : '—',
                       label: s.oblHosp ? `${s.oblHosp.pocet}× návštěv`  : 'oblíbená hospoda' },
    ];
    if (s.nejSpoluhrac) {
        tiles.push(
            { emoji:'📅', value: s.nejMesic ? s.nejMesic.nazev : '—',
                          label: s.nejMesic ? `${s.nejMesic.pocet} piv`         : 'nejlepší měsíc' },
            { emoji:'🍻', value: s.nejSpoluhrac.nazev, label: `${s.nejSpoluhrac.pocet}× spolu` }
        );
    } else if (s.nejMesic) {
        tiles.push({ emoji:'📅', value: s.nejMesic.nazev, label: `${s.nejMesic.pocet} piv — nejlepší měsíc` });
    }

    const rows    = Math.ceil(tiles.length / 2);
    const footerY = startY + rows * (tH + gap) + 20;
    const H       = footerY + 80; // přesná výška: tiles + footer + dolní okraj

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    // Pozadí
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a0f2e'); bg.addColorStop(0.45, '#160f08'); bg.addColorStop(1, '#08050f');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Záře
    const glow = ctx.createRadialGradient(W/2, H*0.22, 60, W/2, H*0.22, 520);
    glow.addColorStop(0, 'rgba(255,168,30,0.22)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    // Rám
    ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 10; ctx.strokeRect(20, 20, W-40, H-40);
    ctx.strokeStyle = 'rgba(255,211,90,0.2)'; ctx.lineWidth = 2; ctx.strokeRect(38, 38, W-76, H-76);

    ctx.textAlign = 'center';

    // Header
    ctx.fillStyle = 'rgba(255,211,90,0.5)'; ctx.font = '34px Arial, sans-serif';
    ctx.fillText('🍻  PIVNÍ DUNGEON  🍺', W/2, 105);
    ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 94px Arial, sans-serif';
    ctx.fillText('MŮJ WRAPPED', W/2, 218);
    ctx.font = '52px serif'; ctx.fillStyle = '#fff';
    ctx.fillText(s.avatar + '  ' + s.nick, W/2, 298);

    ctx.strokeStyle = 'rgba(255,211,90,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 326); ctx.lineTo(W-80, 326); ctx.stroke();

    // Tiles
    const cols = [60, W - 60 - tW];
    tiles.forEach((tile, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = cols[col], y = startY + row * (tH + gap);

        const tGrad = ctx.createLinearGradient(x, y, x, y + tH);
        tGrad.addColorStop(0, 'rgba(255,211,90,0.13)');
        tGrad.addColorStop(1, 'rgba(255,211,90,0.04)');
        ctx.fillStyle = tGrad;
        kresliZaokrRekt(ctx, x, y, tW, tH, 18); ctx.fill();
        ctx.strokeStyle = 'rgba(255,211,90,0.32)'; ctx.lineWidth = 1.5;
        kresliZaokrRekt(ctx, x, y, tW, tH, 18); ctx.stroke();

        const cx = x + tW/2;
        ctx.fillStyle = '#fff'; ctx.font = '38px serif'; ctx.textAlign = 'center';
        ctx.fillText(tile.emoji, cx, y + 50);
        ctx.fillStyle = '#fff';
        fitText(ctx, tile.value, tW - 24, 36);
        ctx.fillText(tile.value, cx, y + 103);
        ctx.fillStyle = 'rgba(255,211,90,0.62)'; ctx.font = '21px Arial, sans-serif';
        ctx.fillText(tile.label.length > 22 ? tile.label.slice(0,21)+'…' : tile.label, cx, y + 138);
    });

    // Footer
    ctx.strokeStyle = 'rgba(255,211,90,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, footerY); ctx.lineTo(W-80, footerY); ctx.stroke();
    ctx.fillStyle = 'rgba(255,211,90,0.38)'; ctx.font = '27px Arial, sans-serif';
    ctx.fillText('🍻  PIVNÍ DUNGEON  ·  pivnidungeon.cz  🍺', W/2, footerY + 46);

    return c;
}

export function otevritShareModal(canvas) {
    const wrap = $('share-canvas-wrap');
    wrap.innerHTML = '';
    const previewW = Math.min(window.innerWidth - 48, 400);
    canvas.style.cssText = `width:${previewW}px;height:auto;border-radius:12px;display:block;`;
    wrap.appendChild(canvas);

    const modal = $('share-modal');
    modal.style.display = 'flex';
    modal.classList.remove('hidden');

    $('btn-share-download').onclick = () => {
        const a = document.createElement('a');
        a.download = 'pivni-dungeon-share.png';
        a.href = canvas.toDataURL('image/png');
        a.click();
    };

    $('btn-share-native').onclick = async () => {
        try {
            const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
            const file = new File([blob], 'pivni-dungeon.png', { type: 'image/png' });
            if (navigator.share && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    text: '🍺 Pivní Dungeon — pivnidungeon.cz'
                });
            } else {
                $('btn-share-download').click();
            }
        } catch(e) {
            if (e.name !== 'AbortError') $('btn-share-download').click();
        }
    };
}

window.zavritShareModal = () => {
    const modal = $('share-modal');
    modal.style.display = 'none';
    modal.classList.add('hidden');
    $('share-canvas-wrap').innerHTML = '';
};
