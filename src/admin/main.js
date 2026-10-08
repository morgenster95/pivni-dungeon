import './index.css';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
    from "firebase/auth";
import { getFirestore, collection, collectionGroup, getDocs, doc, deleteDoc, updateDoc,
         increment, addDoc, getDoc, setDoc, query, orderBy, limit, writeBatch, where, Timestamp, serverTimestamp }
    from "firebase/firestore";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCrtK_99uh1SGyj2KhA2ljH3aAhynDnhqI",
    authDomain: "pivnidungeon.firebaseapp.com",
    projectId: "pivnidungeon",
    storageBucket: "pivnidungeon.firebasestorage.app",
    messagingSenderId: "174543526039",
    appId: "1:174543526039:web:be6092c458e376c306b1d2"
};

// ─── ADMIN UID seznam ─────────────────────────────────────────────
// Jak získat UID: Firebase console → Authentication → Users → zkopíruj User UID
const ADMIN_UIDS = [
    "pyyRzSGXzDcpo0wV8xzi0AOcJnb2",
];

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─── HELPERS ─────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

function notify(msg, type = 'ok') {
    const t = document.createElement('div');
    t.textContent = msg;
    const bg = type === 'err' ? '#7d2420' : type === 'warn' ? '#856a1a' : '#1c4731';
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;padding:10px 22px;border-radius:12px;z-index:9999;font-size:0.85rem;border:2px solid rgba(255,255,255,.15);font-family:'Fredoka',sans-serif;max-width:92%;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.5);`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3200);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function logLine(boxId, text, color) {
    const box = $(boxId);
    box.classList.remove('hidden');
    const line = document.createElement('div');
    line.style.color = color || '#86efac';
    line.textContent = `[${new Date().toLocaleTimeString('cs-CZ')}] ${text}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

// ─── AUTH ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        show('login-screen');
        hide('admin-panel');
        return;
    }
    // Pokud je seznam ADMIN_UIDS prázdný → dev mode (povolíme kohokoli)
    if (ADMIN_UIDS.length > 0 && !ADMIN_UIDS.includes(user.uid)) {
        notify('⛔ Nemáš přístup do velmistrova panelu!', 'err');
        await signOut(auth);
        return;
    }
    hide('login-screen');
    show('admin-panel');
    $('admin-info').textContent = `Přihlášen jako: ${user.email}`;
    await Promise.all([nactiNavrhy(), nactiValky(), nactiZebricek()]);
});

$('btn-admin-login').addEventListener('click', async () => {
    const email = $('admin-email').value.trim();
    const pass  = $('admin-password').value;
    $('login-error').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch(e) {
        $('login-error').textContent = 'Nesprávné přihlašovací údaje.';
    }
});

$('admin-password').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-admin-login').click(); });

$('btn-admin-logout').addEventListener('click', () => signOut(auth));
$('btn-refresh').addEventListener('click', nactiNavrhy);
$('btn-refresh-valky').addEventListener('click', nactiValky);

// ─── 1. NÁVRHY PIV ────────────────────────────────────────────────
async function nactiNavrhy() {
    const list = $('seznam-navrhu');
    list.innerHTML = '<p class="text-gray-500 italic text-sm text-center py-4">Načítám návrhy...</p>';
    const snap = await getDocs(collection(db, "navrhy_piv"));
    if (snap.empty) {
        list.innerHTML = '<p class="text-green-400 text-sm text-center py-4 font-bold">✓ Žádné čekající návrhy. Sudy jsou v pořádku.</p>';
        return;
    }
    list.innerHTML = '';
    snap.forEach(d => {
        const p = d.data();
        const card = document.createElement('div');
        card.className = 'navrh-card fade-in flex justify-between items-center gap-3';
        const info = document.createElement('div');
        info.innerHTML = `
            <div class="text-yellow-400 font-bold text-base" style="font-family:'Baloo 2',sans-serif;">${escapeHtml(p.nazev_piva)}</div>
            <div class="text-xs text-gray-400 mt-0.5">
                Navrhl: <span class="text-orange-400">${escapeHtml(p.navrhl ?? '—')}</span>
                &nbsp;·&nbsp; Hospoda: <span class="text-gray-300">${escapeHtml(p.hospoda ?? '—')}</span>
            </div>`;
        const btns = document.createElement('div');
        btns.className = 'flex gap-2 flex-shrink-0';
        const btnS = document.createElement('button');
        btnS.className = 'btn-primary px-4 py-2 text-xs uppercase';
        btnS.textContent = '✓ Schválit';
        btnS.addEventListener('click', () => schvalit(d.id, p));
        const btnZ = document.createElement('button');
        btnZ.className = 'btn-danger px-3 py-2 text-xs';
        btnZ.textContent = '✕';
        btnZ.addEventListener('click', () => zamitnout(d.id, p.nazev_piva));
        btns.appendChild(btnS);
        btns.appendChild(btnZ);
        card.appendChild(info);
        card.appendChild(btns);
        list.appendChild(card);
    });
}

