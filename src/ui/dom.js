// Pomocné funkce pro práci s DOM, toasty a prázdné/chybové stavy.
// ─── HELPERS ──────────────────────────────────────────────────────────
export function $(id) { return document.getElementById(id); }
export function show(id) { $(id).classList.remove('hidden'); }
export function hide(id) { $(id).classList.add('hidden'); }
export function setHtml(id, html) { $(id).innerHTML = html; }
export function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
// admin a inline šablony volají window.escapeHtml
window.escapeHtml = escapeHtml;
export function notify(msg) {
    // Jednoduchý toast místo alert()
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#2d3748;color:#fff;padding:10px 20px;border-radius:10px;z-index:9999;font-size:0.85rem;border:1px solid #8b4513;font-family:Cinzel,serif;max-width:90%;text-align:center;';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ─── ZNOVUPOUŽITELNÉ STAVY (prázdno/spí/načítám/chyba) ────────────────
export function pdStateEmpty(title, hint) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div class="pd-state__icon"><span>🕸️</span></div>
        <div class="pd-state__title">${escapeHtml(title)}</div>
        <div class="pd-state__hint">„${escapeHtml(hint)}“</div>
    </div>`;
}
export function pdStateSleep(title, hint) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div style="font-size:44px;margin-bottom:8px;filter:grayscale(.3);">😴</div>
        <div class="pd-state__title">${escapeHtml(title)}</div>
        <div class="pd-state__hint">„${escapeHtml(hint)}“</div>
    </div>`;
}
export function pdStateLoading(text) {
    return `<div class="pd-panel pd-panel--stone pd-state">
        <div class="pd-mug-loading"><div class="pd-mug-loading__foam"></div><div class="pd-mug-loading__head"></div></div>
        <div class="pd-state__title">${escapeHtml(text || 'Načítám…')}</div>
        <div class="pd-state__hint">„Točíme čerstvé. Pěna se usazuje…“</div>
    </div>`;
}
export function pdStateError(msg) {
    return `<div class="pd-panel pd-panel--stone pd-state pd-state--error">
        <div style="font-size:44px;margin-bottom:8px;">💥</div>
        <div class="pd-state__title">No to nám přeteklo…</div>
        <div class="pd-state__hint">„${escapeHtml(msg || 'Něco se rozlilo. Zkus to prosím znovu, hrdino.')}“</div>
    </div>`;
}
