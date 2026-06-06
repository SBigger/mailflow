'use strict';

let readings = [];
let chart = null;
let aiConfigured = true;

let sb = null; // Supabase-Client (Browser)
let accessToken = null; // Zugriffs-Token der aktuellen Sitzung

const $ = (id) => document.getElementById(id);

// ── Schwere Bibliotheken erst bei Bedarf nachladen (schnellerer Start am Handy) ──
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Ladefehler: ' + src));
    document.head.appendChild(s);
  });
}
let _exifrPromise, _chartPromise;
function ensureExifr() {
  if (typeof exifr !== 'undefined') return Promise.resolve();
  _exifrPromise = _exifrPromise || loadScript('https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js');
  return _exifrPromise;
}
function ensureChart() {
  if (typeof Chart !== 'undefined') return Promise.resolve();
  _chartPromise = _chartPromise || loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js');
  return _chartPromise;
}

// ── Blutdruck-Kategorien (nach europäischer Einteilung, ESC/ESH) ──
function categorize(sys, dia) {
  if (sys == null || dia == null) return { label: '–', color: '#9ca3af' };
  if (sys >= 180 || dia >= 110) return { label: 'Hypertonie Grad 3', color: '#7f1d1d' };
  if (sys >= 160 || dia >= 100) return { label: 'Hypertonie Grad 2', color: '#b91c1c' };
  if (sys >= 140 || dia >= 90)  return { label: 'Hypertonie Grad 1', color: '#ea580c' };
  if (sys >= 130 || dia >= 85)  return { label: 'Hoch-normal', color: '#ca8a04' };
  if (sys >= 120 || dia >= 80)  return { label: 'Normal', color: '#65a30d' };
  return { label: 'Optimal', color: '#16a34a' };
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' + d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

// datetime-local-Wert (lokale Zeit, ohne Sekunden)
function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

// ── Authentifizierter API-Aufruf ──
// Hängt den Token an und schickt bei abgelaufener Sitzung zurück zum Login.
async function apiFetch(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    showLogin();
    throw new Error('Bitte neu anmelden.');
  }
  return res;
}

// ── Anmeldung ──
function showLogin() {
  $('appView').hidden = true;
  $('logoutBtn').hidden = true;
  $('loginView').hidden = false;
}

function showApp() {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('logoutBtn').hidden = false;
}

async function initAuth() {
  let cfg;
  try {
    cfg = await (await fetch('/api/config')).json();
  } catch {
    showLogin();
    showLoginError('Server nicht erreichbar.');
    return;
  }
  aiConfigured = cfg.aiConfigured;
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    showLogin();
    showLoginError('Login ist serverseitig noch nicht konfiguriert (SUPABASE_URL / SUPABASE_ANON_KEY).');
    return;
  }
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const { data: { session } } = await sb.auth.getSession();
  sb.auth.onAuthStateChange((_event, s) => { accessToken = s?.access_token || null; });
  if (session) {
    accessToken = session.access_token;
    showApp();
    load();
  } else {
    showLogin();
  }
}

function showLoginError(msg) {
  const el = $('loginError');
  el.textContent = '✗ ' + msg;
  el.hidden = false;
}