async function schvalit(id, navrh) {
    const nazev   = navrh.nazev_piva;
    const hracUid = navrh.navrhl_uid;
    const hospoda = navrh.hospoda || 'Nezadáno';
    const casNavrhu = navrh.cas || null;
    try {
        await addDoc(collection(db, "vsechna_piva"), { nazev });
        if (hracUid) {
            const hracSnap = await getDoc(doc(db, "hraci", hracUid));
            if (hracSnap.exists()) {
                const bezTecky = hospoda.replace(/\./g, '_');
                await updateDoc(doc(db, "hraci", hracUid), {
                    xp: increment(100),
                    [`dungeony.${bezTecky}`]: increment(1)
                });
                await addDoc(collection(db, "hraci", hracUid, "log_piv"), {
                    pivo: nazev, hospoda, cas: casNavrhu, schvaleno: true
                });
                try { await setDoc(doc(db, "statistiky_piv", nazev), { pocet: increment(1) }, { merge: true }); } catch(e) { await setDoc(doc(db, "statistiky_piv", nazev), { pocet: 1 }); }
                const bezTecky2 = hospoda.replace(/\./g, '_');
                try { await setDoc(doc(db, "statistiky_hospod", bezTecky2), { pocet: increment(1), nazev: hospoda }, { merge: true }); } catch(e) {}
            }
        }
        await deleteDoc(doc(db, "navrhy_piv", id));
        notify(`✓ Mok "${nazev}" schválen! Hráč dostal +100 XP.`);
        nactiNavrhy();
    } catch (e) { notify('Chyba: ' + e.message, 'err'); }
}

async function zamitnout(id, nazev) {
    if (!confirm(`Opravdu zamítnout návrh "${nazev}"?`)) return;
    try {
        await deleteDoc(doc(db, "navrhy_piv", id));
        notify(`✕ Návrh "${nazev}" zamítnut.`, 'warn');
        nactiNavrhy();
    } catch (e) { notify('Chyba: ' + e.message, 'err'); }
}

// ─── 2. CECHOVNÍ VÁLKY ────────────────────────────────────────────
async function nactiValky() {
    const box = $('seznam-valek');
    box.innerHTML = '<p class="text-gray-500 italic text-sm text-center py-4">Načítám...</p>';
    const snap = await getDocs(collection(db, "valky"));
    if (snap.empty) {
        box.innerHTML = '<p class="text-gray-500 italic text-sm text-center py-4">Žádné záznamy o válkách.</p>';
        return;
    }
    box.innerHTML = '';
    for (const d of snap.docs) {
        const v = d.data();
        const [uSnap, oSnap] = await Promise.all([
            getDoc(doc(db, "cechy", v.utocnik_id)),
            getDoc(doc(db, "cechy", v.obrance_id))
        ]);
        const uNazev = uSnap.exists() ? uSnap.data().nazev : 'Zrušený cech';
        const oNazev = oSnap.exists() ? oSnap.data().nazev : 'Zrušený cech';
        const stavBadge = {
            'aktivni':  '<span class="text-green-400 font-bold">🔥 Aktivní</span>',
            'ceka':     '<span class="text-yellow-400 font-bold">⏳ Čeká na přijetí</span>',
            'skoncila': '<span class="text-gray-400">✓ Ukončena</span>'
        }[v.stav] ?? v.stav;
        const card = document.createElement('div');
        card.className = 'valka-card fade-in';
        card.innerHTML = `
            <div class="flex justify-between items-start">
                <div>
                    <div class="text-orange-300 font-bold text-sm mb-1" style="font-family:'Baloo 2',sans-serif;">
                        ${escapeHtml(uNazev)} <span class="text-gray-500">⚔️</span> ${escapeHtml(oNazev)}
                    </div>
                    <div class="text-xs text-gray-400">Stav: ${stavBadge}</div>
                    <div class="text-xs text-gray-500 mt-1">
                        Skóre: <span class="text-yellow-400">${v.utocnik_bodu ?? 0}</span>
                         : <span class="text-red-400">${v.obrance_bodu ?? 0}</span>
                        (cíl: ${v.cil_bodu ?? 50})
                    </div>
                </div>
                ${v.stav !== 'skoncila' ? `<button class="btn-danger px-3 py-1 text-xs uppercase" data-vid="${d.id}">Ukončit</button>` : ''}
            </div>`;
        const delBtn = card.querySelector('[data-vid]');
        if (delBtn) {
            delBtn.addEventListener('click', async () => {
                if (!confirm('Ukončit a smazat tuto válku?')) return;
                await deleteDoc(doc(db, "valky", d.id));
                notify('Válka ukončena.', 'warn');
                nactiValky();
            });
        }
        box.appendChild(card);
    }
}

