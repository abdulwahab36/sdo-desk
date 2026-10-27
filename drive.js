/* SDO Desk — Google Drive automatic backup.
   Scope drive.file: the app can only see files it created, nothing else in your Drive.
   Loaded after the main script; hooks save() and render(). */
(function () {
  'use strict';
  const CLIENT_ID = '1003440709077-kbtelhcuuaiol3s4p5po4bdqdtdg5ve0.apps.googleusercontent.com';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const DRV = 'https://www.googleapis.com/drive/v3';
  const UPL = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'SDO Desk Backups';
  const KEEP = 15;               // daily files kept in Drive
  const DKEY = 'sdodesk.drive';  // kept outside S so restores never overwrite it

  let D = {};
  try { D = JSON.parse(localStorage.getItem(DKEY) || '{}') || {}; } catch (e) { D = {}; }
  const saveD = () => { try { localStorage.setItem(DKEY, JSON.stringify(D)); } catch (e) { /* ignore */ } };
  let tok = null;
  try { const t = JSON.parse(sessionStorage.getItem('sdodesk.tok') || 'null'); if (t && t.exp > Date.now()) tok = t; } catch (e) { /* ignore */ }
  const secure = () => location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const tokOk = () => !!(tok && tok.exp > Date.now());
  const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const origSave = window.save;
  const plainSave = () => origSave();

  /* ---------- sign-in (redirect, no popup) ---------- */
  function auth(after, interactive) {
    if (!secure()) return toast('Google Drive works only on the https:// link');
    if (!navigator.onLine) return toast('No internet connection');
    const st = uid();
    try { sessionStorage.setItem('sdodesk.oauth', JSON.stringify({ st, after, interactive: !!interactive, back: location.hash || '#home' })); } catch (e) { /* ignore */ }
    const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, state: st, include_granted_scopes: 'true' });
    if (!interactive) p.set('prompt', 'none'); else if (!D.email) p.set('prompt', 'select_account');
    if (D.email) p.set('login_hint', D.email);
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
  }

  function readReturn() {
    const hash = location.hash || '';
    if (!/(^#|&)(state|access_token|error)=/.test(hash)) return null;
    const h = new URLSearchParams(hash.slice(1));
    let sv = null;
    try { sv = JSON.parse(sessionStorage.getItem('sdodesk.oauth') || 'null'); sessionStorage.removeItem('sdodesk.oauth'); } catch (e) { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.search + ((sv && sv.back) || '#home'));
    if (!sv || sv.st !== h.get('state')) return { error: 'state_mismatch' };
    if (h.get('error') || !h.get('access_token')) return { error: h.get('error') || 'no_token', after: sv.after, interactive: sv.interactive };
    tok = { v: h.get('access_token'), exp: Date.now() + (Number(h.get('expires_in') || 3600) - 120) * 1000 };
    try { sessionStorage.setItem('sdodesk.tok', JSON.stringify(tok)); } catch (e) { /* ignore */ }
    return { ok: true, after: sv.after, interactive: sv.interactive };
  }

  /* ---------- Drive API ---------- */
  class AuthErr extends Error {}
  async function api(method, url, body, headers) {
    if (!tokOk()) throw new AuthErr('auth');
    const r = await fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + tok.v }, headers || {}), body });
    if (r.status === 401) { tok = null; try { sessionStorage.removeItem('sdodesk.tok'); } catch (e) { /* ignore */ } throw new AuthErr('auth'); }
    if (!r.ok) { const t = await r.text().catch(() => ''); const e = new Error('Drive error ' + r.status + (t ? ': ' + t.slice(0, 120) : '')); e.status = r.status; throw e; }
    return r;
  }
  const list = async (q, extra) => (await api('GET', `${DRV}/files?q=${encodeURIComponent(q)}&spaces=drive&fields=${encodeURIComponent('files(id,name,modifiedTime,size)')}${extra || ''}`)).json();
  async function whoAmI() { try { const j = await (await api('GET', DRV + '/about?fields=user(emailAddress)')).json(); D.email = (j.user && j.user.emailAddress) || D.email; } catch (e) { if (e instanceof AuthErr) throw e; } }
  async function ensureFolder() {
    if (D.folderId) return;
    const j = await list(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, '&pageSize=1');
    if (j.files && j.files[0]) { D.folderId = j.files[0].id; return; }
    const r = await api('POST', DRV + '/files?fields=id', JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }), { 'Content-Type': 'application/json' });
    D.folderId = (await r.json()).id;
  }
  // Resumable upload works for any size (backups include attached PDFs).
  async function upload(meta, blob, id) {
    const url = id ? `${UPL}/files/${id}?uploadType=resumable&fields=id` : `${UPL}/files?uploadType=resumable&fields=id`;
    const r = await api(id ? 'PATCH' : 'POST', url, JSON.stringify(id ? {} : meta), { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' });
    const loc = r.headers.get('Location');
    if (loc) { const u = await fetch(loc, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: blob }); if (!u.ok) { const e = new Error('Upload failed ' + u.status); e.status = u.status; throw e; } return (await u.json()).id; }
    if (id) { await api('PATCH', `${UPL}/files/${id}?uploadType=media`, blob, { 'Content-Type': 'application/json' }); return id; }
    const b = 'sdo' + uid();
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n`, blob, `\r\n--${b}--`]);
    return (await (await api('POST', `${UPL}/files?uploadType=multipart&fields=id`, body, { 'Content-Type': 'multipart/related; boundary=' + b })).json()).id;
  }
  async function makeBlob() {
    const files = [];
    try { for (const r of await fAll()) files.push({ id: r.id, name: r.name, type: r.type, size: r.size, text: r.text || '', data: await blobToB64(r.blob) }); } catch (e) { /* no files */ }
    return new Blob([JSON.stringify(Object.assign({}, S, { _files: files }))], { type: 'application/json' });
  }
  async function prune() {
    try {
      const j = await list(`'${D.folderId}' in parents and name contains 'sdo-desk-backup-' and trashed=false`, '&orderBy=' + encodeURIComponent('name desc') + '&pageSize=100');
      for (const f of (j.files || []).slice(KEEP)) await api('DELETE', `${DRV}/files/${f.id}`);
    } catch (e) { if (e instanceof AuthErr) throw e; }
  }
  async function backupOnce() {
    const day = today(), seq = D.seq || 0;
    await ensureFolder();
    const blob = await makeBlob();
    let done = false;
    if (D.lastFile && D.lastFile.date === day && D.lastFile.id) {
      try { await upload(null, blob, D.lastFile.id); done = true; } catch (e) { if (e.status !== 404) throw e; }
    }
    if (!done) { D.lastFile = { date: day, id: await upload({ name: `sdo-desk-backup-${day}.json`, parents: [D.folderId], mimeType: 'application/json' }, blob) }; await prune(); }
    D.last = Date.now(); D.size = blob.size; D.paused = false;
    if ((D.seq || 0) === seq) D.dirty = false;
    saveD();
    if (S.settings.lastBackup !== day) { S.settings.lastBackup = day; plainSave(); }
  }
  let running = false, again = false;
  async function backup(manual) {
    if (!tokOk()) return 'noauth';
    if (running) { again = true; return 'queued'; }
    running = true; let res = 'ok';
    try {
      do { again = false; try { await backupOnce(); } catch (e) { if (e.status === 404) { D.folderId = ''; D.lastFile = null; await backupOnce(); } else throw e; } } while (again && tokOk());
      if (manual) toast('Backed up to Google Drive');
    } catch (e) {
      if (e instanceof AuthErr) res = 'noauth';
      else { res = 'error'; D.err = e.message || 'Backup failed'; saveD(); if (manual) toast(navigator.onLine ? D.err : 'Drive backup failed: offline'); }
    } finally { running = false; refresh(); }
    return res;
  }

  /* ---------- automatic backup ---------- */
  let timer = null;
  function busy() { const v = curView(); return /^edit/.test(v) || v === 'search' || !!$('#sheet'); }
  function autoSync() {
    if (!D.connected || D.paused || !D.dirty || !secure()) return;
    if (tokOk()) { clearTimeout(timer); timer = setTimeout(async () => { if ((await backup(false)) === 'noauth') autoSync(); }, 4000); return; }
    // Google sign-in lasts 1 hour; renew silently when the app is idle.
    if (!navigator.onLine || busy() || Date.now() - (D.tried || 0) < 15 * 60 * 1000) return;
    D.tried = Date.now(); saveD();
    toast('Backing up to Google Drive…');
    setTimeout(() => { if (!busy()) auth('backup', false); }, 800);
  }
  window.save = function () { origSave.apply(this, arguments); if (D.connected) { D.dirty = true; D.seq = (D.seq || 0) + 1; saveD(); autoSync(); } };

  /* ---------- restore ---------- */
  async function openRestore() {
    sheet('<div class="ct">Restore from Google Drive</div><p class="meta">Loading backups…</p>');
    try {
      await ensureFolder(); saveD();
      const j = await list(`'${D.folderId}' in parents and name contains 'sdo-desk-backup-' and trashed=false`, '&orderBy=' + encodeURIComponent('name desc') + '&pageSize=' + KEEP);
      const fs = j.files || [];
      if (!$('#sheet')) return;
      sheet(`<div class="ct">Restore from Google Drive</div>${fs.length ? '<p class="meta">Pick a backup. It replaces all data on this device.</p>' + fs.map(f => `<div class="lrow" onclick="A.drivePick('${esc(f.id)}','${esc(f.name)}')"><b>${esc(f.name.replace(/^sdo-desk-backup-|\.json$/g, ''))}</b> <span class="meta">saved ${f.modifiedTime ? fmtTs(new Date(f.modifiedTime).getTime()) : ''}${f.size ? ' · ' + fsize(Number(f.size)) : ''}</span></div>`).join('') : '<p class="meta">No backups found in this Google account.</p>'}`);
    } catch (e) {
      if (e instanceof AuthErr) { closeSheet(); auth('restore', true); return; }
      sheet(`<div class="ct">Restore from Google Drive</div><p class="meta rd">${esc(e.message || 'Could not load backups')}</p>`);
    }
  }
  A.drivePick = async (id, name) => {
    try {
      toast('Downloading backup…');
      const blob = await (await api('GET', `${DRV}/files/${encodeURIComponent(id)}?alt=media`)).blob();
      closeSheet();
      A.imp({ files: [new File([blob], name, { type: 'application/json' })], value: '' });
    } catch (e) { if (e instanceof AuthErr) { closeSheet(); auth('restore', true); } else toast(e.message || 'Download failed'); }
  };

  /* ---------- actions ---------- */
  A.driveConnect = () => auth('connect', true);
  A.driveNow = async () => { if (tokOk()) { toast('Backing up…'); if ((await backup(true)) === 'noauth') auth('backup', true); } else auth('backup', true); };
  A.driveRestore = () => { if (tokOk()) openRestore(); else auth('restore', true); };
  A.driveOff = () => {
    if (!confirm('Stop automatic backup to Google Drive? Backups already in Drive are kept.')) return;
    if (tok) { try { fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(tok.v), { method: 'POST', mode: 'no-cors' }); } catch (e) { /* ignore */ } }
    tok = null; try { sessionStorage.removeItem('sdodesk.tok'); } catch (e) { /* ignore */ }
    D = { email: D.email, folderId: D.folderId }; saveD(); refresh(); toast('Google Drive disconnected');
  };

  /* ---------- UI ---------- */
  function card() {
    if (!D.connected) return `<h2>Google Drive</h2><div class="card"><p class="meta" style="margin-top:0">Connect once and the app backs up automatically to a "${FOLDER}" folder in your Drive after every change. The last ${KEEP} days are kept. The app can only see files it creates.</p><div class="acts"><button class="btn p" onclick="A.driveConnect()">Connect Google Drive</button></div></div>`;
    const st = D.paused ? '<span class="rd">Paused: sign in again</span>' : running ? 'Backing up…' : D.dirty ? 'Changes waiting to back up' : 'Up to date';
    return `<h2>Google Drive</h2><div class="card"><div class="ct">${esc(D.email || 'Connected')}</div><div class="meta">${st}${D.last ? ' · last ' + fmtTs(D.last) : ''}${D.size ? ' · ' + fsize(D.size) : ''}</div>${D.err && D.dirty && !running ? `<div class="meta rd">${esc(D.err)}</div>` : ''}
      <div class="acts">${D.paused ? '<button class="btn p" onclick="A.driveNow()">Sign in again</button>' : '<button class="btn p" onclick="A.driveNow()">Back up now</button>'}<button class="btn" onclick="A.driveRestore()">Restore from Drive</button><button class="btn d" onclick="A.driveOff()">Disconnect</button></div></div>`;
  }
  function decorate() {
    const v = curView(), m = $('#main');
    if (!m) return;
    if (v === 'settings' && !$('#drvcard')) {
      const w = document.createElement('div'); w.id = 'drvcard'; w.innerHTML = card();
      const h = [...m.querySelectorAll('h2')].find(x => x.textContent.trim() === 'Backup');
      if (h && h.nextElementSibling) h.nextElementSibling.after(w); else m.prepend(w);
    }
    if (v === 'home' && D.connected) {
      const warn = [...m.querySelectorAll('.card.warn')].find(x => /Backup (last taken|never taken)/.test(x.textContent));
      if (D.paused && !$('#drvwarn')) {
        const w = document.createElement('div'); w.id = 'drvwarn'; w.className = 'card warn'; w.onclick = () => A.driveNow();
        w.innerHTML = '<b>Google Drive backup paused.</b> Tap to sign in again.';
        (warn || m.firstElementChild) ? (warn || m.firstElementChild).before(w) : m.append(w);
      }
      if (warn && !D.paused) warn.remove();
    }
  }
  function refresh() { const c = $('#drvcard'); if (c) c.innerHTML = card(); else decorate(); }
  const origRender = window.render;
  window.render = function () { origRender.apply(this, arguments); decorate(); };
  window.addEventListener('hashchange', () => setTimeout(decorate, 0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { setTimeout(decorate, 0); autoSync(); } });
  window.addEventListener('online', autoSync);

  /* ---------- start ---------- */
  const ar = readReturn();
  render();
  if (ar) {
    if (ar.ok) {
      D.connected = true; D.paused = false; D.err = ''; D.dirty = true; saveD();
      (async () => {
        try { if (!D.email) await whoAmI(); saveD(); } catch (e) { /* ignore */ }
        if (ar.after === 'restore') { openRestore(); return; }
        const r = await backup(!!ar.interactive);
        if (ar.after === 'connect' && r === 'ok') toast('Google Drive connected. Automatic backup is on.');
      })();
    } else if (ar.error !== 'state_mismatch') {
      if (ar.interactive) toast(ar.error === 'access_denied' ? 'Google Drive permission was not given' : 'Google sign-in failed: ' + ar.error);
      else if (D.connected) { D.paused = true; saveD(); }
      render();
    }
  } else setTimeout(autoSync, 2500);
})();