async function doLogin(e) {
  e.preventDefault();
  $('loginError').hidden = true;
  const btn = $('loginBtn');
  btn.disabled = true;
  try {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { showLoginError(error.message); return; }
    accessToken = data.session.access_token;
    $('loginPassword').value = '';
    showApp();
    await load();
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  try { if (sb) await sb.auth.signOut(); } catch { /* egal */ }
  accessToken = null;
  readings = [];
  showLogin();
}

// ── Daten laden ──
async function load() {
  const res = await apiFetch('/api/readings');
  const data = await res.json();
  readings = data.readings || [];
  if ('aiConfigured' in data) aiConfigured = data.aiConfigured;
  render();
}

function render() {
  renderStats();
  renderTable();
  renderChart();
}

// ── Statistik ──
function renderStats() {
  const el = $('stats');
  if (!readings.length) { el.hidden = true; return; }
  el.hidden = false;
  const valid = readings.filter((r) => r.systolic != null && r.diastolic != null);
  const avg = (key) => {
    const xs = valid.map((r) => r[key]).filter((x) => x != null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : '–';
  };
  const last = readings[readings.length - 1];
  const arrCount = readings.filter((r) => r.arrhythmia).length;
  el.innerHTML = `
    <div class="stat"><div class="val">${readings.length}</div><div class="lbl">Messungen</div></div>
    <div class="stat"><div class="val">${avg('systolic')}/${avg('diastolic')}</div><div class="lbl">Ø Blutdruck</div></div>
    <div class="stat"><div class="val">${avg('pulse')}</div><div class="lbl">Ø Puls</div></div>
    <div class="stat"><div class="val">${last.systolic ?? '–'}/${last.diastolic ?? '–'}</div><div class="lbl">Letzter Wert</div></div>
    <div class="stat"><div class="val">${arrCount}×</div><div class="lbl">Rhythmusstörung</div></div>
  `;
}

// ── Tabelle ──
function renderTable() {
  const tbody = $('tbody');
  $('emptyHint').hidden = readings.length > 0;
  // neueste Messung immer zuoberst (nach Messdatum, dann nach Eintrags-ID)
  const rows = [...readings].sort((a, b) => {
    const d = new Date(b.measured_at) - new Date(a.measured_at);
    return d !== 0 ? d : (b.id - a.id);
  });
  tbody.innerHTML = rows.map((r) => {
    const cat = categorize(r.systolic, r.diastolic);
    return `<tr>
      <td class="date"><span class="cat-dot" style="background:${cat.color}" title="${cat.label}"></span>${fmtDate(r.measured_at)}</td>
      <td class="bp">${r.systolic ?? '–'}</td>
      <td class="bp">${r.diastolic ?? '–'}</td>
      <td>${r.pulse ?? '–'}</td>
      <td><span class="badge ${r.arrhythmia ? 'ja' : 'nein'}">${r.arrhythmia ? 'ja' : 'nein'}</span></td>
      <td>
        <button class="icon-btn" data-edit="${r.id}" title="Bearbeiten">✏️</button>
        <button class="icon-btn" data-del="${r.id}" title="Löschen">🗑️</button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openEdit(Number(b.dataset.edit))));
  tbody.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => del(Number(b.dataset.del))));
}

// ── Diagramm ──
async function renderChart() {
  const card = $('chartCard');
  if (!readings.length) { card.hidden = true; return; }
  try { await ensureChart(); } catch { card.hidden = true; return; }
  card.hidden = false;

  const days = Number($('rangeSelect').value);
  let data = readings;
  if (days > 0) {
    const cutoff = Date.now() - days * 86400000;
    data = readings.filter((r) => new Date(r.measured_at).getTime() >= cutoff);
  }

  const labels = data.map((r) => new Date(r.measured_at).toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' }));
  const sys = data.map((r) => r.systolic);
  const dia = data.map((r) => r.diastolic);
  const pulse = data.map((r) => r.pulse);
  // Herzrhythmusstörung als Markierung auf der SYS-Linie
  const arrPoints = data.map((r) => (r.arrhythmia ? r.systolic : null));

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Oben (SYS)', data: sys, borderColor: '#b91c1c', backgroundColor: '#b91c1c', tension: .3, spanGaps: true },
        { label: 'Unten (DIA)', data: dia, borderColor: '#2563eb', backgroundColor: '#2563eb', tension: .3, spanGaps: true },
        { label: 'Puls', data: pulse, borderColor: '#16a34a', backgroundColor: '#16a34a', tension: .3, spanGaps: true, borderDash: [4, 3] },
        {
          label: 'Rhythmusstörung',
          data: arrPoints,
          borderColor: 'transparent',
          backgroundColor: '#f59e0b',
          pointBackgroundColor: '#f59e0b',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 9,
          pointHoverRadius: 11,
          pointStyle: 'rectRot',
          showLine: false,
          order: -1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: { y: { beginAtZero: false } },
    },
  };

  if (chart) chart.destroy();
  chart = new Chart($('chart'), cfg);
}

// ── Foto-Upload ──
// Aufnahmedatum aus den EXIF-Daten des Originalfotos lesen.
async function readExifDate(file) {
  try {
    await ensureExifr();
    const ex = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate']);
    const d = ex?.DateTimeOriginal || ex?.CreateDate || ex?.ModifyDate;
    if (d instanceof Date && !isNaN(d)) return d;
  } catch {
    /* kein EXIF */
  }
  return null;
}

// Foto im Browser verkleinern: schnellerer Upload und sicher unter dem
// Vercel-Limit (4,5 MB pro Anfrage). Für die Display-Erkennung reicht das locker.
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type || !file.type.startsWith('image/')) return file;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob || file;
  } catch {
    return file; // im Zweifel das Original schicken
  }
}

async function uploadPhoto(file) {
  const status = $('uploadStatus');
  status.hidden = false;
  status.className = 'status loading';
  status.innerHTML = '<span class="spinner"></span>Foto wird ausgelesen …';

  try {
    const exifDate = await readExifDate(file);
    const photo = await compressImage(file);
    const fd = new FormData();
    fd.append('photo', photo, 'foto.jpg');
    if (exifDate) fd.append('measured_at', exifDate.toISOString());

    const res = await apiFetch('/api/readings/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');

    await load();
    const r = data.reading;
    if (data.aiError) {
      status.className = 'status warn';
      status.textContent = `⚠️ Gespeichert, aber automatische Auslesung nicht möglich (${data.aiError}). Bitte Werte über ✏️ ergänzen.`;
      openEdit(r.id);
    } else {
      status.className = 'status ok';
      status.innerHTML = `✓ Erkannt: <b>${r.systolic ?? '?'}/${r.diastolic ?? '?'}</b>, Puls <b>${r.pulse ?? '?'}</b>${r.arrhythmia ? ', Rhythmusstörung <b>ja</b>' : ''}. <a href="#" id="correctLink">Stimmt nicht? Korrigieren</a>`;
      $('correctLink')?.addEventListener('click', (e) => { e.preventDefault(); openEdit(r.id); });
    }
  } catch (err) {
    status.className = 'status err';
    status.textContent = '✗ ' + err.message;
  }
}

// ── Bearbeiten / Manuell ──
async function showPhoto(id) {
  const wrap = $('photoPreviewWrap');
  try {
    const res = await apiFetch(`/api/readings/${id}/photo`);
    if (!res.ok) throw new Error('kein Foto');
    const blob = await res.blob();
    $('photoPreview').src = URL.createObjectURL(blob);
    wrap.hidden = false;
  } catch {
    wrap.hidden = true;
    $('photoPreview').removeAttribute('src');
  }
}

function openEdit(id) {
  const r = id ? readings.find((x) => x.id === id) : null;
  $('editId').value = r ? r.id : '';
  $('editTitle').textContent = r ? 'Eintrag bearbeiten' : 'Wert manuell eingeben';
  $('editDate').value = toLocalInput(r ? r.measured_at : new Date().toISOString());
  $('editSys').value = r?.systolic ?? '';
  $('editDia').value = r?.diastolic ?? '';
  $('editPulse').value = r?.pulse ?? '';
  $('editArr').checked = !!r?.arrhythmia;
  $('editNote').value = r?.note ?? '';

  const wrap = $('photoPreviewWrap');
  wrap.hidden = true;
  $('photoPreview').removeAttribute('src');
  if (r?.photo) showPhoto(r.id);

  $('editDialog').showModal();
}

async function saveEdit(e) {
  e.preventDefault();
  const id = $('editId').value;
  const payload = {
    measured_at: $('editDate').value,
    systolic: $('editSys').value ? Number($('editSys').value) : null,
    diastolic: $('editDia').value ? Number($('editDia').value) : null,
    pulse: $('editPulse').value ? Number($('editPulse').value) : null,
    arrhythmia: $('editArr').checked,
    note: $('editNote').value || null,
  };
  const url = id ? `/api/readings/${id}` : '/api/readings';
  const method = id ? 'PATCH' : 'POST';
  await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  $('editDialog').close();
  await load();
}

async function del(id) {
  if (!confirm('Diesen Eintrag wirklich löschen?')) return;
  await apiFetch(`/api/readings/${id}`, { method: 'DELETE' });
  await load();
}

// ── Excel-Export (mit Token, daher als Blob herunterladen) ──
async function exportXlsx() {
  try {
    const res = await apiFetch('/api/export.xlsx');
    if (!res.ok) throw new Error('Export fehlgeschlagen');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `blutdruck_${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    alert(err.message);
  }
}

// ── Events ──
$('loginForm').addEventListener('submit', doLogin);
$('logoutBtn').addEventListener('click', doLogout);
function onPickFile(e) {
  const f = e.target.files[0];
  if (f) uploadPhoto(f);
  e.target.value = '';
}
$('fileInput').addEventListener('change', onPickFile);
$('cameraInput').addEventListener('change', onPickFile);
$('manualBtn').addEventListener('click', () => openEdit(null));
$('editForm').addEventListener('submit', saveEdit);
$('cancelEdit').addEventListener('click', () => $('editDialog').close());
$('rangeSelect').addEventListener('change', renderChart);
$('exportBtn').addEventListener('click', exportXlsx);

// Service-Worker registrieren (macht die App auf dem Handy installierbar).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* egal, App läuft auch ohne */ });
  });
}

initAuth();
