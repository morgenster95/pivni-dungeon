import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import Chart from 'chart.js/auto';
import './styles/index.css';
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, reauthenticateWithCredential, updatePassword, EmailAuthProvider }
    from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, arrayUnion, collection, collectionGroup,
         addDoc, query, where, getDocs, orderBy, limit, startAfter, deleteDoc, writeBatch, serverTimestamp, Timestamp }
    from "firebase/firestore";

// ─── FIREBASE CONFIG ──────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyCrtK_99uh1SGyj2KhA2ljH3aAhynDnhqI",
    authDomain: "pivnidungeon.firebaseapp.com",
    projectId: "pivnidungeon",
    storageBucket: "pivnidungeon.firebasestorage.app",
    messagingSenderId: "174543526039",
    appId: "1:174543526039:web:be6092c458e376c306b1d2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ─── KONSTANTY ────────────────────────────────────────────────────────
const ZAKLAD_PIV = [
    "Pilsner Urquell", "Gambrinus 12°", "Kozel 11°", "Radegast 12°",
    "Budvar 12°", "Bernard 11°", "Birell", "Kofola", "Staropramen 12°",
    "Zlatopramen 11°", "Rohozec 11°", "Platan 11°", "Krušovice 12°"
];
const VALKA_TRVANI_DNI = 7;
const VALKA_CIL_BODU = 50;

// Zvyšuj při každé nové funkci která přidává pole do hráčova dokumentu.
// Hráč s nižší verzi bude automaticky upgradován při příštím přihlášení.
const SCHEMA_VERZE = 5;

// Co každá verze přidává:
// v1 → email, prezdivka, xp, dungeony, cech_id
// v2 → cech_zakladatel
// v3 → registraci_cas
// v4 → avatar, bio, kraj, sledovani
// v5 → tolary, ochutnana_piva, hospoda_tolary_datum, tolary_denni, denni_ukol, tydenni_vyzva
// ← sem přidávej nové verze

// ─── STAV ─────────────────────────────────────────────────────────────
let map = null, userLatLng = null, currentPubLatLng = null;
let currentUser = null, userData = {};
let posledniStats = null; // cache osobních statistik pro Krčmu (invaliduje se po zápisu piva)

// ─── HELPERS ──────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function setHtml(id, html) { $(id).innerHTML = html; }
window.escapeHtml = function(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); };
const escapeHtml = window.escapeHtml;
function notify(msg) {
    // Jednoduchý toast místo alert()
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d3748;color:#fff;padding:10px 20px;border-radius:10px;z-index:9999;font-size:0.85rem;border:1px solid #8b4513;font-family:Cinzel,serif;max-width:90%;text-align:center;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
function zavritModal() { $('modal-overlay').classList.add('hidden'); $('navrh-piva-input').value = ''; }
window.zavritModal = zavritModal;

// ─── ZNOVUPOUŽITELNÉ STAVY (prázdno/spí/načítám/chyba) ────────────────
function pdStateEmpty(title, hint) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div class="pd-state__icon"><span>🕸️</span></div>
        <div class="pd-state__title">${escapeHtml(title)}</div>
        <div class="pd-state__hint">„${escapeHtml(hint)}“</div>
    </div>`;
}
function pdStateSleep(title, hint) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div style="font-size:44px;margin-bottom:8px;filter:grayscale(.3);">😴</div>
        <div class="pd-state__title">${escapeHtml(title)}</div>
        <div class="pd-state__hint">„${escapeHtml(hint)}“</div>
    </div>`;
}
function pdStateLoading(text) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div class="pd-mug-loading"><div class="pd-mug-loading__foam"></div><div class="pd-mug-loading__head"></div></div>
        <div class="pd-state__title">${escapeHtml(text || 'Načítám…')}</div>
        <div class="pd-state__hint">„Točíme čerstvé. Pěna se usazuje…“</div>
    </div>`;
}
function pdStateError(msg) {
    return `<div class="pd-panel pd-panel--stone pd-state pd-state--error">
        <div style="font-size:44px;margin-bottom:8px;">💥</div>
        <div class="pd-state__title">No to nám přeteklo…</div>
        <div class="pd-state__hint">„${escapeHtml(msg || 'Něco se rozlilo. Zkus to prosím znovu, hrdino.')}“</div>
    </div>`;
}

// XP level (každých 1000 XP = 1 level)
function xpLevel(xp) {
    const lvl = Math.floor(xp / 1000) + 1;
    const prog = (xp % 1000) / 1000 * 100;
    return { lvl, prog };
}

// Titul postavy odvozený z levelu (bez nutnosti nového pole)
function titulPostavy(lvl) {
    if (lvl >= 20) return '⚜ Pivní Legenda';
    if (lvl >= 10) return '⚜ Rytíř Zlatého Ležáku';
    if (lvl >= 5)  return '🍺 Zdatný Pijan';
    return '🌱 Nováček';
}

// ─── TOLARY (herní měna) ──────────────────────────────────────────────
function dnesniDatum() { return new Date().toISOString().slice(0, 10); } // "2026-07-02"

function isoTyden(d = new Date()) {
    // ISO 8601 týden ve formátu "2026-W27"
    const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const den = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - den + 3);
    const prvniCtvrtek = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
    const tyden = 1 + Math.round(((dt - prvniCtvrtek) / 86400000 - 3 + (prvniCtvrtek.getUTCDay() + 6) % 7) / 7);
    return `${dt.getUTCFullYear()}-W${tyden}`;
}

function hashRetezce(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h;
}

// Připíše tolary hráči + zaznamená transakci do historie + zobrazí toast.
async function udelTolary(mnozstvi, duvod) {
    if (!currentUser || !mnozstvi) return;
    try {
        await updateDoc(doc(db, "hraci", currentUser.uid), { tolary: increment(mnozstvi) });
        await addDoc(collection(db, "hraci", currentUser.uid, "tolary_transakce"), {
            mnozstvi, duvod, cas: serverTimestamp()
        });
        userData.tolary = (userData.tolary || 0) + mnozstvi;
        if (typeof vykresliTolaryBadge === 'function') vykresliTolaryBadge();
        notify(`🪙 +${mnozstvi} Tolarů — ${duvod}`);
    } catch (e) { console.warn('Chyba připsání Tolarů:', e.message); }
}

// ─── DENNÍ ÚKOL & TÝDENNÍ VÝZVA ───────────────────────────────────────
const DENNI_UKOLY_DEF = [
    { typ: 'pocet_piv',    cil: 1, popis: 'Zapiš 1 pivo' },
    { typ: 'pocet_piv',    cil: 2, popis: 'Zapiš 2 piva' },
    { typ: 'pocet_piv',    cil: 3, popis: 'Zapiš 3 piva' },
    { typ: 'nova_hospoda', cil: 1, popis: 'Zapiš pivo v nové hospodě' },
    { typ: 'nove_pivo',    cil: 1, popis: 'Ochutnej nové pivo' },
    { typ: 'hodnoceni',    cil: 1, popis: 'Ohodnoť pivo nebo hospodu' },
    { typ: 'hodnoceni',    cil: 2, popis: 'Ohodnoť 2× pivo nebo hospodu' },
    { typ: 'spolecne',     cil: 1, popis: 'Zapiš pivo s kamarádem' },
];
const TYDENNI_VYZVY_DEF = [
    { cil: 5,  odmena: 30 },
    { cil: 8,  odmena: 45 },
    { cil: 10, odmena: 60 },
];

// Vygeneruje (nebo vrátí existující) denní úkol pro dnešek — deterministicky dle uid+datum.
function zajistiDenniUkol() {
    const dnes = dnesniDatum();
    if (userData.denni_ukol && userData.denni_ukol.datum === dnes) return userData.denni_ukol;
    const def = DENNI_UKOLY_DEF[hashRetezce(currentUser.uid + dnes) % DENNI_UKOLY_DEF.length];
    const novy = { datum: dnes, typ: def.typ, cil: def.cil, popis: def.popis, progress: 0, splneno: false };
    userData.denni_ukol = novy;
    updateDoc(doc(db, "hraci", currentUser.uid), { denni_ukol: novy }).catch(e => console.warn(e.message));
    return novy;
}

// Vygeneruje (nebo vrátí existující) týdenní výzvu — deterministicky dle ISO týdne.
function zajistiTydenniVyzvu() {
    const tyden = isoTyden();
    if (userData.tydenni_vyzva && userData.tydenni_vyzva.tyden_id === tyden) return userData.tydenni_vyzva;
    const def = TYDENNI_VYZVY_DEF[hashRetezce(tyden) % TYDENNI_VYZVY_DEF.length];
    const nova = { tyden_id: tyden, cil: def.cil, odmena: def.odmena, progress: 0, splneno: false };
    userData.tydenni_vyzva = nova;
    updateDoc(doc(db, "hraci", currentUser.uid), { tydenni_vyzva: nova }).catch(e => console.warn(e.message));
    return nova;
}

async function pripoctiUkolProgress(typ, delta = 1) {
    const ukol = zajistiDenniUkol();
    if (ukol.splneno || ukol.typ !== typ) return;
    ukol.progress = Math.min(ukol.cil, ukol.progress + delta);
    const dokonceno = ukol.progress >= ukol.cil;
    if (dokonceno) ukol.splneno = true;
    try {
        await updateDoc(doc(db, "hraci", currentUser.uid), { denni_ukol: ukol });
        if (dokonceno) {
            await updateDoc(doc(db, "hraci", currentUser.uid), { xp: increment(50) });
            userData.xp = (userData.xp || 0) + 50;
            vykresliHeader();
            await udelTolary(10, `Denní úkol splněn: ${ukol.popis}`);
            notify(`✅ Úkol splněn: ${ukol.popis}! +50 XP`);
        }
        if (typeof vykresliKrcmu === 'function' && !$('obsah-krcma').classList.contains('hidden')) vykresliKrcmu();
    } catch (e) { console.warn('Chyba ukládání denního úkolu:', e.message); }
}

async function pripoctiTydenniProgress(delta = 1) {
    const vyzva = zajistiTydenniVyzvu();
    if (vyzva.splneno) return;
    vyzva.progress = Math.min(vyzva.cil, vyzva.progress + delta);
    const dokonceno = vyzva.progress >= vyzva.cil;
    if (dokonceno) vyzva.splneno = true;
    try {
        await updateDoc(doc(db, "hraci", currentUser.uid), { tydenni_vyzva: vyzva });
        if (dokonceno) {
            await udelTolary(vyzva.odmena, `Týdenní výzva splněna (${vyzva.cil} piv)`);
            notify(`🏆 Týdenní výzva splněna!`);
        }
        if (typeof vykresliKrcmu === 'function' && !$('obsah-krcma').classList.contains('hidden')) vykresliKrcmu();
    } catch (e) { console.warn('Chyba ukládání týdenní výzvy:', e.message); }
}

// ─── AUTH ─────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        hide('auth-screen');
        const el = $('app-screen');
        el.classList.remove('hidden');
        el.style.display = 'flex';
        el.classList.add('flex-col', 'items-center');
        try {
            await Promise.all([nactiPiva(), loadUserData()]);
            initMap();
            nactiGlobalniLog();
            vykresliKrcmu();
        } catch (e) { console.error("Start error:", e); }
    } else {
        currentUser = null;
        userData = {};
        const el = $('app-screen');
        el.classList.add('hidden');
        el.style.display = '';
        show('auth-screen');
    }
});

$('btn-login').addEventListener('click', async () => {
    const email = $('auth-email').value.trim();
    const pass  = $('auth-password').value;
    $('auth-error').textContent = '';
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch(e) { $('auth-error').textContent = 'Chyba: ' + e.message; }
});

$('btn-register').addEventListener('click', async () => {
    const nick  = $('auth-nickname').value.trim();
    const email = $('auth-email').value.trim();
    const pass  = $('auth-password').value;
    $('auth-error').textContent = '';
    if (!nick)  { $('auth-error').textContent = 'Zadej přezdívku!'; return; }
    if (!email) { $('auth-error').textContent = 'Zadej e-mail!'; return; }
    if (pass.length < 6) { $('auth-error').textContent = 'Heslo musí mít alespoň 6 znaků!'; return; }
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "hraci", cred.user.uid), {
            email: cred.user.email,
            prezdivka: nick,
            xp: 0,
            dungeony: {},
            cech_id: null,
            cech_zakladatel: false,
            avatar: '⚔️',
            bio: '',
            kraj: '',
            sledovani: [],
            registraci_cas: serverTimestamp(),
            tolary: 0,
            ochutnana_piva: [],
            hospoda_tolary_datum: {},
            tolary_denni: { datum: '', pocet_piv: 0, pocet_hodnoceni: 0 },
            denni_ukol: null,
            tydenni_vyzva: null,
            verze_schematu: SCHEMA_VERZE
        });
    } catch(e) { $('auth-error').textContent = 'Chyba: ' + e.message; }
});

$('btn-logout').addEventListener('click', () => signOut(auth));

// ─── DATA UŽIVATELE + AUTO-MIGRACE ───────────────────────────────────
async function loadUserData() {
    if (!currentUser) return;
    const ref = doc(db, "hraci", currentUser.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
        userData = snap.data();
    } else {
        // Nový hráč – vytvoř dokument s aktuální verzí schématu
        userData = {
            email: currentUser.email,
            prezdivka: currentUser.email.split('@')[0],
            xp: 0,
            dungeony: {},
            cech_id: null,
            cech_zakladatel: false,
            tolary: 0,
            ochutnana_piva: [],
            hospoda_tolary_datum: {},
            tolary_denni: { datum: '', pocet_piv: 0, pocet_hodnoceni: 0 },
            denni_ukol: null,
            tydenni_vyzva: null,
            verze_schematu: SCHEMA_VERZE
        };
        await setDoc(ref, userData);
    }

    // ── AUTO-MIGRACE ──────────────────────────────────────────────────
    // Spustí se tiše při každém přihlášení pokud je hráčova verze zastaralá.
    // Nikdy nepřepisuje existující data, jen doplňuje chybějící pole.
    const aktualniVerze = userData.verze_schematu ?? 0;
    if (aktualniVerze < SCHEMA_VERZE) {
        const opravy = {};

        // v1 → základní pole (pro případ velmi starých účtů)
        if (!userData.prezdivka)           opravy.prezdivka = currentUser.email.split('@')[0];
        if (userData.xp === undefined)     opravy.xp = 0;
        if (!userData.dungeony)            opravy.dungeony = {};
        if (userData.cech_id === undefined) opravy.cech_id = null;

        // v2 → cech_zakladatel
        if (aktualniVerze < 2) {
            if (userData.cech_zakladatel === undefined) opravy.cech_zakladatel = false;
        }

        // v3 → registraci_cas
        if (aktualniVerze < 3) {
            if (userData.registraci_cas === undefined) opravy.registraci_cas = serverTimestamp();
        }

        // v4 → avatar, bio, kraj, sledovani
        if (aktualniVerze < 4) {
            if (userData.avatar === undefined) opravy.avatar = '⚔️';
            if (userData.bio === undefined) opravy.bio = '';
            if (userData.kraj === undefined) opravy.kraj = '';
            if (userData.sledovani === undefined) opravy.sledovani = [];
        }

        // v5 → Tolary (peněženka), denní úkoly, týdenní výzvy
        if (aktualniVerze < 5) {
            if (userData.tolary === undefined)              opravy.tolary = 0;
            if (userData.ochutnana_piva === undefined)      opravy.ochutnana_piva = [];
            if (userData.hospoda_tolary_datum === undefined) opravy.hospoda_tolary_datum = {};
            if (userData.tolary_denni === undefined)        opravy.tolary_denni = { datum: '', pocet_piv: 0, pocet_hodnoceni: 0 };
            if (userData.denni_ukol === undefined)          opravy.denni_ukol = null;
            if (userData.tydenni_vyzva === undefined)       opravy.tydenni_vyzva = null;
        }

        // ← sem přidávej nové verze migrace:
        // if (aktualniVerze < 6) { opravy.nove_pole = defaultniHodnota; }

        opravy.verze_schematu = SCHEMA_VERZE;
        await updateDoc(ref, opravy);
        Object.assign(userData, opravy);
        console.log(`[Migrace] Hráč upgradován z v${aktualniVerze} na v${SCHEMA_VERZE}.`);
    }

    vykresliHeader();
    aktualizujPocetNotifikaci();
    await vykresliDenicek();
}

function vykresliHeader() {
    $('user-nickname-display').textContent = userData.prezdivka || 'Hrdina';
    // Avatar v headeru
    const avatarEl = document.getElementById('user-avatar-display');
    if (avatarEl) avatarEl.textContent = userData.avatar || '⚔️';
    const xp = userData.xp || 0;
    $('user-xp-display').textContent = xp;
    const { lvl, prog } = xpLevel(xp);
    $('user-xp-display').textContent = `${xp} XP  |  Úroveň ${lvl}`;
    $('xp-bar').style.width = prog + '%';
    vykresliTolaryBadge();
}

function vykresliTolaryBadge() {
    const el = $('tolary-badge-pocet');
    if (el) el.textContent = userData.tolary || 0;
}

window.otevritTolaryModal = async function() {
    $('tolary-modal').classList.remove('hidden');
    $('tolary-modal-zustatek').textContent = userData.tolary || 0;
    const box = $('tolary-historie-box');
    box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Načítám...</div>';
    try {
        const snap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "tolary_transakce"),
            orderBy("cas", "desc"), limit(10)
        ));
        if (snap.empty) {
            box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Zatím žádné pohyby.</div>';
            return;
        }
        box.innerHTML = snap.docs.map(d => {
            const t = d.data();
            const cas = t.cas?.toDate ? t.cas.toDate().toLocaleDateString('cs-CZ') : '';
            const znamenko = t.mnozstvi >= 0 ? '+' : '';
            const barva = t.mnozstvi >= 0 ? '#f3d371' : '#e05a5a';
            return `<div class="flex justify-between items-center border-b border-gray-800 py-1">
                <span>${escapeHtml(t.duvod || '')}</span>
                <span style="color:${barva};font-weight:bold;white-space:nowrap;margin-left:8px;">${znamenko}${t.mnozstvi} <span class="text-gray-600">· ${cas}</span></span>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = `<div style="color:#e05a5a">⚠️ Chyba: ${escapeHtml(e.message)}</div>`;
    }
};