// ─── 3. ŽEBŘÍČEK HRÁČŮ ───────────────────────────────────────────
async function nactiZebricek() {
    const q = query(collection(db, "hraci"), orderBy("xp", "desc"), limit(20));
    const snap = await getDocs(q);
    $('zebricek-hracu').innerHTML = snap.docs.map((d, i) => {
        const h = d.data();
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
        return `<div class="hrac-row">
            <span>${medal} <span class="text-yellow-400 font-bold">${escapeHtml(h.prezdivka ?? h.email ?? '—')}</span></span>
            <span class="text-yellow-500 text-xs font-bold">${h.xp ?? 0} XP</span>
        </div>`;
    }).join('') || '<div class="text-gray-600 text-sm italic text-center py-2">Žádní hráči.</div>';
}

// ─── 4. MAZÁNÍ ZÁPISŮ HRÁČE ──────────────────────────────────────
let adminVybranyHracUid = null;

$('btn-hledat-hrace').addEventListener('click', async () => {
    const email = $('admin-hrac-email').value.trim().toLowerCase();
    if (!email) { notify('Zadej e-mail hráče!', 'warn'); return; }
    hide('admin-hrac-info');
    hide('admin-logy-box');
    show('admin-logy-loading');
    try {
        const q = query(collection(db, "hraci"), where("email", "==", email));
        const snap = await getDocs(q);
        if (snap.empty) { notify('Hráč s tímto e-mailem nenalezen.', 'warn'); hide('admin-logy-loading'); return; }
        const d = snap.docs[0];
        const h = d.data();
        adminVybranyHracUid = d.id;
        $('admin-hrac-prezdivka').textContent = h.prezdivka || '—';
        $('admin-hrac-xp').textContent = (h.xp || 0) + ' XP';
        $('admin-hrac-tolary').textContent = '🪙 ' + (h.tolary || 0);
        $('admin-hrac-uid').textContent = d.id;
        show('admin-hrac-info');
        const logySnap = await getDocs(query(
            collection(db, "hraci", d.id, "log_piv"),
            orderBy("cas", "desc"), limit(50)
        ));
        const seznam = $('admin-logy-seznam');
        if (logySnap.empty) {
            seznam.innerHTML = '<div class="text-gray-600 italic text-xs text-center py-3">Žádné záznamy.</div>';
        } else {
            seznam.innerHTML = logySnap.docs.map(ld => {
                const z = ld.data();
                const casObj = z.cas?.toDate ? z.cas.toDate() : null;
                const datum = casObj
                    ? casObj.toLocaleDateString('cs-CZ') + ' ' + casObj.toLocaleTimeString('cs-CZ', {hour:'2-digit',minute:'2-digit'})
                    : '—';
                return `<div class="log-zapis-row" id="logrow-${ld.id}">
                    <span class="min-w-0">
                        <span class="text-yellow-400 font-bold">${escapeHtml(z.pivo || '—')}</span>
                        <span class="text-gray-400"> @ ${escapeHtml(z.hospoda || '—')}</span>
                        <span class="text-gray-600 text-[10px] block">${datum}</span>
                    </span>
                    <button onclick="adminSmazatZapis('${ld.id}','${escapeHtml(z.pivo||'')}','${escapeHtml(z.hospoda||'')}')"
                        class="btn-danger px-2 py-1 text-xs flex-shrink-0">🗑️</button>
                </div>`;
            }).join('');
        }
        show('admin-logy-box');
    } catch(e) {
        notify('Chyba: ' + e.message, 'err');
    } finally {
        hide('admin-logy-loading');
    }
});

$('admin-hrac-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-hledat-hrace').click(); });

window.adminSmazatZapis = async (logId, pivo, hospoda) => {
    if (!adminVybranyHracUid) return;
    if (!confirm(`Smazat záznam "${pivo}" @ ${hospoda}? Odečte -100 XP hráči.`)) return;
    try {
        // Zjisti, kolik Tolarů hráč za tento konkrétní zápis dostal, aby šly přesně vrátit.
        const logSnap = await getDoc(doc(db, "hraci", adminVybranyHracUid, "log_piv", logId));
        const tolaryZaZapis = logSnap.exists() ? (logSnap.data().tolary_ziskano || 0) : 0;

        const batch = writeBatch(db);
        batch.delete(doc(db, "hraci", adminVybranyHracUid, "log_piv", logId));
        const hracOpravy = { xp: increment(-100) };
        if (tolaryZaZapis > 0) hracOpravy.tolary = increment(-tolaryZaZapis);
        batch.update(doc(db, "hraci", adminVybranyHracUid), hracOpravy);
        await batch.commit();
        if (tolaryZaZapis > 0) {
            try {
                await addDoc(collection(db, "hraci", adminVybranyHracUid, "tolary_transakce"), {
                    mnozstvi: -tolaryZaZapis,
                    duvod: `Admin: smazán zápis "${pivo}" @ ${hospoda}`,
                    cas: serverTimestamp()
                });
            } catch(e) {}
        }
        const bezTecky = hospoda.replace(/\./g, '_');
        try { await updateDoc(doc(db, "statistiky_piv", pivo), { pocet: increment(-1) }); } catch(e) {}
        try { await updateDoc(doc(db, "statistiky_hospod", bezTecky), { pocet: increment(-1) }); } catch(e) {}
        const row = document.getElementById('logrow-' + logId);
        if (row) row.remove();
        const hSnap = await getDoc(doc(db, "hraci", adminVybranyHracUid));
        if (hSnap.exists()) {
            $('admin-hrac-xp').textContent = (hSnap.data().xp || 0) + ' XP';
            $('admin-hrac-tolary').textContent = '🪙 ' + (hSnap.data().tolary || 0);
        }
        notify(`Záznam smazán, -100 XP${tolaryZaZapis > 0 ? ` a -${tolaryZaZapis} Tolarů` : ''} odečteno.`, 'warn');
    } catch(e) { notify('Chyba při mazání: ' + e.message, 'err'); }
};

// ─── RUČNÍ ÚPRAVA TOLARŮ (reklamace, oprava chyby) ───────────────────
$('btn-admin-tolary-upravit').addEventListener('click', async () => {
    if (!adminVybranyHracUid) { notify('Nejprve vyhledej hráče.', 'warn'); return; }
    const mnozstvi = parseInt($('admin-tolary-mnozstvi').value, 10);
    const duvod = $('admin-tolary-duvod').value.trim() || 'Admin úprava';
    if (!mnozstvi) { notify('Zadej nenulové množství (kladné nebo záporné).', 'warn'); return; }
    try {
        await updateDoc(doc(db, "hraci", adminVybranyHracUid), { tolary: increment(mnozstvi) });
        await addDoc(collection(db, "hraci", adminVybranyHracUid, "tolary_transakce"), {
            mnozstvi, duvod: `Admin: ${duvod}`, cas: serverTimestamp()
        });
        const hSnap = await getDoc(doc(db, "hraci", adminVybranyHracUid));
        $('admin-hrac-tolary').textContent = '🪙 ' + (hSnap.data().tolary || 0);
        $('admin-tolary-mnozstvi').value = '';
        $('admin-tolary-duvod').value = '';
        notify(`Tolary upraveny o ${mnozstvi > 0 ? '+' : ''}${mnozstvi}.`, 'ok');
    } catch(e) { notify('Chyba: ' + e.message, 'err'); }
});