// ─── NOTIFIKACE (zvonek) ──────────────────────────────────────────────
async function aktualizujPocetNotifikaci() {
    if (!currentUser) return;
    try {
        const snap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "notifikace"),
            where("precteno", "==", false), limit(20)
        ));
        const badge = $('notifikace-badge');
        if (snap.size > 0) { badge.textContent = snap.size; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    } catch (e) { console.warn('Chyba počtu notifikací:', e.message); }
}

window.otevritNotifikaceModal = async function() {
    $('notifikace-modal').classList.remove('hidden');
    const box = $('notifikace-box');
    box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Načítám...</div>';
    try {
        const snap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "notifikace"),
            orderBy("cas", "desc"), limit(20)
        ));
        if (snap.empty) {
            box.innerHTML = '<div class="text-gray-600 italic text-center py-2">😴 Zatím žádné zprávy.</div>';
        } else {
            box.innerHTML = snap.docs.map(d => {
                const n = d.data();
                const cas = n.cas?.toDate ? n.cas.toDate().toLocaleDateString('cs-CZ') : '';
                return `<div class="border-b border-gray-800 py-2">
                    <div>${escapeHtml(n.text || '')}</div>
                    <div class="text-gray-600" style="font-size:0.62rem;">${cas}</div>
                </div>`;
            }).join('');
        }
        // Označ vše jako přečtené
        const neprectene = snap.docs.filter(d => d.data().precteno === false);
        if (neprectene.length > 0) {
            const batch = writeBatch(db);
            neprectene.forEach(d => batch.update(d.ref, { precteno: true }));
            await batch.commit();
        }
        $('notifikace-badge').classList.add('hidden');
    } catch (e) {
        box.innerHTML = `<div style="color:#e05a5a">⚠️ Chyba: ${escapeHtml(e.message)}</div>`;
    }
};

// ─── PIVA ─────────────────────────────────────────────────────────────
let schvalenaPiva = new Set(); // množina schválených piv pro validaci při zápisu

async function nactiPiva() {
    try {
        const snap = await getDocs(collection(db, "vsechna_piva"));
        let piva = [...ZAKLAD_PIV];
        snap.forEach(d => { if (d.data().nazev) piva.push(d.data().nazev); });
        const unikatni = [...new Set(piva)].sort();
        schvalenaPiva = new Set(unikatni); // ulož pro validaci
        $('seznam-piv').innerHTML = unikatni
            .map(p => `<option value="${p.replace(/"/g, '&quot;')}">`).join('');
    } catch (e) { console.error("Chyba načítání piv:", e); }
}

// ─── DENÍČEK ──────────────────────────────────────────────────────────
let grafInstance = null;
let grafData = {};     // { nazevPiva: count }
let grafTyp = 'bar';

window.prepnoutGraf = (typ) => {
    grafTyp = typ;
    $('btn-graf-bar').classList.toggle('active', typ === 'bar');
    $('btn-graf-pie').classList.toggle('active', typ === 'pie');
    vykresliGraf(grafData);
};

const GRAF_BARVY = [
    '#f6e05e','#ed8936','#fc8181','#68d391','#76e4f7',
    '#b794f4','#fbb6ce','#90cdf4','#faf089','#c6f6d5'
];

function vykresliGraf(pocty) {
    grafData = pocty;
    const canvas = $('graf-piv');
    const prazdny = $('graf-prazdny');

    const entries = Object.entries(pocty).sort((a,b) => b[1]-a[1]).slice(0, 10);

    if (entries.length === 0) {
        canvas.style.display = 'none';
        prazdny.classList.remove('hidden');
        if (grafInstance) { grafInstance.destroy(); grafInstance = null; }
        return;
    }

    canvas.style.display = 'block';
    prazdny.classList.add('hidden');

    const labels = entries.map(([k]) => k);
    const data   = entries.map(([,v]) => v);
    const colors = entries.map((_, i) => GRAF_BARVY[i % GRAF_BARVY.length]);

    if (grafInstance) grafInstance.destroy();

    const ctx = canvas.getContext('2d');
    grafInstance = new Chart(ctx, {
        type: grafTyp === 'pie' ? 'doughnut' : 'bar',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderColor: colors.map(c => c + 'cc'),
                borderWidth: 1,
                borderRadius: grafTyp === 'bar' ? 4 : 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: grafTyp === 'pie',
                    labels: {
                        color: '#d1d5db',
                        font: { family: 'Cinzel', size: 10 },
                        boxWidth: 12,
                    }
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ` ${ctx.parsed}× vypito`
                    },
                    bodyFont: { family: 'Cinzel' },
                    titleFont: { family: 'Bangers', size: 14 }
                }
            },
            scales: grafTyp === 'bar' ? {
                x: {
                    ticks: { color: '#9ca3af', font: { family: 'Cinzel', size: 9 }, maxRotation: 35 },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                },
                y: {
                    ticks: { color: '#9ca3af', font: { family: 'Cinzel', size: 9 }, stepSize: 1 },
                    grid: { color: 'rgba(255,255,255,0.08)' },
                    beginAtZero: true
                }
            } : {}
        }
    });
}
// Cursor pro stránkování kroniky
let posledniLogDoc = null;
let celkemZobrazeno = 0;
const LOG_STRANKA = 50;

function renderLogZapis(d, idx, logBox) {
    const z = d.data();
    const casObj = z.cas?.toDate ? z.cas.toDate() : null;
    const datum = casObj ? casObj.toLocaleDateString('cs-CZ') : '—';
    const cas   = casObj ? casObj.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}) : '';
    const spolecneHtml = z.spolecne_s
        ? '<span class="spolecne-badge"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-clink"/></svg> ' + z.spolecne_s + '</span>'
        : '';

    const div = document.createElement('div');
    div.className = 'log-item fade-in';
    div.innerHTML =
        '<div class="flex justify-between items-start gap-1">' +
            '<div class="min-w-0">' +
                '<span class="text-yellow-400 font-bold"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-mug"/></svg> ' + (z.pivo || '—') + '</span>' +
                '<span class="text-gray-400"> @ ' + (z.hospoda || '—') + '</span>' +
                '<span class="block text-gray-600 text-[10px] mt-0.5">' +
                    datum + (cas ? ' · ' + cas : '') +
                '</span>' +
                (spolecneHtml ? '<span class="block mt-1">' + spolecneHtml + '</span>' : '') +
            '</div>' +
            '<div class="log-akce flex-shrink-0">' +
                (idx === 0 ? '<button class="log-btn log-btn-repeat" title="Zopakovat zápis">🔁</button>' : '') +
                '<button class="log-btn log-btn-delete" title="Smazat záznam">🗑️</button>' +
            '</div>' +
        '</div>';

    if (idx === 0) {
        div.querySelector('.log-btn-repeat').addEventListener('click', () => {
            zopakovatzapis(z.pivo, z.hospoda, d.id);
        });
    }
    div.querySelector('.log-btn-delete').addEventListener('click', () => {
        smazatZapis(d.id, d.ref, z);
    });

    logBox.appendChild(div);
}

async function vykresliDenicek() {
    // Dungeony
    const dBox = $('seznam-dungeonu');
    if (userData.dungeony && Object.keys(userData.dungeony).length > 0) {
        const sorted = Object.entries(userData.dungeony).sort((a, b) => b[1] - a[1]);
        dBox.innerHTML = sorted.map(([n, p]) => {
            const star = p >= 10 ? '🌟' : p >= 5 ? '⭐' : '🔸';
            const nazev = n.replace(/_/g, '.');
            return `<div class="log-item flex justify-between"><span>${star} ${nazev}</span><span class="text-yellow-500">${p}× návštěv</span></div>`;
        }).join('');
    } else {
        dBox.innerHTML = '<div class="text-gray-600 italic text-center py-2">Žádné dungeony zatím nenavštíveny.</div>';
    }

    // Reset stránkování
    posledniLogDoc = null;
    celkemZobrazeno = 0;
    const logBox = $('seznam-piv-log');
    logBox.innerHTML = '';
    hide('btn-nacist-starsi');
    $('log-pocet-badge').textContent = '';

    try {
        // Graf: načti až 500 záznamů pro přesné statistiky
        const grafSnap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "log_piv"),
            orderBy("cas", "desc"),
            limit(500)
        ));

        if (grafSnap.empty) {
            logBox.innerHTML = '<div class="text-gray-600 italic text-center py-2">Deník je prázdný.</div>';
            vykresliGraf({});
            return;
        }

        // Graf
        const pocty = {};
        grafSnap.docs.forEach(d => {
            const pivo = d.data().pivo;
            if (pivo) pocty[pivo] = (pocty[pivo] || 0) + 1;
        });
        vykresliGraf(pocty);

        // Osobní statistiky + odznaky
        const stats = vypoctiStatsZLogy(grafSnap.docs);
        posledniStats = stats;
        vykresliOsobniStats(stats);
        zkontrolujAVykresliOdznaky(stats);

        // Zobraz první stránku (LOG_STRANKA zápisů)
        const prvniStranka = grafSnap.docs.slice(0, LOG_STRANKA);
        prvniStranka.forEach((d, idx) => renderLogZapis(d, idx, logBox));
        celkemZobrazeno = prvniStranka.length;
        posledniLogDoc  = prvniStranka[prvniStranka.length - 1];

        $('log-pocet-badge').textContent = celkemZobrazeno + ' zápisů';

        // Pokud je víc než první stránka → zobraz tlačítko
        if (grafSnap.docs.length > LOG_STRANKA) {
            // Zbývající z předem načtených
            const zbytek = grafSnap.docs.slice(LOG_STRANKA);
            $('btn-nacist-starsi').classList.remove('hidden');
            $('btn-nacist-starsi').onclick = async () => {
                // Zobraz všechny zbývající z grafu (byly načteny)
                const offset = celkemZobrazeno;
                zbytek.forEach((d, idx) => renderLogZapis(d, offset + idx === 0 ? 0 : offset + idx, logBox));
                celkemZobrazeno += zbytek.length;
                $('log-pocet-badge').textContent = celkemZobrazeno + ' zápisů';
                posledniLogDoc = zbytek[zbytek.length - 1];
                hide('btn-nacist-starsi');

                // Pokud bylo přesně 500 → může být ještě víc ve Firestore
                if (grafSnap.docs.length === 500) {
                    await nacistDalsiStranku(logBox);
                }
            };
        } else if (grafSnap.docs.length === 500) {
            // Přesně 500 = může být víc
            $('btn-nacist-starsi').classList.remove('hidden');
            $('btn-nacist-starsi').onclick = () => nacistDalsiStranku(logBox);
        }

    } catch (e) {
        logBox.innerHTML = '<div class="text-red-500 text-xs">Chyba načítání deníčku.</div>';
    }
}

async function nacistDalsiStranku(logBox) {
    if (!posledniLogDoc) return;
    hide('btn-nacist-starsi');
    try {
        const q = query(
            collection(db, "hraci", currentUser.uid, "log_piv"),
            orderBy("cas", "desc"),
            startAfter(posledniLogDoc),
            limit(LOG_STRANKA)
        );
        const snap = await getDocs(q);
        if (snap.empty) return;

        snap.docs.forEach((d, idx) => renderLogZapis(d, celkemZobrazeno + idx, logBox));
        celkemZobrazeno += snap.docs.length;
        posledniLogDoc = snap.docs[snap.docs.length - 1];
        $('log-pocet-badge').textContent = celkemZobrazeno + ' zápisů';

        if (snap.docs.length === LOG_STRANKA) {
            $('btn-nacist-starsi').classList.remove('hidden');
            $('btn-nacist-starsi').onclick = () => nacistDalsiStranku(logBox);
        }
    } catch(e) { notify('Chyba načítání: ' + e.message); }
}

// ─── MAPA ─────────────────────────────────────────────────────────────
function initMap() {
    if (map) return;
    map = L.map('map').setView([49.8, 15.5], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM'
    }).addTo(map);

    map.on('locationfound', onLocationFound);
    map.on('locationerror', () => notify('Nepodařilo se zjistit polohu. Povol lokaci v prohlížeči.'));
}

function renderDungeonyNaMapu(elements) {
    elements.forEach(h => {
        const hLat = h.lat ?? h.center?.lat;
        const hLon = h.lon ?? h.center?.lon;
        if (!hLat || !hLon) return;
        const n = h.tags?.name || 'Krčma';
        const p = (userData.dungeony && userData.dungeony[n]) || 0;
        const trida = p >= 5 ? 'dungeon-pin--visited' : p > 0 ? 'dungeon-pin--partial' : 'dungeon-pin--new';
        const icon = L.divIcon({
            html: `<div class="dungeon-pin ${trida}"><span class="dungeon-pin__icon"><svg class="pd-ico" style="width:18px;height:18px"><use href="#ic-mug"/></svg></span></div>`,
            className: '', iconSize: [38, 38], iconAnchor: [19, 36]
        });
        L.marker([hLat, hLon], { icon })
            .addTo(map)
            .bindPopup(buildPopup(n, hLat, hLon));
    });
}

function onLocationFound(e) {
    userLatLng = e.latlng;
    L.circle(e.latlng, { radius: 30, color: '#f6e05e', fillOpacity: 0.3 }).addTo(map);

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    // Cache klíč — zaokrouhlení na 2 des. místa ≈ mřížka ~1 km
    // Platnost cache: 30 minut
    const cacheKey = `overpass_${lat.toFixed(2)}_${lng.toFixed(2)}`;
    const CACHE_TTL = 30 * 60 * 1000;
    try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            const { ts, elements } = JSON.parse(cached);
            if (Date.now() - ts < CACHE_TTL) {
                renderDungeonyNaMapu(elements);
                notify('🗺️ Dungeony načteny z cache', 'ok');
                return;
            }
        }
    } catch(_) {}

    const btn = $('btn-hledej');
    btn.disabled = true;
    btn.textContent = '⏳ Načítám dungeony...';

    // Rychlejší Overpass query: jen nody + waye (bez relations), out center qt (quadtile = rychlejší sort)
    const overpassQuery = `[out:json][timeout:15];(
        node["amenity"~"pub|bar|restaurant"](around:2500,${lat},${lng});
        way["amenity"~"pub|bar|restaurant"](around:2500,${lat},${lng});
    );out center qt;`;
    const overpassUrl = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;

    fetch(overpassUrl)
        .then(r => r.json())
        .then(data => {
            renderDungeonyNaMapu(data.elements);
            // Ulož do cache
            try {
                sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), elements: data.elements }));
            } catch(_) {}
        })
        .catch(() => notify('Nepodařilo se načíst hospody.'))
        .finally(() => {
            btn.disabled = false;
            btn.textContent = '🔍 Najít dungeony v okolí';
        });
}

function buildPopup(name, lat, lon) {
    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `<b style="font-family:Cinzel,serif">${name}</b><br>
        <button onclick="window.pickPub('${safeName}',${lat},${lon})"
            style="background:#c05621;color:#fff;padding:4px 8px;border-radius:6px;margin-top:6px;width:100%;font-size:11px;font-weight:bold;font-family:Cinzel,serif;border:none;cursor:pointer;">
            <svg class="pd-ico" style="width:1em;height:1em;vertical-align:middle"><use href="#ic-mug"/></svg> Tady piju!
        </button>`;
}

$('btn-hledej').addEventListener('click', () => {
    if (!map) initMap();
    map.locate({ setView: true, maxZoom: 16 });
});

// Sleduje aktuální pub seanci — návštěva se počítá jen jednou za seanci
let currentPubSession = null; // { pubName, started }

window.pickPub = (n, lat, lng) => {
    $('pub-name-input').value = n;
    $('beer-modal-pub-name').textContent = n;
    currentPubLatLng = L.latLng(lat, lng);
    map.closePopup();
    // Nová hospoda = nová seance
    if (!currentPubSession || currentPubSession.pubName !== n) {
        currentPubSession = { pubName: n, navstevaPocitana: false };
    }
    // Otevři beer modal
    $('beer-modal').classList.remove('hidden');
    $('beer-name-input').focus();
};

$('btn-zavrit-beer-modal').addEventListener('click', () => {
    $('beer-modal').classList.add('hidden');
});

// ─── CLAIM XP ─────────────────────────────────────────────────────────
$('btn-claim').addEventListener('click', async () => {
    const pN = $('pub-name-input').value.trim();
    const bN = $('beer-name-input').value.trim();
    if (!pN || !bN) { notify('Vyber hospodu i pivo!'); return; }
    if (!userLatLng)        { notify('Nejprve zjisti svou polohu tlačítkem Najít dungeony.'); return; }
    if (!currentPubLatLng)  { notify('Klikni na hospodu na mapě!'); return; }

    // Validace — pivo musí být v schváleném seznamu
    if (!schvalenaPiva.has(bN)) {
        notify(`"${bN}" není v seznamu schválených piv. Použij tlačítko ❗ pro návrh nového piva.`);
        return;
    }

    const dist = map.distance(userLatLng, currentPubLatLng);
    if (dist > 150)         { notify(`Jsi příliš daleko (${Math.round(dist)} m). Musíš být blíže než 150 m!`); return; }

    try {
        $('btn-claim').disabled = true;
        $('btn-claim').textContent = '⏳ Zapisuji...';

        const batch = writeBatch(db);

        // Log entry jako subkollekce
        const logRef = doc(collection(db, "hraci", currentUser.uid, "log_piv"));
        batch.set(logRef, {
            pivo: bN, hospoda: pN, cas: serverTimestamp()
        });

        // Globální log aktivit
        const gLogRef = doc(collection(db, "global_log"));
        batch.set(gLogRef, {
            pivo: bN,
            hospoda: pN,
            hrac_uid: currentUser.uid,
            hrac_prezdivka: userData.prezdivka || '—',
            cas: serverTimestamp()
        });

        // Aktualizace hráče — dungeony klíč nesmí obsahovat tečky (Firestore to bere jako cestu)
        const hracRef = doc(db, "hraci", currentUser.uid);
        const bezTecky = pN.replace(/\./g, '_');
        // Návštěva se počítá jen jednou za seanci (první pivo v hospodě)
        const jeNovyNavsteva = !currentPubSession || !currentPubSession.navstevaPocitana;
        const hracUpdate = { xp: increment(100) };
        if (jeNovyNavsteva) {
            hracUpdate[`dungeony.${bezTecky}`] = increment(1);
            if (currentPubSession) currentPubSession.navstevaPocitana = true;
        }
        batch.update(hracRef, hracUpdate);

        await batch.commit();

        // ── TOLARY + ÚKOLY ──────────────────────────────────────────────
        let tolaruZaTentoZapis = 0; // uloží se na log_piv záznam, aby admin mohl při smazání přesně vrátit
        try {
            const dnes = dnesniDatum();
            if (!userData.tolary_denni || userData.tolary_denni.datum !== dnes) {
                userData.tolary_denni = { datum: dnes, pocet_piv: 0, pocet_hodnoceni: 0 };
            }
            userData.tolary_denni.pocet_piv++;
            const poradiPiva = userData.tolary_denni.pocet_piv;
            await updateDoc(hracRef, { tolary_denni: userData.tolary_denni });
            if (poradiPiva === 1) { await udelTolary(5, 'První pivo dne'); tolaruZaTentoZapis += 5; }
            else if (poradiPiva === 2) { await udelTolary(3, 'Druhé pivo dne'); tolaruZaTentoZapis += 3; }

            // Nové pivo objeveno
            if (!(userData.ochutnana_piva || []).includes(bN)) {
                await updateDoc(hracRef, { ochutnana_piva: arrayUnion(bN) });
                userData.ochutnana_piva = [...(userData.ochutnana_piva || []), bN];
                await udelTolary(8, `Nové pivo: ${bN}`);
                tolaruZaTentoZapis += 8;
                await pripoctiUkolProgress('nove_pivo', 1);
            }

            // Nová hospoda / opakovaná návštěva (jen při první pivu v rámci seance)
            if (jeNovyNavsteva) {
                const predPocetNavstev = userData.dungeony?.[bezTecky] || 0;
                if (predPocetNavstev === 0) {
                    await udelTolary(15, `Nová hospoda: ${pN}`);
                    tolaruZaTentoZapis += 15;
                    await updateDoc(hracRef, { [`hospoda_tolary_datum.${bezTecky}`]: dnes });
                    if (!userData.hospoda_tolary_datum) userData.hospoda_tolary_datum = {};
                    userData.hospoda_tolary_datum[bezTecky] = dnes;
                    await pripoctiUkolProgress('nova_hospoda', 1);
                } else {
                    const posledni = userData.hospoda_tolary_datum?.[bezTecky];
                    const dnyOd = posledni ? (Date.now() - new Date(posledni).getTime()) / 86400000 : Infinity;
                    if (dnyOd >= 7) {
                        await udelTolary(3, `Návrat do hospody: ${pN}`);
                        tolaruZaTentoZapis += 3;
                        await updateDoc(hracRef, { [`hospoda_tolary_datum.${bezTecky}`]: dnes });
                        if (!userData.hospoda_tolary_datum) userData.hospoda_tolary_datum = {};
                        userData.hospoda_tolary_datum[bezTecky] = dnes;
                    }
                }
            }

            await pripoctiUkolProgress('pocet_piv', 1);
            await pripoctiTydenniProgress(1);
            posledniStats = null; // vynuť přepočet pro Krčmu

            if (tolaruZaTentoZapis > 0) await updateDoc(logRef, { tolary_ziskano: tolaruZaTentoZapis });
        } catch (eTolary) { console.warn('Chyba Tolary/úkoly:', eTolary.message); }

        // Globální statistiky — increment() nefunguje v batch.set(), musíme použít updateDoc se set+merge zvlášť
        try {
            await setDoc(doc(db, "statistiky_piv", bN), { pocet: increment(1) }, { merge: true });
        } catch(e) {
            await setDoc(doc(db, "statistiky_piv", bN), { pocet: 1 });
        }
        try {
            await setDoc(doc(db, "statistiky_hospod", bezTecky), { pocet: increment(1), nazev: pN }, { merge: true });
        } catch(e) {
            await setDoc(doc(db, "statistiky_hospod", bezTecky), { pocet: 1, nazev: pN });
        }

        // Krajová válka — přičti bod kraji pokud má hráč zvolený kraj
        if (userData.kraj) {
            const mesic = new Date().toISOString().slice(0, 7); // "2025-03"
            const krajRef = doc(db, "kralovstvi", mesic + '_' + userData.kraj);
            try {
                await setDoc(krajRef, {
                    kraj: userData.kraj,
                    mesic: mesic,
                    piv: increment(1)
                }, { merge: true });
                // Příspěvek hráče
                const hracKrajRef = doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid);
                await setDoc(hracKrajRef, {
                    uid: currentUser.uid,
                    kraj: userData.kraj,
                    mesic: mesic,
                    piv: increment(1)
                }, { merge: true });
            } catch(eKraj) { console.warn('Kraj zapis chyba:', eKraj.message); }
        }

        // Cech skóre + válka body
        if (userData.cech_id) {
            const cechRef = doc(db, "cechy", userData.cech_id);
            await updateDoc(cechRef, { skore: increment(1) });
            await pripoctiValecneBody(pN);
        }

        // Detekce spoluhráčů — collection group query přes log_piv všech hráčů
        try {
            const pred5min = new Date(Date.now() - 5 * 60 * 1000);
            const spoluhraciSnap = await getDocs(query(
                collectionGroup(db, "log_piv"),
                where("hospoda", "==", pN),
                where("cas", ">=", Timestamp.fromDate(pred5min))
            ));

            // Filtruj sebe — cesta dokumentu: hraci/{uid}/log_piv/{docId}
            const cizi = spoluhraciSnap.docs.filter(d => d.ref.parent.parent.id !== currentUser.uid);

            if (cizi.length > 0) {
                // Unikátní hráči
                const spoluhraciMap = {};
                for (const d of cizi) {
                    const uid = d.ref.parent.parent.id;
                    if (!spoluhraciMap[uid]) {
                        const hSnap = await getDoc(doc(db, "hraci", uid));
                        if (hSnap.exists()) {
                            spoluhraciMap[uid] = { uid, prezdivka: hSnap.data().prezdivka };
                        }
                    }
                }
                const spoluhraciList = Object.values(spoluhraciMap);

                if (spoluhraciList.length > 0) {
                    const jmena = spoluhraciList.map(s => s.prezdivka).join(', ');
                    await pripoctiUkolProgress('spolecne', 1);

                    // Načti právě zapsaný záznam (nejnovější v mém log_piv)
                    const mojLogSnap = await getDocs(query(
                        collection(db, "hraci", currentUser.uid, "log_piv"),
                        orderBy("cas", "desc"), limit(1)
                    ));

                    if (!mojLogSnap.empty) {
                        // Doplň spoluhráče jen do MÉHO záznamu (cizí log_piv nemůžeme zapisovat)
                        await updateDoc(mojLogSnap.docs[0].ref, {
                            spolecne_s: jmena,
                            spolecne_uids: spoluhraciList.map(s => s.uid)
                        });
                        notify('Zapsáno! +100 XP 🍺  ·  🍻 Piješ s: ' + jmena);
                    } else {
                        notify('Zapsáno! +100 XP 🍺');
                    }
                } else {
                    notify('Zapsáno! +100 XP 🍺');
                }
            } else {
                notify('Zapsáno! +100 XP 🍺');
            }
        } catch(eSpol) {
            console.warn('Detekce spoluhráčů selhala:', eSpol.message);
            notify('Zapsáno! +100 XP 🍺');
        }

        $('beer-name-input').value = '';
        $('beer-modal').classList.add('hidden');
        // Zobraz share tlačítko v deníku
        posledniZapis = { pivo: bN, hospoda: pN };
        const sBtn = $('btn-sdilet-zapis');
        sBtn.classList.remove('hidden');
        sBtn.onclick = async () => {
            const c = await vygenerujPivniKartu(posledniZapis.hospoda, posledniZapis.pivo);
            otevritShareModal(c);
        };
        await loadUserData();
        nactiGlobalniLog(); // refresh live feed
    } catch (e) {
        notify('Chyba: ' + e.message);
    } finally {
        $('btn-claim').disabled = false;
        $('btn-claim').innerHTML = '<svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-mug"/></svg> Zapsat pivo (+100 XP)';
    }
});

// ─── NÁVRH PIVA ───────────────────────────────────────────────────────
$('btn-odeslat-navrh').addEventListener('click', async () => {
    const val = $('navrh-piva-input').value.trim();
    if (!val) { notify('Napiš název piva!'); return; }
    const hospoda = $('pub-name-input').value.trim() || 'Nezadáno';
    try {
        await addDoc(collection(db, "navrhy_piv"), {
            nazev_piva: val,
            hospoda: hospoda,
            navrhl: userData.prezdivka,
            navrhl_uid: currentUser.uid,
            cas: serverTimestamp(),       // čas odeslání návrhu = čas zápisu do deníčku po schválení
            stav: 'ceka_na_schvaleni'
        });
        notify('Návrh odeslán! Velmistr posoudí brzy. Po schválení se pivo zapíše do deníčku s dnešním datem a touto hospodou.');
        zavritModal();
    } catch (e) { notify('Chyba: ' + e.message); }
});

// ─── TABY ─────────────────────────────────────────────────────────────
window.switchTab = (tabName) => {
    ['krcma', 'mapa', 'denik', 'piva', 'cech', 'kralovstvi', 'sin'].forEach(t => {
        $(`tab-${t}`).classList.remove('pd-nav__item--active');
        $(`obsah-${t}`).classList.add('hidden');
    });
    $(`tab-${tabName}`).classList.add('pd-nav__item--active');
    $(`obsah-${tabName}`).classList.remove('hidden');
    if (tabName === 'krcma') vykresliKrcmu();
    if (tabName === 'mapa' && map) setTimeout(() => map.invalidateSize(), 50);
    if (tabName === 'mapa') nactiGlobalniLog();
    if (tabName === 'denik') { vykresliDenicek(); vykresliEditProfil(); nactiSledovane(); }
    if (tabName === 'piva') nactiPivaTab();
    if (tabName === 'cech') nactiVseOkoloCechu();
    if (tabName === 'kralovstvi') nactiKralovstvi();
    if (tabName === 'sin') nactiSinSlavy();
};

// ─── CECH ─────────────────────────────────────────────────────────────
async function nactiVseOkoloCechu() {
    await nactiPozvankyCechu();
    if (userData.cech_id) {
        await vykresliCech();
    } else {
        hide('cech-existuje');
        show('cech-neexistuje');
    }
}