// ─── 5A. PŘEPOČÍTAT STATISTIKY ───────────────────────────────────
$('btn-migrace-statistiky').addEventListener('click', async () => {
    if (!confirm('Spustit přepočet statistik? Stávající data budou PŘIČTENA. Pro čistý přepočet použij Reset.')) return;
    await spustMigraciStatistik('migrace-statistiky-log', false);
});

$('btn-reset-statistiky').addEventListener('click', async () => {
    if (!confirm('VAROVÁNÍ: Toto smaže a přepočítá všechny statistiky od nuly. Pokračovat?')) return;
    await spustMigraciStatistik('reset-statistiky-log', true);
});

async function spustMigraciStatistik(logId, resetNejdrive) {
    const btn = resetNejdrive ? $('btn-reset-statistiky') : $('btn-migrace-statistiky');
    btn.disabled = true;
    $(logId).innerHTML = '';
    try {
        if (resetNejdrive) {
            logLine(logId, 'Mažu stávající statistiky piv...');
            const pivSnap = await getDocs(collection(db, "statistiky_piv"));
            let b = writeBatch(db); let c = 0;
            for (const d of pivSnap.docs) { b.delete(d.ref); c++; if (c % 400 === 0) { await b.commit(); b = writeBatch(db); } }
            await b.commit();
            logLine(logId, `  → Smazáno ${c} záznamů piv.`);
            logLine(logId, 'Mažu stávající statistiky hospod...');
            const hospSnap = await getDocs(collection(db, "statistiky_hospod"));
            let b2 = writeBatch(db); let c2 = 0;
            for (const d of hospSnap.docs) { b2.delete(d.ref); c2++; if (c2 % 400 === 0) { await b2.commit(); b2 = writeBatch(db); } }
            await b2.commit();
            logLine(logId, `  → Smazáno ${c2} záznamů hospod.`);
        }
        logLine(logId, 'Načítám seznam hráčů...');
        const hraciSnap = await getDocs(collection(db, "hraci"));
        logLine(logId, `  → Nalezeno ${hraciSnap.size} hráčů.`);
        const poctyPiv = {}, poctyHospod = {};
        let celkemLogu = 0;
        for (const hracDoc of hraciSnap.docs) {
            logLine(logId, `Čtu logy: ${hracDoc.data().prezdivka ?? hracDoc.id}...`, '#fbbf24');
            try {
                const logSnap = await getDocs(collection(db, "hraci", hracDoc.id, "log_piv"));
                logSnap.forEach(l => {
                    const z = l.data();
                    if (z.pivo)    poctyPiv[z.pivo]        = (poctyPiv[z.pivo]        || 0) + 1;
                    if (z.hospoda) poctyHospod[z.hospoda]  = (poctyHospod[z.hospoda]  || 0) + 1;
                    celkemLogu++;
                });
                logLine(logId, `  → ${logSnap.size} záznamů.`);
            } catch (e) { logLine(logId, `  ⚠ Chyba: ${e.message}`, '#f87171'); }
        }
        logLine(logId, `Celkem ${celkemLogu} zápisů, ${Object.keys(poctyPiv).length} piv, ${Object.keys(poctyHospod).length} hospod.`);
        logLine(logId, 'Zapisuji statistiky piv...');
        let pb = writeBatch(db); let pc = 0;
        for (const [n, cnt] of Object.entries(poctyPiv)) {
            pb.set(doc(db, "statistiky_piv", n), { pocet: cnt }, { merge: !resetNejdrive });
            pc++; if (pc % 400 === 0) { await pb.commit(); pb = writeBatch(db); }
        }
        await pb.commit();
        logLine(logId, `  → Zapsáno ${pc} piv.`);
        logLine(logId, 'Zapisuji statistiky hospod...');
        let hb = writeBatch(db); let hc = 0;
        for (const [n, cnt] of Object.entries(poctyHospod)) {
            hb.set(doc(db, "statistiky_hospod", n), { pocet: cnt }, { merge: !resetNejdrive });
            hc++; if (hc % 400 === 0) { await hb.commit(); hb = writeBatch(db); }
        }
        await hb.commit();
        logLine(logId, `  → Zapsáno ${hc} hospod.`);
        logLine(logId, '✅ Migrace statistik dokončena!', '#34d399');
    } catch (e) { logLine(logId, `❌ Chyba: ${e.message}`, '#f87171'); }
    finally { btn.disabled = false; }
}