async function nactiPozvankyCechu() {
    if (!userData.email || userData.cech_id) { hide('panel-pozvanek'); return; }
    const q = query(collection(db, "pozvanky"), where("cilovy_email", "==", userData.email));
    const snap = await getDocs(q);
    const panel = $('panel-pozvanek');
    if (snap.empty) { hide('panel-pozvanek'); return; }

    show('panel-pozvanek');
    panel.innerHTML = '<div class="text-xs text-orange-400 uppercase font-bold mb-2">📬 Pozvánky do cechu</div>';
    snap.forEach(d => {
        const p = d.data();
        const card = document.createElement('div');
        card.className = 'bg-black bg-opacity-50 border border-yellow-800 rounded p-2 flex justify-between items-center mb-2 text-xs';
        card.innerHTML = `<span class="text-yellow-400 font-bold">${p.cech_nazev}</span>`;
        const btn = document.createElement('button');
        btn.textContent = '✓ Přijmout';
        btn.className = 'btn-primary px-3 py-1 text-xs';
        btn.dataset.id = d.id;
        btn.dataset.cid = p.cech_id;
        btn.addEventListener('click', () => prijmoutPozvanku(d.id, p.cech_id));
        card.appendChild(btn);
        panel.appendChild(card);
    });
}

async function vykresliCech() {
    hide('cech-neexistuje');
    show('cech-existuje');

    const cSnap = await getDoc(doc(db, "cechy", userData.cech_id));
    if (!cSnap.exists()) {
        // Cech byl zrušen – vyčisti hráče
        await updateDoc(doc(db, "hraci", currentUser.uid), { cech_id: null, cech_zakladatel: false });
        userData.cech_id = null; userData.cech_zakladatel = false;
        hide('cech-existuje'); show('cech-neexistuje');
        return;
    }
    const cech = cSnap.data();
    $('cech-nazev-zobrazeni').textContent = cech.nazev;
    $('cech-skore-zobrazeni').textContent = cech.skore ?? 0;

    const jeZakladatel = cech.zakladatel === currentUser.uid;
    $('cech-role-display').innerHTML = jeZakladatel
        ? '<svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-crown"/></svg> Zakladatel cechu'
        : '<svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-banner"/></svg> Člen cechu';

    // Tlačítko rozpustit jen pro zakladatele, pozvat také jen pro zakladatele
    if (jeZakladatel) { show('btn-rozpustit-cech'); show('panel-pozvat'); }
    else              { hide('btn-rozpustit-cech'); hide('panel-pozvat'); }
    // Panel vyhlásit válku vidí všichni členové cechu (řídí se stavem aktivních válek)

    // Žebříček členů
    await nactiClenyCechu();

    // Války
    await nactiValky();
}

async function nactiClenyCechu() {
    try {
    // Pozn: query bez orderBy aby nevyžadoval composite index ve Firestore
    const q = query(collection(db, "hraci"), where("cech_id", "==", userData.cech_id));
    const snap = await getDocs(q);
    const cSnap = await getDoc(doc(db, "cechy", userData.cech_id));
    const zakladatelUid = cSnap.data().zakladatel;
    const box = $('cech-zebricek');
    if (snap.empty) { box.innerHTML = pdStateEmpty('Prázdná síň', 'V cechu zatím nejsou žádní členové.'); return; }
    // Seřaď podle XP v JS
    const sorted = snap.docs.slice().sort((a,b) => (b.data().xp||0) - (a.data().xp||0));
    box.innerHTML = sorted.map((d, i) => {
        const h = d.data(); const isZ = d.id === zakladatelUid;
        const isMe = d.id === currentUser.uid;
        const { lvl } = xpLevel(h.xp || 0);
        return `<div class="pd-cech-row">
            <div class="pd-avatar-shield" style="width:30px;height:36px;">
                <div class="pd-avatar-shield__inner" style="font-size:0.85rem;">${escapeHtml(h.avatar || '⚔️')}</div>
            </div>
            <div class="flex-grow min-w-0 text-left">
                <span class="${isMe ? '' : 'profil-link'}" ${isMe ? '' : `onclick="otevritProfil('${d.id}')"`}>${i+1}. ${escapeHtml(h.prezdivka || '—')}</span>
                <div style="font-size:0.6rem;color:#9d8b6c;">úroveň ${lvl} · ${h.xp ?? 0} XP</div>
            </div>
            <span class="rank-badge ${isZ ? 'rank-zakladatel' : 'rank-clen'}">${isZ ? 'Zakladatel' : 'Člen'}</span>
        </div>`;
    }).join('');
    } catch(e) { $('cech-zebricek').innerHTML = '<div class="text-red-400 text-xs">Chyba načítání členů: ' + e.message + '</div>'; }
}

// ─── CECH AKCE ────────────────────────────────────────────────────────
$('btn-zalozit-cech').addEventListener('click', async () => {
    const n = $('novy-cech-nazev').value.trim();
    if (!n) { notify('Zadej název cechu!'); return; }
    if (userData.cech_id) { notify('Už jsi v cechu!'); return; }
    try {
        const ref = await addDoc(collection(db, "cechy"), {
            nazev: n, zakladatel: currentUser.uid, skore: 0, zalozen: serverTimestamp()
        });
        await updateDoc(doc(db, "hraci", currentUser.uid), {
            cech_id: ref.id, cech_zakladatel: true
        });
        notify(`Cech "${n}" byl založen!`);
        await loadUserData();
        await nactiVseOkoloCechu();
    } catch (e) { notify('Chyba: ' + e.message); }
});

$('btn-opustit-cech').addEventListener('click', async () => {
    if (!confirm('Opravdu chceš opustit cech?')) return;
    const cechId = userData.cech_id;
    const cSnap = await getDoc(doc(db, "cechy", cechId));
    if (!cSnap.exists()) {
        await updateDoc(doc(db, "hraci", currentUser.uid), { cech_id: null, cech_zakladatel: false });
        userData.cech_id = null;
        await loadUserData(); await nactiVseOkoloCechu(); return;
    }
    const jeZakladatel = cSnap.data().zakladatel === currentUser.uid;

    if (jeZakladatel) {
        // Najdi nejstaršího dalšího člena podle registraci_cas
        const clenoveSnanp = await getDocs(query(
            collection(db, "hraci"),
            where("cech_id", "==", cechId),
            orderBy("registraci_cas", "asc")
        ));
        const ostatni = clenoveSnanp.docs.filter(d => d.id !== currentUser.uid);
        if (ostatni.length === 0) {
            // Nikdo jiný v cechu — cech se automaticky rozpustí
            if (!confirm('Jsi jediný člen cechu. Odchodem cech zanikne. Pokračovat?')) return;
            const batch2 = writeBatch(db);
            const valkyS1 = await getDocs(query(collection(db, "valky"), where("utocnik_id","==",cechId)));
            const valkyS2 = await getDocs(query(collection(db, "valky"), where("obrance_id","==",cechId)));
            valkyS1.forEach(d => batch2.delete(d.ref));
            valkyS2.forEach(d => batch2.delete(d.ref));
            batch2.delete(doc(db, "cechy", cechId));
            batch2.update(doc(db, "hraci", currentUser.uid), { cech_id: null, cech_zakladatel: false });
            await batch2.commit();
            userData.cech_id = null; userData.cech_zakladatel = false;
            notify('Byl jsi poslední člen — cech byl rozpuštěn.');
            await loadUserData(); await nactiVseOkoloCechu(); return;
        }
        // Předej zakladatelství nejstaršímu členovi
        const novyZakladatel = ostatni[0];
        const batch3 = writeBatch(db);
        batch3.update(doc(db, "cechy", cechId), { zakladatel: novyZakladatel.id });
        batch3.update(novyZakladatel.ref, { cech_zakladatel: true });
        batch3.update(doc(db, "hraci", currentUser.uid), { cech_id: null, cech_zakladatel: false });
        await batch3.commit();
        notify('Vedení cechu předáno hráči ' + novyZakladatel.data().prezdivka + '. Opustil jsi cech.');
    } else {
        await updateDoc(doc(db, "hraci", currentUser.uid), { cech_id: null, cech_zakladatel: false });
        notify('Opustil jsi cech.');
        // Zkontroluj jestli cech nezůstal prázdný
        const zbyvajici = await getDocs(query(collection(db, "hraci"), where("cech_id", "==", cechId)));
        if (zbyvajici.empty) {
            await deleteDoc(doc(db, "cechy", cechId));
        }
    }
    userData.cech_id = null;
    await loadUserData();
    await nactiVseOkoloCechu();
});

$('btn-rozpustit-cech').addEventListener('click', async () => {
    if (!confirm('Opravdu rozpustit celý cech? Všichni členové budou vyhozeni a veškerá data cechu smazána!')) return;
    try {
        const cechId = userData.cech_id;
        // Najdi všechny členy a odeber jim cech_id
        const clenoveSnanp = await getDocs(query(collection(db, "hraci"), where("cech_id", "==", cechId)));
        const batch = writeBatch(db);
        clenoveSnanp.forEach(d => {
            batch.update(d.ref, { cech_id: null, cech_zakladatel: false });
        });
        // Smaž aktivní války cechu
        const valkySnap = await getDocs(query(collection(db, "valky"),
            where("utocnik_id", "==", cechId)));
        const valkySnap2 = await getDocs(query(collection(db, "valky"),
            where("obrance_id", "==", cechId)));
        valkySnap.forEach(d => batch.delete(d.ref));
        valkySnap2.forEach(d => batch.delete(d.ref));
        // Smaž cech
        batch.delete(doc(db, "cechy", cechId));
        await batch.commit();
        userData.cech_id = null; userData.cech_zakladatel = false;
        notify('Cech byl rozpuštěn.');
        await loadUserData();
        await nactiVseOkoloCechu();
    } catch (e) { notify('Chyba: ' + e.message); }
});

$('btn-poslat-pozvanku').addEventListener('click', async () => {
    const email = $('pozvanky-email-input').value.trim().toLowerCase();
    if (!email) { notify('Zadej e-mail hráče!'); return; }
    if (email === userData.email) { notify('Nemůžeš pozvat sám sebe!'); return; }

    // Zkontroluj, zda hráč existuje
    const q = query(collection(db, "hraci"), where("email", "==", email));
    const snap = await getDocs(q);
    if (snap.empty) { notify('Hráč s tímto e-mailem neexistuje.'); return; }

    const hrac = snap.docs[0].data();
    if (hrac.cech_id) { notify('Tento hráč je již v cechu.'); return; }

    // Zkontroluj duplicitní pozvánku
    const qP = query(collection(db, "pozvanky"), where("cilovy_email", "==", email), where("cech_id", "==", userData.cech_id));
    const snapP = await getDocs(qP);
    if (!snapP.empty) { notify('Tomuto hráči jsi už poslal pozvánku.'); return; }

    const cSnap = await getDoc(doc(db, "cechy", userData.cech_id));
    await addDoc(collection(db, "pozvanky"), {
        cilovy_email: email,
        cech_id: userData.cech_id,
        cech_nazev: cSnap.data().nazev,
        od: userData.prezdivka,
        cas: serverTimestamp()
    });
    $('pozvanky-email-input').value = '';
    notify(`Pozvánka odeslána na ${email}!`);
});

async function prijmoutPozvanku(id, cId) {
    try {
        await updateDoc(doc(db, "hraci", currentUser.uid), { cech_id: cId, cech_zakladatel: false });
        await deleteDoc(doc(db, "pozvanky", id));
        userData.cech_id = cId;
        notify('Přijal jsi pozvánku do cechu!');
        await loadUserData();
        await nactiVseOkoloCechu();
    } catch (e) { notify('Chyba: ' + e.message); }
}

// ─── CECHOVNÍ VÁLKY ───────────────────────────────────────────────────
async function nactiValky() {
    const cechId = userData.cech_id;
    if (!cechId) return;

    // Načti války kde jsme útočník nebo bránce
    const [qU, qO] = await Promise.all([
        getDocs(query(collection(db, "valky"), where("utocnik_id", "==", cechId))),
        getDocs(query(collection(db, "valky"), where("obrance_id", "==", cechId)))
    ]);

    const valky = [];
    qU.forEach(d => valky.push({ id: d.id, ...d.data(), mujSmer: 'utocnik' }));
    qO.forEach(d => valky.push({ id: d.id, ...d.data(), mujSmer: 'obrance' }));

    const box = $('panel-valky');
    const aktivni = valky.filter(v => v.stav === 'aktivni');
    const cekajici = valky.filter(v => v.stav === 'ceka');

    // Ukážeme selector pro vyhlášení války, pokud nemáme aktivní válku — pro VŠECHNY členy cechu
    if (aktivni.length === 0) {
        show('panel-vyhlasit-valku');
        await nactiCechyProValku(cechId);
    } else {
        hide('panel-vyhlasit-valku');
    }

    if (valky.length === 0) {
        box.innerHTML = pdStateSleep('Sudovous podřimuje', 'Žádné aktivní ani čekající války.');
        return;
    }

    box.innerHTML = '';
    for (const v of [...aktivni, ...cekajici]) {
        // Zjisti jméno soupeře
        const soupeřId = v.mujSmer === 'utocnik' ? v.obrance_id : v.utocnik_id;
        const soupeřSnap = await getDoc(doc(db, "cechy", soupeřId));
        const soupeřNazev = soupeřSnap.exists() ? soupeřSnap.data().nazev : 'Neznámý cech';

        const nashBodu = v.mujSmer === 'utocnik' ? (v.utocnik_bodu ?? 0) : (v.obrance_bodu ?? 0);
        const jichBodu = v.mujSmer === 'utocnik' ? (v.obrance_bodu ?? 0) : (v.utocnik_bodu ?? 0);
        const totalBodu = nashBodu + jichBodu || 1;
        const nashPct = Math.round(nashBodu / totalBodu * 100);
        const jichPct = 100 - nashPct;

        const konecTs = v.konec?.toDate ? v.konec.toDate() : null;
        const konecStr = konecTs ? konecTs.toLocaleDateString('cs-CZ') : '—';

        const card = document.createElement('div');
        card.className = 'war-card fade-in';
        // Tlačítko přijmout výzvu vidí jakýkoliv člen obranného cechu
        const muzePrijmout = v.stav === 'ceka' && v.mujSmer === 'obrance';
        card.innerHTML = `
            <div class="flex justify-between items-center mb-1">
                <span class="text-orange-400 font-bold"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-banner"/></svg> vs. ${soupeřNazev}</span>
                <span class="text-[10px] ${v.stav === 'aktivni' ? 'text-green-400' : 'text-yellow-500'}">
                    ${v.stav === 'aktivni' ? '<svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-streak"/></svg> Aktivní' : '⏳ Čeká na přijetí'}
                </span>
            </div>
            ${v.stav === 'aktivni' ? `
            <div class="war-progress-bar mb-1">
                <div class="war-bar-left" style="width:${nashPct}%"></div>
                <div class="war-bar-right" style="width:${jichPct}%"></div>
            </div>
            <div class="flex justify-between text-[10px] text-gray-400">
                <span>My: ${nashBodu} bodů</span>
                <span>Cíl: ${v.cil_bodu ?? VALKA_CIL_BODU}</span>
                <span>Oni: ${jichBodu} bodů</span>
            </div>
            <div class="text-[10px] text-gray-600 mt-1">Konec: ${konecStr}</div>
            ` : ''}
            ${muzePrijmout ? `
            <button class="btn-war w-full py-1 mt-2 text-xs" data-vid="${v.id}"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-banner"/></svg> Přijmout výzvu</button>
            ` : ''}
        `;

        // Přijmout výzvu
        const prijmBtn = card.querySelector('[data-vid]');
        if (prijmBtn) {
            prijmBtn.addEventListener('click', () => prijmoutValku(v.id));
        }

        box.appendChild(card);
    }
}

async function nactiCechyProValku(mojeCechId) {
    const q = query(collection(db, "cechy"), orderBy("skore", "desc"), limit(20));
    const snap = await getDocs(q);
    const sel = $('select-rival-cech');
    sel.innerHTML = '<option value="">— Vyber soupeřský cech —</option>';
    snap.docs.forEach(d => {
        if (d.id === mojeCechId) return;
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = `${d.data().nazev} (${d.data().skore ?? 0} 🍺)`;
        sel.appendChild(opt);
    });
}

$('btn-vyhlasit-valku').addEventListener('click', async () => {
    const rivalId = $('select-rival-cech').value;
    if (!rivalId) { notify('Vyber soupeřský cech!'); return; }
    if (!confirm('Opravdu vyhlásit válku? Soupeř ji musí přijmout.')) return;

    // Zkontroluj, zda už válka neexistuje
    const check1 = await getDocs(query(collection(db, "valky"),
        where("utocnik_id", "==", userData.cech_id),
        where("obrance_id", "==", rivalId)));
    if (!check1.empty) { notify('Tomuto cechu jsi již vyhlásil válku!'); return; }

    try {
        const konec = new Date();
        konec.setDate(konec.getDate() + VALKA_TRVANI_DNI);
        await addDoc(collection(db, "valky"), {
            utocnik_id: userData.cech_id,
            obrance_id: rivalId,
            utocnik_bodu: 0,
            obrance_bodu: 0,
            stav: 'ceka', // čeká na přijetí
            cil_bodu: VALKA_CIL_BODU,
            zahajeno: serverTimestamp(),
            konec: Timestamp.fromDate(konec)
        });
        notify('Válka vyhlášena! Soupeř ji musí přijmout.');
        await nactiValky();
    } catch (e) { notify('Chyba: ' + e.message); }
});

async function prijmoutValku(valkaId) {
    if (!confirm('Přijmout výzvu k válce?')) return;
    await updateDoc(doc(db, "valky", valkaId), { stav: 'aktivni' });
    notify('Válka přijata! Ať začne boj! ⚔️');
    await nactiValky();
}

async function pripoctiValecneBody(hospoda) {
    if (!userData.cech_id) return;
    // Najdi aktivní válku
    const [q1, q2] = await Promise.all([
        getDocs(query(collection(db, "valky"),
            where("utocnik_id", "==", userData.cech_id),
            where("stav", "==", "aktivni"))),
        getDocs(query(collection(db, "valky"),
            where("obrance_id", "==", userData.cech_id),
            where("stav", "==", "aktivni")))
    ]);

    const valky = [];
    q1.forEach(d => valky.push({ id: d.id, smer: 'utocnik' }));
    q2.forEach(d => valky.push({ id: d.id, smer: 'obrance' }));

    for (const v of valky) {
        const pole = v.smer === 'utocnik' ? 'utocnik_bodu' : 'obrance_bodu';
        const vSnap = await getDoc(doc(db, "valky", v.id));
        const vData = vSnap.data();

        // Zkontroluj konec platnosti
        if (vData.konec?.toDate && vData.konec.toDate() < new Date()) {
            // Válka vypršela – vyhodnoť
            await vyhodnotValku(v.id, vData);
            continue;
        }

        const novyBod = (vData[pole] ?? 0) + 1;
        const updateData = { [pole]: novyBod };

        // Kontrola vítěze
        if (novyBod >= (vData.cil_bodu ?? VALKA_CIL_BODU)) {
            updateData.stav = 'skoncila';
            updateData.vitez = userData.cech_id;
            await updateDoc(doc(db, "valky", v.id), updateData);
            // Odměna
            await updateDoc(doc(db, "cechy", userData.cech_id), { skore: increment(10) });
            notify('🏆 Váš cech vyhrál válku! +10 bonusových bodů!');
            await notifikujKonecValky(vData.utocnik_id, vData.obrance_id, userData.cech_id);
        } else {
            await updateDoc(doc(db, "valky", v.id), updateData);
        }
    }
}

async function vyhodnotValku(valkaId, vData) {
    const vitez = (vData.utocnik_bodu ?? 0) >= (vData.obrance_bodu ?? 0)
        ? vData.utocnik_id : vData.obrance_id;
    await updateDoc(doc(db, "valky", valkaId), { stav: 'skoncila', vitez });
    await updateDoc(doc(db, "cechy", vitez), { skore: increment(5) });
    await notifikujKonecValky(vData.utocnik_id, vData.obrance_id, vitez);
}

// Zapíše notifikaci "konec války" všem členům obou zúčastněných cechů.
async function notifikujKonecValky(utocnikId, obranceId, vitezId) {
    try {
        const [snapU, snapO] = await Promise.all([
            getDocs(query(collection(db, "hraci"), where("cech_id", "==", utocnikId))),
            getDocs(query(collection(db, "hraci"), where("cech_id", "==", obranceId)))
        ]);
        const zapisy = [];
        snapU.forEach(d => zapisy.push({ uid: d.id, vyhral: utocnikId === vitezId }));
        snapO.forEach(d => zapisy.push({ uid: d.id, vyhral: obranceId === vitezId }));
        await Promise.all(zapisy.map(z => addDoc(collection(db, "hraci", z.uid, "notifikace"), {
            typ: 'valka',
            text: z.vyhral ? '🏆 Tvůj cech vyhrál válku!' : '⚔️ Tvůj cech prohrál válku.',
            cas: serverTimestamp(),
            precteno: false
        })));
    } catch (e) { console.warn('Chyba notifikace konce války:', e.message); }
}

// ─── SÍŇ SLÁVY ───────────────────────────────────────────────────────
async function nactiSinSlavy() {
    show('sin-loading');
    hide('sin-obsah');

    try {
        // 1. Top hráči podle XP
        const snapHraci = await getDocs(
            query(collection(db, "hraci"), orderBy("xp", "desc"), limit(10))
        );
        const top3 = snapHraci.docs.slice(0, 3);
        const zbytek = snapHraci.docs.slice(3);

        const slotPodia = (d, rank) => {
            if (!d) return `<div style="width:${rank === 1 ? 96 : 88}px;"></div>`;
            const h = d.data();
            const isMe = d.id === currentUser.uid;
            const trida = rank === 1 ? 'zlato' : rank === 2 ? 'stribro' : 'bronz';
            const avatarGrad = rank === 1 ? '' : rank === 2
                ? 'background:linear-gradient(160deg,#b0b6c0,#6a7180);'
                : 'background:linear-gradient(160deg,#c98a5a,#8a5730);';
            const w = rank === 1 ? 56 : 48, h2 = rank === 1 ? 64 : 54;
            const pad = rank === 1 ? '16px 0 10px' : rank === 2 ? '12px 0 8px' : '9px 0 6px';
            return `<div style="text-align:center;width:${rank === 1 ? 96 : 88}px;">
                ${rank === 1 ? '<div style="font-size:16px;margin-bottom:1px;">👑</div>' : ''}
                <div class="pd-avatar-shield" style="width:${w}px;height:${h2}px;margin:0 auto 6px;${avatarGrad}${rank === 1 ? 'filter:drop-shadow(0 0 10px rgba(255,190,50,.7));' : ''}">
                    <div class="pd-avatar-shield__inner" style="font-size:${rank === 1 ? '1.6rem' : '1.3rem'};">${escapeHtml(h.avatar || '⚔️')}</div>
                </div>
                <div style="font-weight:${rank === 1 ? 700 : 600};color:${rank === 1 ? '#ffd868' : '#e6d4b0'};font-size:${rank === 1 ? '12px' : '11px'};line-height:1.1;">${escapeHtml(h.prezdivka || '—')}${isMe ? ' 👈' : ''}</div>
                <div class="pd-podium pd-podium--${trida}" style="padding:${pad};">
                    <div class="pd-podium__num">${rank}</div>
                    <div class="pd-podium__score">${h.xp ?? 0}</div>
                </div>
            </div>`;
        };
        const podiumHtml = top3.length > 0
            ? `<div style="display:flex;align-items:flex-end;justify-content:center;gap:8px;padding:2px 0 12px;">
                ${slotPodia(top3[1], 2)}${slotPodia(top3[0], 1)}${slotPodia(top3[2], 3)}
            </div>`
            : '';

        const radkyHraci = zbytek.map((d, i) => {
            const h = d.data();
            const isMe = d.id === currentUser.uid;
            const jmeno = isMe
                ? `${h.prezdivka ?? '—'} 👈`
                : `<span class="profil-link" onclick="otevritProfil('${d.id}')">${h.prezdivka ?? '—'}</span>`;
            return `<div class="sin-row${isMe ? ' sin-row--rare' : ''}">
                <span>${i + 4}. ${jmeno}</span>
                <span class="${isMe ? '' : 'text-yellow-500'}">${h.xp ?? 0} XP</span>
            </div>`;
        });
        // Najdi moji pozici pokud nejsem v top 10
        let mojePoziceHrac = '';
        if (!snapHraci.docs.find(d => d.id === currentUser.uid)) {
            const vsichniSnap = await getDocs(
                query(collection(db, "hraci"), orderBy("xp", "desc"))
            );
            const idx = vsichniSnap.docs.findIndex(d => d.id === currentUser.uid);
            if (idx >= 0) {
                mojePoziceHrac = `<div class="sin-row sin-row--rare mt-1">
                    <span>... ${idx+1}. ${escapeHtml(userData.prezdivka || '—')} 👈</span>
                    <span>${userData.xp ?? 0} XP</span>
                </div>`;
            }
        }
        $('sin-hraci').innerHTML = podiumHtml + radkyHraci.join('') + mojePoziceHrac;

        // 2. Top cechy podle skóre
        const snapCechy = await getDocs(
            query(collection(db, "cechy"), orderBy("skore", "desc"), limit(10))
        );
        const radkyCechy = snapCechy.docs.map((d, i) => {
            const c = d.data();
            const isMe = d.id === userData.cech_id;
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
            return `<div class="sin-row${isMe ? ' me' : ''}">
                <span>${medal} ${c.nazev}${isMe ? ' <svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-shield"/></svg>' : ''}</span>
                <span class="text-yellow-500">${c.skore ?? 0} <svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-mug"/></svg></span>
            </div>`;
        });
        if (radkyCechy.length === 0) radkyCechy.push('<div class="sin-row"><span class="text-gray-600 italic">Žádné cechy zatím.</span></div>');
        $('sin-cechy').innerHTML = radkyCechy.join('');

        // 3. Top piva globálně – agregujeme z log_piv všech hráčů
        // Kvůli Firestore limitům čteme log ze subcollection group query
        // (vyžaduje index "collectionGroup" – fallback na vsechna_piva statistiky)
        // Místo toho použijeme kolekci "statistiky_piv" kterou plníme při zápisu
        const snapPiva = await getDocs(
            query(collection(db, "statistiky_piv"), orderBy("pocet", "desc"), limit(10))
        );
        if (snapPiva.empty) {
            $('sin-piva').innerHTML = '<div class="sin-row"><span class="text-gray-600 italic">Data se shromažďují... zapiš první pivo!</span></div>';
        } else {
            $('sin-piva').innerHTML = snapPiva.docs.map((d, i) => {
                const p = d.data();
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                return `<div class="sin-row">
                    <span>${medal} ${d.id}</span>
                    <span class="text-yellow-500">${p.pocet}× vypito</span>
                </div>`;
            }).join('');
        }

        // 4. Top hospody globálně – ze statistiky_hospod
        const snapHospody = await getDocs(
            query(collection(db, "statistiky_hospod"), orderBy("pocet", "desc"), limit(10))
        );
        if (snapHospody.empty) {
            $('sin-hospody').innerHTML = '<div class="sin-row"><span class="text-gray-600 italic">Data se shromažďují... zapiš první pivo!</span></div>';
        } else {
            $('sin-hospody').innerHTML = snapHospody.docs.map((d, i) => {
                const h = d.data();
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const nazev = h.nazev || d.id.replace(/_/g, '.'); // preferuj uložený název, fallback na ID
                return `<div class="sin-row">
                    <span>${medal} ${nazev}</span>
                    <span class="text-yellow-500">${h.pocet}× navštíveno</span>
                </div>`;
            }).join('');
        }

        // Nejlépe hodnocená piva
        const snapHodnocena = await getDocs(collection(db, "statistiky_piv"));
        const hodnocenaPiva = snapHodnocena.docs
            .map(d => ({ nazev: d.id, ...d.data() }))
            .filter(p => (p.hodnoceni_pocet || 0) >= 1)
            .sort((a, b) => (b.hodnoceni_prumerne || 0) - (a.hodnoceni_prumerne || 0))
            .slice(0, 10);

        if (hodnocenaPiva.length === 0) {
            $('sin-hodnocena-piva').innerHTML = '<div class="sin-row"><span class="text-gray-600 italic">Zatím nikdo nehodnotil... buď první!</span></div>';
        } else {
            $('sin-hodnocena-piva').innerHTML = hodnocenaPiva.map((p, i) => {
                const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
                const hviezdy = '★'.repeat(Math.round(p.hodnoceni_prumerne || 0)) + '☆'.repeat(5 - Math.round(p.hodnoceni_prumerne || 0));
                return `<div class="sin-row">
                    <span>${medal} ${escapeHtml(p.nazev)}</span>
                    <span class="text-yellow-400">${hviezdy} <span class="text-gray-500 text-[10px]">${(p.hodnoceni_prumerne||0).toFixed(1)} (${p.hodnoceni_pocet||0})</span></span>
                </div>`;
            }).join('');
        }

        hide('sin-loading');
        show('sin-obsah');
    } catch (e) {
        $('sin-loading').innerHTML = pdStateError('Chyba načítání: ' + e.message);
    }
}




// ─── GLOBÁLNÍ LOG ─────────────────────────────────────────────────────
function formatGlobalLogItem(d) {
    const z = d.data();
    const casObj = z.cas?.toDate ? z.cas.toDate() : null;
    const casStr = casObj ? casObj.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'}) + ' · ' + casObj.toLocaleDateString('cs-CZ') : '—';
    const jmeno = z.hrac_uid === currentUser?.uid
        ? `<span class="text-yellow-400 font-bold">${z.hrac_prezdivka}</span>`
        : `<span class="profil-link" onclick="otevritProfil('${z.hrac_uid}')">${z.hrac_prezdivka}</span>`;
    return `<div class="glog-item">
        ${jmeno} <span class="text-gray-400">vypil</span> <span class="text-orange-300 font-bold">🍺 ${z.pivo || '—'}</span>
        <span class="text-gray-500"> @ ${z.hospoda || '—'}</span>
        <span class="block text-gray-600 text-[10px] mt-0.5">${casStr}</span>
    </div>`;
}

async function nactiGlobalniLog() {
    const box = $('global-log-box');
    try {
        const snap = await getDocs(query(
            collection(db, "global_log"),
            orderBy("cas", "desc"),
            limit(5)
        ));
        if (snap.empty) {
            box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Zatím nikdo nic nevypil.</div>';
            return;
        }
        box.innerHTML = snap.docs.map(formatGlobalLogItem).join('');
    } catch(e) {
        box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Nelze načíst log.</div>';
    }
}

async function nactiGlobalniLogFull() {
    const box = $('global-log-modal-box');
    box.innerHTML = '<div class="text-gray-600 italic text-center py-4">Načítám...</div>';
    try {
        const snap = await getDocs(query(
            collection(db, "global_log"),
            orderBy("cas", "desc"),
            limit(100)
        ));
        if (snap.empty) {
            box.innerHTML = '<div class="text-gray-600 italic text-center py-4">Zatím nikdo nic nevypil.</div>';
            return;
        }
        box.innerHTML = snap.docs.map(formatGlobalLogItem).join('');
    } catch(e) {
        box.innerHTML = '<div class="text-red-400 text-xs text-center py-2">Chyba: ' + e.message + '</div>';
    }
}

$('btn-global-log-vice').addEventListener('click', () => {
    $('global-log-modal').classList.remove('hidden');
    nactiGlobalniLogFull();
});