// ─── 5B. MIGRACE SCHÉMAT HRÁČŮ ───────────────────────────────────
const SCHEMA_VERZE = 4;

$('btn-migrace-hraci').addEventListener('click', async () => {
    if (!confirm('Doplnit chybějící pole všem hráčům?')) return;
    const logId = 'migrace-hraci-log';
    $(logId).innerHTML = '';
    $('btn-migrace-hraci').disabled = true;
    try {
        logLine(logId, 'Načítám hráče...');
        const snap = await getDocs(collection(db, "hraci"));
        logLine(logId, `  → ${snap.size} hráčů nalezeno.`);
        let opraveno = 0, vporizadku = 0;
        for (const d of snap.docs) {
            const h = d.data(); const opravy = {};
            if (!h.prezdivka)                   opravy.prezdivka        = h.email?.split('@')[0] ?? 'Hrdina';
            if (h.xp === undefined)             opravy.xp               = 0;
            if (!h.dungeony)                    opravy.dungeony         = {};
            if (h.cech_id === undefined)        opravy.cech_id          = null;
            if (h.cech_zakladatel === undefined) opravy.cech_zakladatel  = false;
            if (h.avatar === undefined)         opravy.avatar           = '⚔️';
            if (h.bio === undefined)            opravy.bio              = '';
            if (h.kraj === undefined)           opravy.kraj             = '';
            if (h.sledovani === undefined)      opravy.sledovani        = [];
            if ((h.verze_schematu ?? 0) < SCHEMA_VERZE) opravy.verze_schematu = SCHEMA_VERZE;
            if (Object.keys(opravy).length > 0) {
                await updateDoc(d.ref, opravy);
                logLine(logId, `  ✏ ${h.prezdivka ?? d.id}: doplněno ${Object.keys(opravy).join(', ')}`, '#fbbf24');
                opraveno++;
            } else { vporizadku++; }
        }
        logLine(logId, `✅ Hotovo! Opraveno: ${opraveno}, v pořádku: ${vporizadku}`, '#34d399');
    } catch (e) { logLine(logId, `❌ Chyba: ${e.message}`, '#f87171'); }
    finally { $('btn-migrace-hraci').disabled = false; }
});