$('btn-zavrit-global-log').addEventListener('click', () => {
    $('global-log-modal').classList.add('hidden');
});
window.zopakovatzapis = async (pivo, hospoda, posledniId) => {
    if (!pivo || !hospoda) { notify('Chybí data záznamu!'); return; }
    if (!userLatLng) { notify('Nejprve zjisti polohu na záložce Mapa.'); return; }
    if (!currentPubLatLng) {
        // Pokus se najít hospodu podle jména — uživatel musí být na mapě
        notify('Přejdi na Mapu, klikni na hospodu "' + hospoda + '" a pak zkus znovu.');
        return;
    }

    const dist = map.distance(userLatLng, currentPubLatLng);
    if (dist > 150) {
        notify('Jsi příliš daleko (' + Math.round(dist) + ' m). Musíš být v hospodě!');
        return;
    }

    const pubNazev = $('pub-name-input').value.trim();
    if (pubNazev && pubNazev !== hospoda) {
        notify('Vybraná hospoda (' + pubNazev + ') se neshoduje s původní (' + hospoda + ').');
        return;
    }

    if (!confirm('Zopakovat zápis: ' + pivo + ' @ ' + hospoda + '?')) return;

    try {
        const batch = writeBatch(db);
        const logRef = doc(collection(db, "hraci", currentUser.uid, "log_piv"));
        batch.set(logRef, { pivo, hospoda, cas: serverTimestamp() });
        const gLogRef2 = doc(collection(db, "global_log"));
        batch.set(gLogRef2, {
            pivo,
            hospoda,
            hrac_uid: currentUser.uid,
            hrac_prezdivka: userData.prezdivka || '—',
            cas: serverTimestamp()
        });
        const bezTecky = hospoda.replace(/\./g, '_');
        batch.update(doc(db, "hraci", currentUser.uid), {
            xp: increment(100),
            ['dungeony.' + bezTecky]: increment(1)
        });
        await batch.commit();

        // Statistiky
        try { await setDoc(doc(db, "statistiky_piv", pivo), { pocet: increment(1) }, { merge: true }); } catch(e) {}
        try { await setDoc(doc(db, "statistiky_hospod", bezTecky), { pocet: increment(1), nazev: hospoda }, { merge: true }); } catch(e) {}
        if (userData.cech_id) {
            await updateDoc(doc(db, "cechy", userData.cech_id), { skore: increment(1) });
            await pripoctiValecneBody(hospoda);
        }
        if (userData.kraj) {
            const mesic = new Date().toISOString().slice(0, 7);
            try { await setDoc(doc(db, "kralovstvi", mesic + '_' + userData.kraj), { kraj: userData.kraj, mesic, piv: increment(1) }, { merge: true }); } catch(e) {}
            try { await setDoc(doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid), { uid: currentUser.uid, kraj: userData.kraj, mesic, piv: increment(1) }, { merge: true }); } catch(e) {}
        }

        notify('Zopakováno! +100 XP 🍺');
        await loadUserData();
    } catch(e) { notify('Chyba: ' + e.message); }
};

// ─── SMAZAT ZÁPIS ─────────────────────────────────────────────────────
window.smazatZapis = async (docId, docRef, z) => {
    if (!confirm('Smazat záznam: ' + (z.pivo || '—') + ' @ ' + (z.hospoda || '—') + '? Odečte -100 XP a odstraní záznam ze statistik.')) return;

    try {
        const batch = writeBatch(db);

        // 1. Smaž log záznam
        batch.delete(docRef);

        // 2. Odečti XP a dungeon návštěvu
        const bezTecky = (z.hospoda || '').replace(/\./g, '_');
        const hracRef = doc(db, "hraci", currentUser.uid);
        const hracOpravy = { xp: increment(-100) };
        if (z.hospoda) {
            const aktualni = (userData.dungeony && userData.dungeony[bezTecky]) || 0;
            if (aktualni > 1) {
                // Odečti návštěvu
                hracOpravy['dungeony.' + bezTecky] = increment(-1);
            } else if (aktualni === 1) {
                // Poslední návštěva — smaž klíč úplně (FieldValue.delete není v batch, použijeme updateDoc po commitu)
                hracOpravy['dungeony.' + bezTecky] = increment(-1);
            }
        }
        batch.update(hracRef, hracOpravy);

        await batch.commit();

        // 3. Globální statistiky (mimo batch)
        if (z.pivo) {
            try {
                const pivSnap = await getDoc(doc(db, "statistiky_piv", z.pivo));
                if (pivSnap.exists() && (pivSnap.data().pocet || 0) > 1) {
                    await updateDoc(doc(db, "statistiky_piv", z.pivo), { pocet: increment(-1) });
                } else if (pivSnap.exists()) {
                    await deleteDoc(doc(db, "statistiky_piv", z.pivo));
                }
            } catch(e) {}
        }
        if (z.hospoda) {
            try {
                const hospSnap = await getDoc(doc(db, "statistiky_hospod", bezTecky));
                if (hospSnap.exists() && (hospSnap.data().pocet || 0) > 1) {
                    await updateDoc(doc(db, "statistiky_hospod", bezTecky), { pocet: increment(-1) });
                } else if (hospSnap.exists()) {
                    await deleteDoc(doc(db, "statistiky_hospod", bezTecky));
                }
            } catch(e) {}
        }

        // 4. Cech skóre
        if (userData.cech_id) {
            try {
                const cechSnap = await getDoc(doc(db, "cechy", userData.cech_id));
                if (cechSnap.exists() && (cechSnap.data().skore || 0) > 0) {
                    await updateDoc(doc(db, "cechy", userData.cech_id), { skore: increment(-1) });
                }
            } catch(e) {}
        }

        // 5. Krajová válka
        if (userData.kraj) {
            const mesic = new Date().toISOString().slice(0, 7);
            try {
                const hkRef = doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid);
                const hkSnap = await getDoc(hkRef);
                if (hkSnap.exists() && (hkSnap.data().piv || 0) > 0) {
                    await updateDoc(hkRef, { piv: increment(-1) });
                    const kRef = doc(db, "kralovstvi", mesic + '_' + userData.kraj);
                    const kSnap = await getDoc(kRef);
                    if (kSnap.exists() && (kSnap.data().piv || 0) > 0) {
                        await updateDoc(kRef, { piv: increment(-1) });
                    }
                }
            } catch(e) {}
        }

        // Pokud hospodský počet klesl na 0, smaž klíč z dungeony mapy
        if (z.hospoda) {
            const bezTecky2 = (z.hospoda || '').replace(/\./g, '_');
            const aktualni2 = (userData.dungeony && userData.dungeony[bezTecky2]) || 0;
            if (aktualni2 <= 1) {
                try {
                        await updateDoc(doc(db, "hraci", currentUser.uid), {
                        ['dungeony.' + bezTecky2]: deleteField()
                    });
                } catch(e) {}
            }
        }

        notify('Záznam smazán. -100 XP.');
        await loadUserData();

    } catch(e) { notify('Chyba: ' + e.message); }
};

// ─── EDITACE PROFILU ──────────────────────────────────────────────────
window.toggleEditProfil = () => {
    const ed = $('profil-editace');
    const isHidden = ed.classList.contains('hidden');
    ed.classList.toggle('hidden', !isHidden);
    $('btn-profil-toggle').textContent = isHidden ? 'Zavřít' : 'Upravit';
};

function vykresliEditProfil() {
    $('muj-avatar-display').textContent = userData.avatar || '⚔️';
    $('muj-nick-display').textContent = userData.prezdivka || '—';
    $('muj-bio-display').textContent = userData.bio || '';
    $('muj-kraj-display').textContent = userData.kraj ? '📍 ' + userData.kraj : 'Kraj nezvolén';
    const { lvl } = xpLevel(userData.xp || 0);
    $('muj-level-badge').textContent = lvl;
    $('muj-titul-display').textContent = titulPostavy(lvl);

    // Nastav hodnoty formuláře
    $('edit-prezdivka').value = userData.prezdivka || '';
    $('edit-bio').value = userData.bio || '';
    $('edit-kraj').value = userData.kraj || '';

    // Avatar výběr
    document.querySelectorAll('.avatar-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.avatar === (userData.avatar || '⚔️'));
        el.onclick = () => {
            document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
            el.classList.add('selected');
        };
    });
}

$('btn-ulozit-profil').addEventListener('click', async () => {
    const novyNick = $('edit-prezdivka').value.trim();
    const noveBio = $('edit-bio').value.trim();
    const novyKraj = $('edit-kraj').value;
    const novyAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || userData.avatar || '⚔️';
    const soucasneHeslo = $('edit-heslo-soucasne').value;
    const noveHeslo = $('edit-heslo-nove').value;

    if (!novyNick) { notify('Přezdívka nesmí být prázdná!'); return; }

    try {
        $('btn-ulozit-profil').disabled = true;
        $('btn-ulozit-profil').textContent = '⏳ Ukládám...';

        const opravy = {
            prezdivka: novyNick,
            bio: noveBio,
            avatar: novyAvatar
        };

        // Změna kraje — vymaže body v aktuální krajské válce
        if (novyKraj !== (userData.kraj || '')) {
            if (userData.kraj && novyKraj) {
                if (!confirm('Změna kraje vymaže tvůj příspěvek v aktuální krajské válce. Pokračovat?')) {
                    $('btn-ulozit-profil').disabled = false;
                    $('btn-ulozit-profil').textContent = '💾 Uložit profil';
                    return;
                }
            }
            // Vymaz příspěvek v aktuálním měsíci
            if (userData.kraj) {
                const mesic = new Date().toISOString().slice(0, 7);
                try {
                    await deleteDoc(doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid));
                    // Odečti od krajského součtu
                    const krajRef = doc(db, "kralovstvi", mesic + '_' + userData.kraj);
                    const krajSnap = await getDoc(krajRef);
                    if (krajSnap.exists()) {
                        const staryPrispevek = (await getDoc(doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid)))?.data()?.piv || 0;
                        if (staryPrispevek > 0) {
                            await updateDoc(krajRef, { piv: increment(-staryPrispevek) });
                        }
                    }
                } catch(e) { console.warn('Mazání kraj příspěvku:', e); }
            }
            opravy.kraj = novyKraj;
        }

        await updateDoc(doc(db, "hraci", currentUser.uid), opravy);
        Object.assign(userData, opravy);

        // Změna hesla
        if (soucasneHeslo && noveHeslo) {
            if (noveHeslo.length < 6) { notify('Nové heslo musí mít alespoň 6 znaků!'); return; }
            try {
                const credential = EmailAuthProvider.credential(currentUser.email, soucasneHeslo);
                await reauthenticateWithCredential(currentUser, credential);
                await updatePassword(currentUser, noveHeslo);
                $('edit-heslo-soucasne').value = '';
                $('edit-heslo-nove').value = '';
                notify('Profil i heslo uloženy! ✓');
            } catch(eHeslo) {
                if (eHeslo.code === 'auth/wrong-password') {
                    notify('Současné heslo je špatně!');
                } else {
                    notify('Chyba změny hesla: ' + eHeslo.message);
                }
                return;
            }
        } else {
            notify('Profil uložen! ✓');
        }

        vykresliHeader();
        vykresliEditProfil();
        toggleEditProfil();

    } catch(e) {
        notify('Chyba: ' + e.message);
    } finally {
        $('btn-ulozit-profil').disabled = false;
        $('btn-ulozit-profil').textContent = '💾 Uložit profil';
    }
});

// ─── SLEDOVÁNÍ ────────────────────────────────────────────────────────
async function nactiSledovane() {
    const box = $('seznam-sledovanych');
    const sledovani = userData.sledovani || [];
    if (sledovani.length === 0) {
        box.innerHTML = '<div class="text-gray-600 italic text-center py-2">Zatím nikoho nesleduješ.</div>';
        return;
    }
    box.innerHTML = '<div class="text-gray-500 italic text-center py-1">Načítám...</div>';
    const rows = [];
    for (const uid of sledovani) {
        try {
            const snap = await getDoc(doc(db, "hraci", uid));
            if (!snap.exists()) continue;
            const h = snap.data();
            const { lvl } = xpLevel(h.xp || 0);
            rows.push('<div class="flex justify-between items-center py-1">' +
                '<span class="profil-link" onclick="otevritProfil(\'' + uid + '\')">'+
                (h.avatar || '⚔️') + ' ' + (h.prezdivka || '—') +
                '</span>' +
                '<span class="text-gray-500">Úr. ' + lvl + '</span>' +
                '</div>');
        } catch(e) {}
    }
    box.innerHTML = rows.length ? rows.join('') : '<div class="text-gray-600 italic text-center py-2">Žádní sledovaní.</div>';
}

// ─── KRÁLOVSTVÍ ───────────────────────────────────────────────────────
window.kliknoutKraj = (kraj) => {
    notify('Kraj: ' + kraj + ' — statistiky načteny v žebříčku.');
};

async function nactiKralovstvi() {
    const mesic = new Date().toISOString().slice(0, 7);

    // Nastav info o resetu
    const pristiMesic = new Date();
    pristiMesic.setMonth(pristiMesic.getMonth() + 1);
    pristiMesic.setDate(1);
    $('kral-reset-info').textContent = 'Aktuální kolo: ' + mesic + '  ·  Reset: 1. ' +
        pristiMesic.toLocaleDateString('cs-CZ', {month:'long', year:'numeric'});

    if (!userData.kraj) {
        show('kral-bez-kraje');
        hide('kral-obsah');
        return;
    }
    hide('kral-bez-kraje');
    show('kral-obsah');

    $('kral-muj-kraj').textContent = '📍 ' + userData.kraj;

    // Načti příspěvek hráče
    try {
        const hracKrajSnap = await getDoc(doc(db, "kralovstvi_hraci", mesic + '_' + currentUser.uid));
        const mojePiv = hracKrajSnap.exists() ? (hracKrajSnap.data().piv || 0) : 0;
        $('kral-muj-prispevek').textContent = mojePiv + ' piv';
    } catch(e) {}

    // Načti všechny kraje v aktuálním měsíci
    try {
        const snap = await getDocs(query(
            collection(db, "kralovstvi"),
            where("mesic", "==", mesic),
            orderBy("piv", "desc")
        ));

        // Načti celkový počet piv pro kraj přihlášeného hráče
        const mojKrajDoc = snap.docs.find(d => d.data().kraj === userData.kraj);
        $('kral-moje-piva').textContent = (mojKrajDoc ? mojKrajDoc.data().piv : 0) + ' 🍺';

        // Žebříček
        const box = $('kral-zebricek');
        if (snap.empty) {
            box.innerHTML = pdStateSleep('Sudovous podřimuje', 'Zatím žádná piva. Začni psát za svůj kraj!');
        } else {
            const max = snap.docs[0].data().piv || 1;
            box.innerHTML = snap.docs.map((d, i) => {
                const k = d.data();
                const isMe = k.kraj === userData.kraj;
                const isVedouci = i === 0;
                const pct = Math.round((k.piv / max) * 100);
                const znacka = isVedouci
                    ? `<svg class="pd-ico" style="width:1.2em;height:1.2em;vertical-align:-3px"><use href="#ic-crown"/></svg>`
                    : (i+1) + '.';
                return `<div class="pd-kraj-row${isVedouci ? ' pd-kraj-row--leading' : ''}">
                    <div class="flex justify-between items-center">
                        <span class="text-sm ${isMe ? 'text-yellow-400 font-bold' : 'text-gray-300'}">${znacka} ${escapeHtml(k.kraj)}${isMe ? ' 👈' : ''}</span>
                        <span class="text-yellow-500 font-bold">${k.piv} <svg class="pd-ico" style="width:0.9em;height:0.9em"><use href="#ic-mug"/></svg></span>
                    </div>
                    <div class="kraj-bar-outer"><div class="kraj-bar-inner" style="width:${pct}%"></div></div>
                </div>`;
            }).join('');
        }

        // Aktualizuj SVG mapu
        snap.docs.forEach(d => {
            const k = d.data();
            const maxPiv = snap.docs[0].data().piv || 1;
            const intenzita = Math.min(k.piv / maxPiv, 1);
            // Obarvi kraj na mapě
            const g = document.querySelector('[data-kraj="' + k.kraj + '"]');
            if (g) {
                const rect = g.querySelector('rect, circle');
                if (rect) {
                    const r = Math.round(26 + intenzita * 100);
                    const g2 = Math.round(26 + intenzita * 60);
                    rect.setAttribute('fill', 'rgb(' + r + ',' + g2 + ',14)');
                }
                const txt = g.querySelector('.kraj-piva-text');
                if (txt) txt.textContent = k.piv + ' 🍺';
            }
        });

    } catch(e) {
        $('kral-zebricek').innerHTML = '<div class="text-red-400 text-xs">Chyba načítání: ' + e.message + '</div>';
    }
}