// ─── 5C. PŘEPOČÍTAT KRÁLOVSTVÍ ───────────────────────────────────
$('btn-prepocitat-kralovstvi').addEventListener('click', async () => {
    const logId = 'prepocitat-kralovstvi-log';
    $(logId).innerHTML = '';
    $('btn-prepocitat-kralovstvi').disabled = true;
    try {
        const mesic = new Date().toISOString().slice(0, 7);
        logLine(logId, 'Spouštím přepočet pro měsíc: ' + mesic);
        const kSnap  = await getDocs(query(collection(db, "kralovstvi"),       where("mesic", "==", mesic)));
        const khSnap = await getDocs(query(collection(db, "kralovstvi_hraci"), where("mesic", "==", mesic)));
        let delBatch = writeBatch(db); let delCount = 0;
        kSnap.forEach(d => { delBatch.delete(d.ref); delCount++; });
        khSnap.forEach(d => { delBatch.delete(d.ref); delCount++; });
        if (delCount > 0) await delBatch.commit();
        logLine(logId, 'Smazáno ' + delCount + ' starých záznamů.');
        const hraciSnap = await getDocs(query(collection(db, "hraci"), where("kraj", "!=", null)));
        logLine(logId, 'Nalezeno ' + hraciSnap.size + ' hráčů s krajem.');
        const krajSoučty = {};
        let zpracovano = 0;
        for (const hracDoc of hraciSnap.docs) {
            const h = hracDoc.data();
            if (!h.kraj) continue;
            const zacatek = new Date(mesic + '-01T00:00:00');
            const konec   = new Date(new Date(zacatek).setMonth(zacatek.getMonth() + 1));
            const logSnap = await getDocs(query(
                collection(db, "hraci", hracDoc.id, "log_piv"),
                where("cas", ">=", Timestamp.fromDate(zacatek)),
                where("cas", "<",  Timestamp.fromDate(konec))
            ));
            const pocetPiv = logSnap.size;
            if (pocetPiv === 0) continue;
            await setDoc(doc(db, "kralovstvi_hraci", mesic + "_" + hracDoc.id), {
                uid: hracDoc.id, prezdivka: h.prezdivka || "—",
                kraj: h.kraj, mesic, piv: pocetPiv
            });
            krajSoučty[h.kraj] = (krajSoučty[h.kraj] || 0) + pocetPiv;
            zpracovano++;
        }
        logLine(logId, 'Zpracováno ' + zpracovano + ' aktivních hráčů.');
        for (const [kraj, pocet] of Object.entries(krajSoučty)) {
            await setDoc(doc(db, "kralovstvi", mesic + "_" + kraj), { kraj, mesic, piv: pocet });
        }
        logLine(logId, 'Uloženo ' + Object.keys(krajSoučty).length + ' krajů.');
        logLine(logId, '✅ Hotovo! Království přepočítáno.', '#34d399');
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-prepocitat-kralovstvi').disabled = false; }
});

// ─── 5D. SMAZAT PRÁZDNÉ CECHY ────────────────────────────────────
$('btn-smazat-prazdne-cechy').addEventListener('click', async () => {
    const logId = 'prazdne-cechy-log';
    $(logId).innerHTML = '';
    $('btn-smazat-prazdne-cechy').disabled = true;
    try {
        const vsechnyCechy = await getDocs(collection(db, "cechy"));
        logLine(logId, 'Nalezeno ' + vsechnyCechy.size + ' cechů.');
        let smazano = 0;
        for (const cechDoc of vsechnyCechy.docs) {
            const clenovSnap = await getDocs(query(collection(db, "hraci"), where("cech_id", "==", cechDoc.id)));
            if (clenovSnap.empty) {
                await deleteDoc(cechDoc.ref);
                logLine(logId, '🗑️ Smazán prázdný cech: ' + (cechDoc.data().nazev || cechDoc.id), '#fbbf24');
                smazano++;
            }
        }
        logLine(logId, '✅ Hotovo. Smazáno ' + smazano + ' prázdných cechů.', '#34d399');
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-smazat-prazdne-cechy').disabled = false; }
});

// ─── 5E. SPÁROVAT SPOLEČNÉ PITÍ ──────────────────────────────────
$('btn-migrace-spolecne').addEventListener('click', async () => {
    const logId = 'migrace-spolecne-log';
    $(logId).innerHTML = '';
    $('btn-migrace-spolecne').disabled = true;
    try {
        logLine(logId, 'Načítám všechny hráče...');
        const hraciSnap = await getDocs(collection(db, "hraci"));
        logLine(logId, `Nalezeno ${hraciSnap.size} hráčů.`);
        const podleHospody = {};
        let celkemZaznamu = 0;
        for (const hracDoc of hraciSnap.docs) {
            const logSnap = await getDocs(collection(db, "hraci", hracDoc.id, "log_piv"));
            logSnap.docs.forEach(d => {
                const data = d.data();
                if (!data.hospoda || !data.cas) return;
                if (!podleHospody[data.hospoda]) podleHospody[data.hospoda] = [];
                podleHospody[data.hospoda].push({
                    ref: d.ref, uid: hracDoc.id,
                    cas: data.cas.toDate ? data.cas.toDate() : new Date(data.cas),
                    spolecne_s: data.spolecne_s || null
                });
                celkemZaznamu++;
            });
        }
        logLine(logId, `Nalezeno ${celkemZaznamu} záznamů celkem.`);
        for (const h of Object.keys(podleHospody)) podleHospody[h].sort((a, b) => a.cas - b.cas);
        let sparovano = 0;
        for (const [hospoda, zaznamy] of Object.entries(podleHospody)) {
            if (zaznamy.length < 2) continue;
            for (let i = 0; i < zaznamy.length; i++) {
                const z = zaznamy[i];
                if (z.spolecne_s) continue;
                const jmena = [], uids = [];
                for (let j = 0; j < zaznamy.length; j++) {
                    if (i === j || zaznamy[j].uid === z.uid) continue;
                    if (Math.abs(z.cas - zaznamy[j].cas) <= 5 * 60 * 1000) {
                        uids.push(zaznamy[j].uid);
                        const hSnap = hraciSnap.docs.find(d => d.id === zaznamy[j].uid);
                        if (hSnap) jmena.push(hSnap.data().prezdivka);
                    }
                }
                if (jmena.length > 0) {
                    try {
                        await updateDoc(z.ref, { spolecne_s: jmena.join(', '), spolecne_uids: uids });
                        sparovano++;
                    } catch(eW) {}
                }
            }
        }
        logLine(logId, `✅ Hotovo! Spárováno ${sparovano} záznamů.`, '#34d399');
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-migrace-spolecne').disabled = false; }
});

// ─── 5F. RESET KRÁLOVSTVÍ ─────────────────────────────────────────
$('btn-reset-kralovstvi').addEventListener('click', async () => {
    if (!confirm('Opravdu smazat výsledky aktuálního měsíce krajské války?')) return;
    const logId = 'reset-kralovstvi-log';
    $(logId).innerHTML = '';
    $('btn-reset-kralovstvi').disabled = true;
    try {
        const mesic = new Date().toISOString().slice(0, 7);
        logLine(logId, 'Mažu kraje za ' + mesic + '...');
        const krajSnap = await getDocs(query(collection(db, "kralovstvi"),       where("mesic", "==", mesic)));
        const hracSnap = await getDocs(query(collection(db, "kralovstvi_hraci"), where("mesic", "==", mesic)));
        const batch = writeBatch(db);
        krajSnap.forEach(d => batch.delete(d.ref));
        hracSnap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        logLine(logId, 'Smazáno ' + (krajSnap.size + hracSnap.size) + ' záznamů.', '#34d399');
        logLine(logId, '✅ Reset dokončen!', '#34d399');
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-reset-kralovstvi').disabled = false; }
});

// ─── 6A. MIGRACE HODNOCENÍ PIV ────────────────────────────────────
$('btn-migrace-hodnoceni').addEventListener('click', async () => {
    if (!confirm('Doplnit chybějící hodnocení pole všem pivům?')) return;
    const logId = 'migrace-hodnoceni-log';
    $(logId).innerHTML = '';
    $('btn-migrace-hodnoceni').disabled = true;
    try {
        logLine(logId, 'Načítám statistiky_piv...');
        const snap = await getDocs(collection(db, "statistiky_piv"));
        logLine(logId, `Nalezeno ${snap.size} piv.`);
        let opraveno = 0;
        const batch = writeBatch(db);
        snap.docs.forEach(d => {
            const data = d.data();
            if (data.hodnoceni_prumerne === undefined || data.hodnoceni_pocet === undefined) {
                batch.set(d.ref, {
                    hodnoceni_prumerne: 0,
                    hodnoceni_pocet: 0
                }, { merge: true });
                opraveno++;
            }
        });
        if (opraveno > 0) {
            await batch.commit();
            logLine(logId, `✅ Doplněno ${opraveno} piv.`, '#34d399');
        } else {
            logLine(logId, '✅ Všechna piva již mají hodnocení pole.', '#34d399');
        }
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-migrace-hodnoceni').disabled = false; }
});

// ─── 6B. RESET HODNOCENÍ PIVA ─────────────────────────────────────
$('btn-reset-hodnoceni-piva').addEventListener('click', async () => {
    const nazev = $('reset-hodnoceni-nazev').value.trim();
    if (!nazev) { notify('Zadej název piva!', 'warn'); return; }
    if (!confirm(`Opravdu vynulovat hodnocení piva "${nazev}"?`)) return;
    const logId = 'reset-hodnoceni-log';
    $(logId).innerHTML = '';
    $('btn-reset-hodnoceni-piva').disabled = true;
    try {
        const pivRef = doc(db, "statistiky_piv", nazev);
        const pivSnap = await getDoc(pivRef);
        if (!pivSnap.exists()) {
            logLine(logId, `❌ Pivo "${nazev}" neexistuje v statistiky_piv.`, '#f87171');
            return;
        }
        await updateDoc(pivRef, { hodnoceni_prumerne: 0, hodnoceni_pocet: 0 });
        logLine(logId, `✅ Hodnocení piva "${nazev}" vynulováno.`, '#34d399');
        $('reset-hodnoceni-nazev').value = '';
    } catch(e) { logLine(logId, '❌ Chyba: ' + e.message, '#f87171'); }
    finally { $('btn-reset-hodnoceni-piva').disabled = false; }
});