// ─── HRÁČSKÝ PROFIL ───────────────────────────────────────────────────
window.zavritProfilModal = () => {
    $('profil-modal-overlay').classList.add('hidden');
};

window.otevritProfil = async (uid) => {
    $('profil-modal-overlay').classList.remove('hidden');
    $('profil-loading').classList.remove('hidden');
    $('profil-nazev').textContent = '—';
    $('profil-akce').classList.add('hidden');

    try {
        const snap = await getDoc(doc(db, "hraci", uid));
        if (!snap.exists()) { $('profil-loading').textContent = 'Hráč nenalezen.'; return; }
        const h = snap.data();
        const { lvl, prog } = xpLevel(h.xp || 0);

        $('profil-nazev').textContent = h.prezdivka || '—';
        $('profil-level').textContent = `Úroveň ${lvl}`;
        $('profil-level-num').textContent = lvl;
        $('profil-xp').textContent = `${h.xp || 0} XP`;
        $('profil-xp-bar').style.width = prog + '%';

        // Avatar podle levelu
        const avatary = ['🍺','⚔️','🛡️','🏆','👑','🐉','🌟','💀','🔥','⚡'];
        $('profil-avatar').textContent = avatary[Math.min(lvl - 1, avatary.length - 1)];

        // Cech badge
        if (h.cech_id) {
            const cSnap = await getDoc(doc(db, "cechy", h.cech_id));
            if (cSnap.exists()) {
                $('profil-cech-badge').textContent = `🛡️ ${cSnap.data().nazev}`;
                $('profil-cech-badge').classList.remove('hidden');
            }
        } else {
            $('profil-cech-badge').classList.add('hidden');
        }

        // Statistiky z log_piv
        const logSnap = await getDocs(query(
            collection(db, "hraci", uid, "log_piv"),
            orderBy("cas", "desc"), limit(500)
        ));
        const pocetPiv = logSnap.size;
        const pocetHospod = Object.keys(h.dungeony || {}).length;
        $('profil-pocet-piv').textContent = pocetPiv;
        $('profil-pocet-hospod').textContent = pocetHospod;

        // Oblíbené pivo
        const poctyPiv = {};
        logSnap.docs.forEach(d => {
            const p = d.data().pivo;
            if (p) poctyPiv[p] = (poctyPiv[p] || 0) + 1;
        });
        const oblPivo = Object.entries(poctyPiv).sort((a,b) => b[1]-a[1])[0];
        $('profil-oblibene-pivo').textContent = oblPivo ? `${oblPivo[0]} (${oblPivo[1]}×)` : '—';

        // Oblíbená hospoda
        const dungeony = h.dungeony || {};
        const oblHosp = Object.entries(dungeony).sort((a,b) => b[1]-a[1])[0];
        $('profil-oblibena-hospoda').textContent = oblHosp
            ? `${oblHosp[0].replace(/_/g, '.')} (${oblHosp[1]}×)` : '—';

        // Akce — Follow button
        $('profil-akce').classList.remove('hidden');
        const btnFollow = $('profil-btn-follow');
        if (uid !== currentUser.uid) {
            btnFollow.classList.remove('hidden');
            const sledovani = userData.sledovani || [];
            const jizSleduju = sledovani.includes(uid);
            btnFollow.textContent = jizSleduju ? '✓ Sleduji' : '➕ Sledovat';
            btnFollow.className = 'follow-btn w-full py-2 ' + (jizSleduju ? 'sleduju' : 'nesleduju');
            btnFollow.onclick = async () => {
                const sledovaniAktualni = userData.sledovani || [];
                const uzSleduju = sledovaniAktualni.includes(uid);
                let novySeznam;
                if (uzSleduju) {
                    novySeznam = sledovaniAktualni.filter(x => x !== uid);
                } else {
                    novySeznam = [...sledovaniAktualni, uid];
                }
                await updateDoc(doc(db, "hraci", currentUser.uid), { sledovani: novySeznam });
                userData.sledovani = novySeznam;
                btnFollow.textContent = uzSleduju ? '➕ Sledovat' : '✓ Sleduji';
                btnFollow.className = 'follow-btn w-full py-2 ' + (uzSleduju ? 'nesleduju' : 'sleduju');
                notify(uzSleduju ? 'Přestal jsi sledovat hráče.' : 'Sleduješ hráče ' + (h.prezdivka || '') + '!');
            };
        } else {
            btnFollow.classList.add('hidden');
        }

        // Akce — pozvat do cechu (jen zakladatel, hráč není v cechu)
        const btnPozvat = $('profil-btn-pozvat');
        if (userData.cech_zakladatel && !h.cech_id && uid !== currentUser.uid) {
            btnPozvat.classList.remove('hidden');
            btnPozvat.onclick = async () => {
                const cSnap = await getDoc(doc(db, "cechy", userData.cech_id));
                await addDoc(collection(db, "pozvanky"), {
                    cilovy_email: h.email,
                    cech_id: userData.cech_id,
                    cech_nazev: cSnap.data().nazev,
                    od: userData.prezdivka,
                    cas: serverTimestamp()
                });
                notify(`Pozvánka odeslána hráči ${h.prezdivka}!`);
                btnPozvat.disabled = true;
                btnPozvat.textContent = '✓ Odesláno';
            };
        } else {
            btnPozvat.classList.add('hidden');
        }

        $('profil-loading').classList.add('hidden');
    } catch(e) {
        $('profil-loading').textContent = 'Chyba: ' + e.message;
    }
};

// ─── ODZNAKY & OSOBNÍ STATISTIKY ─────────────────────────────────────────

const ACHIEVEMENTY_DEF = [
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

function vypoctiStatsZLogy(logDocs) {
    const poctyPiv = {}, dny = new Set();
    let spolecne = 0, nocniZapis = false;

    logDocs.forEach(d => {
        const z = d.data();
        if (z.pivo) poctyPiv[z.pivo] = (poctyPiv[z.pivo] || 0) + 1;
        if (z.spolecne_s) spolecne++;
        if (z.cas) {
            const dt = z.cas.toDate ? z.cas.toDate() : new Date(z.cas);
            dny.add(dt.toISOString().slice(0, 10));
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
    const dnesStr = new Date().toISOString().slice(0, 10);
    const vcerStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dny.has(dnesStr) || dny.has(vcerStr)) {
        let den = dny.has(dnesStr) ? new Date() : new Date(Date.now() - 86400000);
        while (dny.has(den.toISOString().slice(0, 10))) {
            streakAkt++;
            den = new Date(den - 86400000);
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
        hospod:     Object.keys(userData?.dungeony || {}).length,
        maxNavstev: Math.max(0, ...Object.values(userData?.dungeony || {})),
        spolecne,
        streakMax,
        streakAkt,
        nocniZapis,
        nejDen:     dnyNazvy[nejDenIdx],
        prumerTyden,
        poctyPiv
    };
}

function vykresliOsobniStats(stats) {
    const grid = $('osobni-stats-grid');
    const tiles = [
        { val: stats.celkemPiv,    label: 'piv celkem',        ikona: 'ic-mug' },
        { val: stats.ruznych,      label: 'různých druhů',     ikona: 'ic-mug-stamp' },
        { val: stats.hospod,       label: 'hospod navštíveno', ikona: 'ic-map' },
        { val: `${stats.streakAkt}d`, label: 'aktuální série', ikona: 'ic-streak' },
        { val: stats.nejDen,       label: 'nejaktivnější den', ikona: 'ic-journal' },
        { val: `${stats.prumerTyden}`, label: 'piv / týden v průměru', ikona: 'ic-xp' },
    ];
    grid.innerHTML = tiles.map(t => `
        <div class="stat-tile">
            <svg class="pd-ico" style="width:22px;height:22px"><use href="#${t.ikona}"/></svg>
            <div class="stat-tile-val">${t.val}</div>
            <div class="stat-tile-label">${t.label}</div>
        </div>`).join('');
}

async function zkontrolujAVykresliOdznaky(stats) {
    const ziskane    = new Set((userData?.achievementy || []).map(a => a.id));
    const noveOdznaky = [];

    // Zkontroluj nové
    ACHIEVEMENTY_DEF.forEach(def => {
        if (!ziskane.has(def.id) && def.podminka(stats)) {
            noveOdznaky.push(def);
            ziskane.add(def.id);
        }
    });

    // Ulož nové do Firestore
    if (noveOdznaky.length > 0) {
        const cas = new Date().toISOString();
        const aktualizovane = [
            ...(userData?.achievementy || []),
            ...noveOdznaky.map(a => ({ id: a.id, ziskano: cas }))
        ];
        try {
            await updateDoc(doc(db, "hraci", currentUser.uid), { achievementy: aktualizovane });
            userData.achievementy = aktualizovane;
        } catch(e) { console.warn('Chyba ukládání odznaků:', e); }

        // Notifikace pro nové odznaky
        noveOdznaky.forEach((a, i) => {
            setTimeout(() => notify(`🏅 Nový odznak: ${a.nazev}!`), i * 800);
        });

        // Tolary za odznak (dle stupně) + zápis do zvonku notifikací
        const TOLARY_ZA_STUPEN = { bronz: 10, stribro: 35, zlato: 100 };
        for (const a of noveOdznaky) {
            await udelTolary(TOLARY_ZA_STUPEN[a.stupen] || 10, `Odznak: ${a.nazev}`);
            try {
                await addDoc(collection(db, "hraci", currentUser.uid, "notifikace"), {
                    typ: 'odznak',
                    text: `Nový odznak: ${a.nazev}`,
                    cas: serverTimestamp(),
                    precteno: false
                });
            } catch (eNotif) { console.warn('Chyba zápisu notifikace odznaku:', eNotif.message); }
        }
    }

    // Vykresli mřížku
    const grid = $('odznaky-grid');
    grid.innerHTML = '';
    let ziskaných = 0;

    ACHIEVEMENTY_DEF.forEach(def => {
        const mam  = ziskane.has(def.id);
        const nove = noveOdznaky.some(n => n.id === def.id);
        if (mam) ziskaných++;

        const wrap = document.createElement('div');
        wrap.className = 'odznak-wrap';
        wrap.title     = `${def.nazev}\n${def.popis}`;

        wrap.innerHTML = `
            <div class="odznak-stit ${def.stupen} ${mam ? 'earned' : 'locked'} ${nove ? 'novy' : ''}">
                <svg class="pd-ico odznak-ikona"><use href="#${def.ikona}"/></svg>
                ${mam && def.stupen === 'zlato' ? `<span class="odznak-spark s1">✦</span><span class="odznak-spark s2">✦</span>` : ''}
                ${mam ? `<div class="odznak-gem ${def.stupen}"></div>` : `<div class="odznak-lock">🔒</div>`}
            </div>
            <div class="odznak-nazev ${mam ? 'ziskano' : 'locked'}">${def.nazev}</div>`;

        grid.appendChild(wrap);
    });

    $('odznak-pocet').textContent = `${ziskaných} / ${ACHIEVEMENTY_DEF.length}`;
}

// ─── KRČMA (domovská obrazovka) ───────────────────────────────────────
async function ziskejKrcmaStats() {
    if (posledniStats) return posledniStats;
    try {
        const snap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "log_piv"),
            orderBy("cas", "desc"), limit(500)
        ));
        posledniStats = vypoctiStatsZLogy(snap.docs);
    } catch (e) {
        console.warn('Chyba načtení statistik pro Krčmu:', e.message);
        posledniStats = { celkemPiv: 0, streakAkt: 0 };
    }
    return posledniStats;
}

window.vykresliKrcmu = async function() {
    if (!currentUser) return;
    const box = $('krcma-obsah-box');
    const stats = await ziskejKrcmaStats();
    const ukol  = zajistiDenniUkol();
    const vyzva = zajistiTydenniVyzvu();
    const { lvl } = xpLevel(userData.xp || 0);

    // Poslední získaný odznak
    const achievementy = userData.achievementy || [];
    let posledniOdznak = null;
    if (achievementy.length > 0) {
        const serazene = [...achievementy].sort((a, b) => new Date(b.ziskano) - new Date(a.ziskano));
        posledniOdznak = ACHIEVEMENTY_DEF.find(d => d.id === serazene[0].id) || null;
    }

    // Souhrn aktivní cechovní války
    let valkaHtml = '';
    if (userData.cech_id) {
        try {
            const [q1, q2] = await Promise.all([
                getDocs(query(collection(db, "valky"), where("utocnik_id", "==", userData.cech_id), where("stav", "==", "aktivni"))),
                getDocs(query(collection(db, "valky"), where("obrance_id", "==", userData.cech_id), where("stav", "==", "aktivni")))
            ]);
            const vsechny = [];
            q1.forEach(d => vsechny.push({ ...d.data(), smer: 'utocnik' }));
            q2.forEach(d => vsechny.push({ ...d.data(), smer: 'obrance' }));
            if (vsechny.length > 0) {
                const v = vsechny[0];
                const nase   = v.smer === 'utocnik' ? (v.utocnik_bodu || 0) : (v.obrance_bodu || 0);
                const jejich = v.smer === 'utocnik' ? (v.obrance_bodu || 0) : (v.utocnik_bodu || 0);
                valkaHtml = `
                    <div class="glass-card p-3 mb-3" style="border:1px solid #8a5a17">
                        <div class="text-xs text-orange-400 uppercase font-bold mb-1"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-banner"/></svg> Probíhá cechovní válka</div>
                        <div class="text-sm">Náš cech ${nase} : ${jejich} soupeř</div>
                    </div>`;
            }
        } catch (e) { console.warn('Chyba načtení války pro Krčmu:', e.message); }
    }

    box.innerHTML = `
        <div class="text-center mb-3">
            <div class="text-lg text-yellow-400 fantasy-font">Vítej v Krčmě, ${escapeHtml(userData.prezdivka || 'Hrdino')}!</div>
            <div class="text-xs text-gray-400">Úroveň ${lvl}</div>
        </div>
        <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="stat-tile"><svg class="pd-ico" style="width:22px;height:22px"><use href="#ic-coin"/></svg><div class="stat-tile-val">${userData.tolary || 0}</div><div class="stat-tile-label">Tolarů</div></div>
            <div class="stat-tile"><svg class="pd-ico" style="width:22px;height:22px"><use href="#ic-streak"/></svg><div class="stat-tile-val">${stats.streakAkt || 0}d</div><div class="stat-tile-label">Série</div></div>
            <div class="stat-tile"><svg class="pd-ico" style="width:22px;height:22px"><use href="#ic-mug"/></svg><div class="stat-tile-val">${stats.celkemPiv || 0}</div><div class="stat-tile-label">Piv celkem</div></div>
        </div>
        <button class="btn-gold w-full py-3 uppercase text-sm mb-3" onclick="switchTab('mapa')"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-mug"/></svg> Zapsat pivo</button>
        <div class="glass-card p-3 mb-3" style="border:1px solid #8a5a17">
            <div class="text-xs text-orange-400 uppercase font-bold mb-1"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-journal"/></svg> Denní úkol</div>
            <div class="text-sm mb-1">${escapeHtml(ukol.popis)}</div>
            <div class="xp-bar-outer"><div class="xp-bar-inner" style="width:${Math.min(100, ukol.progress / ukol.cil * 100)}%"></div></div>
            <div class="text-[10px] text-gray-500 mt-1">${ukol.progress}/${ukol.cil}${ukol.splneno ? ' · ✅ Splněno' : ''}</div>
        </div>
        <div class="glass-card p-3 mb-3" style="border:1px solid #8a5a17">
            <div class="text-xs text-orange-400 uppercase font-bold mb-1"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-streak"/></svg> Týdenní výzva</div>
            <div class="text-sm mb-1">Zapiš ${vyzva.cil} piv tento týden (+${vyzva.odmena} 🪙)</div>
            <div class="xp-bar-outer"><div class="xp-bar-inner" style="width:${Math.min(100, vyzva.progress / vyzva.cil * 100)}%"></div></div>
            <div class="text-[10px] text-gray-500 mt-1">${vyzva.progress}/${vyzva.cil}${vyzva.splneno ? ' · ✅ Splněno' : ''}</div>
        </div>
        <div class="glass-card p-3 mb-3" style="border:1px solid #8a5a17">
            <div class="text-xs text-orange-400 uppercase font-bold mb-1"><svg class="pd-ico" style="width:1em;height:1em"><use href="#ic-shield"/></svg> Poslední odznak</div>
            ${posledniOdznak
                ? `<div class="text-sm flex items-center gap-2"><svg class="pd-ico" style="width:20px;height:20px"><use href="#${posledniOdznak.ikona}"/></svg> ${escapeHtml(posledniOdznak.nazev)}</div>`
                : `<div class="text-gray-600 italic text-sm">Zatím žádný odznak — vyraz na dungeony!</div>`}
        </div>
        ${valkaHtml}
    `;
};

// ─── ZÁLOŽKA PIVA ─────────────────────────────────────────────────────────

let vsechnaPivaData   = [];
let vsechnaHospodyData = [];
let pivaSort = 'hodnoceni';
let pivaTyp  = 'piva';

window.setPivaTyp = (typ) => {
    pivaTyp = typ;
    $('piva-typ-piva').classList.toggle('active',    typ === 'piva');
    $('piva-typ-hospody').classList.toggle('active', typ === 'hospody');
    $('piva-search').placeholder = typ === 'piva' ? '🔍 Hledat pivo...' : '🔍 Hledat hospodu...';
    window.renderPivaSeznamu();
};

window.setPivaSort = (typ) => {
    pivaSort = typ;
    ['hodnoceni','vypitost','abeceda'].forEach(s =>
        $(`sort-${s}`).classList.toggle('active', s === typ)
    );
    window.renderPivaSeznamu();
};

function pivaSetLoading(msg, color) {
    const el = $('piva-loading');
    el.style.cssText = `display:block;color:${color||'#9a86a4'};font-size:0.85rem;text-align:center;padding:2rem 0;`;
    el.textContent = msg;
    $('piva-seznam').classList.add('hidden');
    $('piva-prazdno').classList.add('hidden');
}

async function nactiPivaTab() {
    if (!currentUser) return;
    pivaSetLoading('⏳ Načítám záznamy...');

    try {
        // Stejný dotaz jako deník — fungující, bez extra indexů
        const logSnap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "log_piv"),
            orderBy("cas", "desc"),
            limit(500)
        ));

        pivaSetLoading(`Zpracovávám ${logSnap.docs.length} zápisů...`);

        const pivMap = {}, hospMap = {};
        logSnap.docs.forEach(d => {
            const z = d.data();
            if (z.pivo)    pivMap[z.pivo]    = (pivMap[z.pivo]    || 0) + 1;
            if (z.hospoda) hospMap[z.hospoda] = (hospMap[z.hospoda] || 0) + 1;
        });

        let pivStatsMap = {}, hospStatsMap = {};
        try {
            const s = await getDocs(collection(db, "statistiky_piv"));
            s.docs.forEach(d => { pivStatsMap[d.id] = d.data(); });
        } catch(_) {}
        try {
            const s = await getDocs(collection(db, "statistiky_hospod"));
            s.docs.forEach(d => { hospStatsMap[d.id] = d.data(); });
        } catch(_) {}

        vsechnaPivaData = Object.entries(pivMap).map(([nazev, mujPocet]) => ({
            id: nazev,
            mujPocet,
            hodnoceni_prumerne: pivStatsMap[nazev]?.hodnoceni_prumerne || 0,
            hodnoceni_pocet:    pivStatsMap[nazev]?.hodnoceni_pocet    || 0,
            obrazek_url:        pivStatsMap[nazev]?.obrazek_url        || null
        }));

        vsechnaHospodyData = Object.entries(hospMap).map(([nazev, mujPocet]) => ({
            id:    nazev,
            nazev: nazev,
            mujPocet,
            hodnoceni_prumerne: hospStatsMap[nazev]?.hodnoceni_prumerne || 0,
            hodnoceni_pocet:    hospStatsMap[nazev]?.hodnoceni_pocet    || 0,
        }));

        $('piva-loading').style.display = 'none';
        window.renderPivaSeznamu();

    } catch(e) {
        pivaSetLoading('⚠️ Chyba: ' + e.message, '#e05a5a');
        console.error('[Piva]', e);
    }
}

window.renderPivaSeznamu = function() {
    const hledani = ($('piva-search').value || '').trim().toLowerCase();
    const zdroj   = pivaTyp === 'piva' ? vsechnaPivaData : vsechnaHospodyData;

    let seznam = zdroj.filter(p =>
        !hledani || (p.nazev || p.id).toLowerCase().includes(hledani)
    );

    if (pivaSort === 'hodnoceni') {
        seznam.sort((a, b) => {
            const aH = a.hodnoceni_pocet > 0 ? a.hodnoceni_prumerne : -1;
            const bH = b.hodnoceni_pocet > 0 ? b.hodnoceni_prumerne : -1;
            return bH - aH;
        });
    } else if (pivaSort === 'vypitost') {
        seznam.sort((a, b) => b.mujPocet - a.mujPocet);
    } else {
        seznam.sort((a, b) => (a.nazev||a.id).localeCompare(b.nazev||b.id, 'cs'));
    }

    $('piva-loading').style.display = 'none';

    if (seznam.length === 0) {
        $('piva-seznam').classList.add('hidden');
        const prazdno = $('piva-prazdno');
        prazdno.classList.remove('hidden');
        prazdno.innerHTML = hledani
            ? pdStateEmpty('Nic nenalezeno', `Žádný výsledek pro "${hledani}"`)
            : pdStateSleep('Sudovous podřimuje', pivaTyp === 'piva' ? 'Zatím žádná piva v historii.' : 'Zatím žádné hospody v historii.');
        return;
    }

    $('piva-prazdno').classList.add('hidden');
    const box = $('piva-seznam');
    box.classList.remove('hidden');
    box.innerHTML = '';

    const moje = pivaTyp === 'piva'
        ? (userData?.hodnoceni_piv    || {})
        : (userData?.hodnoceni_hospod || {});

    seznam.forEach(item => {
        const klic        = item.id;
        const zobrazNazev = item.nazev || item.id;
        const prumerne    = item.hodnoceni_prumerne || 0;
        const hlasu       = item.hodnoceni_pocet    || 0;
        const mojeHv      = moje[klic] || 0;

        const ikonaHtml = (pivaTyp === 'piva' && item.obrazek_url)
            ? `<img src="${item.obrazek_url}" alt="" class="pivo-ikona">`
            : `<div class="pivo-ikona"><svg class="pd-ico" style="width:1.5em;height:1.5em"><use href="#${pivaTyp === 'piva' ? 'ic-mug' : 'ic-home'}"/></svg></div>`;

        const prumHtml = hlasu > 0
            ? `<span class="text-yellow-400 font-bold">${prumerne.toFixed(1)}★</span><span class="text-gray-500 text-[10px] ml-1">(${hlasu}×)</span>`
            : `<span class="text-gray-600 text-[10px]">Zatím nehodnoceno</span>`;

        const pocetLabel = pivaTyp === 'piva'
            ? `Vypito ${item.mujPocet}×`
            : `Navštíveno ${item.mujPocet}×`;

        // Vzácnost dle průměrného hodnocení: <3.5 Běžné, 3.5–4.4 Vzácné, ≥4.5 Legenda
        const vzacnost = hlasu === 0 || prumerne < 3.5
            ? { trida: 'pd-tag--common', text: 'Běžné' }
            : prumerne < 4.5
                ? { trida: 'pd-tag--rare', text: 'Vzácné' }
                : { trida: 'pd-tag--legendary', text: 'Legenda' };

        const karta = document.createElement('div');
        karta.className = 'pivo-karta fade-in';
        karta.innerHTML = `
            <span class="pd-tag ${vzacnost.trida}">${vzacnost.text}</span>
            ${ikonaHtml}
            <div class="flex-grow min-w-0">
                <div class="pivo-nazev">${escapeHtml(zobrazNazev)}</div>
                <div class="pivo-meta">${pocetLabel} · ${prumHtml}</div>
                <div class="hvezdicky">
                    ${[1,2,3,4,5].map(i => {
                        const t = i <= mojeHv ? 'hv moje'
                                : (i <= Math.round(prumerne) && hlasu > 0) ? 'hv filled'
                                : 'hv prazdna';
                        return `<span class="${t}" data-stars="${i}">★</span>`;
                    }).join('')}
                </div>
                ${mojeHv > 0 ? `<div style="font-size:0.62rem;color:#f3a81e;margin-top:2px;">Tvé hodnocení: ${mojeHv}★</div>` : ''}
            </div>`;

        karta.querySelectorAll('.hv').forEach(hvEl => {
            hvEl.addEventListener('click', () => {
                hodnotitPolozku(
                    pivaTyp === 'piva' ? 'pivo' : 'hospoda',
                    klic,
                    parseInt(hvEl.dataset.stars)
                );
            });
        });

        box.appendChild(karta);
    });
};

async function hodnotitPolozku(typ, klic, stars) {
    if (!currentUser) return;
    const fieldPath = typ === 'pivo' ? 'hodnoceni_piv' : 'hodnoceni_hospod';
    const kolekce   = typ === 'pivo' ? 'statistiky_piv' : 'statistiky_hospod';

    const stareHv = (userData?.[fieldPath]?.[klic]) || 0;

    try {
        const refSnap = await getDoc(doc(db, kolekce, klic));
        let prumerne  = refSnap.exists() ? (refSnap.data().hodnoceni_prumerne || 0) : 0;
        let pocetHl   = refSnap.exists() ? (refSnap.data().hodnoceni_pocet    || 0) : 0;

        if (stareHv > 0) {
            prumerne = ((prumerne * pocetHl) - stareHv + stars) / pocetHl;
        } else {
            prumerne = (prumerne * pocetHl + stars) / (pocetHl + 1);
            pocetHl++;
        }
        prumerne = Math.round(prumerne * 10) / 10;

        const batch = writeBatch(db);
        batch.set(doc(db, kolekce, klic),
            { hodnoceni_prumerne: prumerne, hodnoceni_pocet: pocetHl },
            { merge: true }
        );
        batch.update(doc(db, "hraci", currentUser.uid), {
            [`${fieldPath}.${klic}`]: stars
        });
        await batch.commit();

        if (!userData[fieldPath]) userData[fieldPath] = {};
        userData[fieldPath][klic] = stars;

        const cache = typ === 'pivo' ? vsechnaPivaData : vsechnaHospodyData;
        const local = cache.find(p => p.id === klic);
        if (local) { local.hodnoceni_prumerne = prumerne; local.hodnoceni_pocet = pocetHl; }

        const zobraz = typ === 'pivo' ? klic : (vsechnaHospodyData.find(h=>h.id===klic)?.nazev || klic);
        notify(`${stars}★ uloženo pro ${zobraz}`);
        renderPivaSeznamu();

        // Tolary za hodnocení — max 3× denně
        try {
            const dnes = dnesniDatum();
            if (!userData.tolary_denni || userData.tolary_denni.datum !== dnes) {
                userData.tolary_denni = { datum: dnes, pocet_piv: 0, pocet_hodnoceni: 0 };
            }
            if (userData.tolary_denni.pocet_hodnoceni < 3) {
                userData.tolary_denni.pocet_hodnoceni++;
                await updateDoc(doc(db, "hraci", currentUser.uid), { tolary_denni: userData.tolary_denni });
                await udelTolary(1, 'Hodnocení');
            }
            await pripoctiUkolProgress('hodnoceni', 1);
        } catch (eTolary) { console.warn('Chyba Tolary za hodnocení:', eTolary.message); }
    } catch(e) { notify('Chyba: ' + e.message, 'err'); }
}

// ─── SHARE KARTY ──────────────────────────────────────────────────────────
let posledniZapis = null;

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

async function vygenerujPivniKartu(pubName, beerName) {
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

window.otevritWrapped = async function() {
    notify('Generuji Wrapped... 🍺', 'ok');
    try {
        const snap = await getDocs(query(
            collection(db, "hraci", currentUser.uid, "log_piv"),
            orderBy("cas", "desc")
        ));

        const poctyPiv = {}, mesicePocty = {}, spoluhraciPocty = {};
        snap.forEach(d => {
            const z = d.data();
            if (z.pivo) poctyPiv[z.pivo] = (poctyPiv[z.pivo] || 0) + 1;
            if (z.cas) {
                const m = (z.cas.toDate ? z.cas.toDate() : new Date(z.cas)).toISOString().slice(0,7);
                mesicePocty[m] = (mesicePocty[m] || 0) + 1;
            }
            if (z.spolecne_s) {
                z.spolecne_s.split(', ').forEach(j => {
                    if (j.trim()) spoluhraciPocty[j.trim()] = (spoluhraciPocty[j.trim()] || 0) + 1;
                });
            }
        });

        const celkemPiv    = snap.size;
        const ruznych      = Object.keys(poctyPiv).length;
        const hospod       = Object.keys(userData?.dungeony || {}).length;
        const oblPivo      = Object.entries(poctyPiv).sort((a,b)=>b[1]-a[1])[0];
        const oblHosp      = Object.entries(userData?.dungeony || {}).sort((a,b)=>b[1]-a[1])[0];
        const nejMesic     = Object.entries(mesicePocty).sort((a,b)=>b[1]-a[1])[0];
        const nejSpoluhrac = Object.entries(spoluhraciPocty).sort((a,b)=>b[1]-a[1])[0];
        const { lvl }      = xpLevel(userData?.xp || 0);

        const mesicNazvy = ['Led','Úno','Bře','Dub','Kvě','Čer','Čvc','Srp','Zář','Říj','Lis','Pro'];
        function formatMesic(iso) {
            if (!iso) return '—';
            const [y, m] = iso.split('-');
            return mesicNazvy[parseInt(m)-1] + ' ' + y;
        }

        const c = await vygenerujWrappedCanvas({
            celkemPiv, ruznych, hospod,
            oblPivo:      oblPivo  ? { nazev: oblPivo[0],                        pocet: oblPivo[1] }  : null,
            oblHosp:      oblHosp  ? { nazev: oblHosp[0].replace(/_/g,'.'),      pocet: oblHosp[1] }  : null,
            nejMesic:     nejMesic ? { nazev: formatMesic(nejMesic[0]),           pocet: nejMesic[1] } : null,
            nejSpoluhrac: nejSpoluhrac ? { nazev: nejSpoluhrac[0], pocet: nejSpoluhrac[1] }           : null,
            lvl, xp: userData?.xp || 0,
            nick: userData?.prezdivka || 'Hrdina',
            avatar: userData?.avatar  || '⚔️'
        });
        otevritShareModal(c);
    } catch(e) { notify('Chyba generování: ' + e.message, 'err'); }
}

async function vygenerujWrappedCanvas(s) {
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

function otevritShareModal(canvas) {
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
