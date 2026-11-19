'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const hms = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`; };
const human = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}h ${pad(m)}min` : m ? `${m} min ${pad(x)} s` : `${x} s`; };
const gb = (b) => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB';
const LANGS = { pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', it: 'Italiano', de: 'Alemão', ja: 'Japonês', zh: 'Chinês', auto: 'Automático' };
const IC = {
  wave: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>',
  ok: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  err: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>',
  x: '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 2l8 8M10 2l-8 8"/></svg>',
  retry: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>',
  doc: '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/></svg>',
  folder: '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'
};

let S = { settings: {}, jobs: [], transcripts: [], models: [], engine: {}, gpu: {}, downloads: {} };
let page = 'tr';
const spark = new Array(40).fill(0);

function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3400); }
async function setS(p) { S.settings = { ...S.settings, ...p }; renderOptions(); await window.vt.settings(p); }

// ---------- Navegação ----------
function go(p) {
  page = p;
  $$('.navlink').forEach((b) => b.dataset.nav === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  $$('.page').forEach((x) => x.classList.toggle('active', x.dataset.page === p));
  $('main').scrollTop = 0;
  if (p === 'docs') renderDocs();
}
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => go(b.dataset.nav)));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
$$('[data-win]').forEach((b) => b.addEventListener('click', () => window.vt.win(b.dataset.win)));

// ---------- Arquivos ----------
$('#btnPick').addEventListener('click', async () => { const n = await window.vt.pickFiles(); if (n) toast(n === 1 ? '1 arquivo adicionado à fila' : n + ' arquivos adicionados à fila'); });
const drop = $('#drop');
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); if (page === 'tr') drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []).map((f) => window.vt.pathFor(f)).filter(Boolean);
  if (!files.length) return;
  const n = await window.vt.addFiles(files);
  toast(n ? (n === 1 ? '1 arquivo adicionado à fila' : n + ' arquivos adicionados à fila') : 'Esses arquivos já estão na fila');
  go('tr');
});

// ---------- Fila ----------
function jobState(j) {
  if (j.status === 'queued') return S.paused ? 'Pausado' : 'Aguardando';
  if (j.status === 'waiting-model') return 'Esperando o modelo';
  if (j.status === 'converting') return 'Preparando ' + Math.floor(j.progress || 0) + '%';
  if (j.status === 'transcribing') return Math.floor(j.progress || 0) + '%';
  if (j.status === 'done') return 'Concluído';
  if (j.status === 'canceled') return 'Cancelado';
  return 'Erro';
}
function jobMeta(j) {
  const dur = j.duration ? hms(j.duration) + ' de áudio' : '';
  if (j.status === 'error') return j.error || 'Falhou';
  if (j.status === 'waiting-model') { const m = S.models.find((x) => x.id === S.settings.model); const d = m && m.downloading; return d && d.error ? 'Falha ao baixar o modelo: ' + d.error : 'Baixando o modelo ' + (m ? m.label : '') + (d && d.pct ? ' — ' + d.pct + '%' : '…'); }
  if (j.status === 'done') return ['Concluído em ' + human(j.elapsed), dur, (j.outputs || []).map((p) => p.split('.').pop().toUpperCase()).join(', ')].filter(Boolean).join(' · ');
  if (j.status === 'transcribing' || j.status === 'converting') {
    const el = (Date.now() - (j.startedAt || Date.now())) / 1000;
    const p = j.progress || 0;
    const rest = p > 12 ? el / p * (100 - p) : null;
    return [j.engine === 'cuda' ? 'Placa de vídeo' : 'Processador', dur, rest ? '~' + human(rest) + ' restantes' : ''].filter(Boolean).join(' · ');
  }
  return [j.origin === 'Voxa' ? 'Do Voxa' : '', dur].filter(Boolean).join(' · ') || 'Na fila';
}
function renderQueue() {
  const list = S.jobs;
  const running = list.filter((j) => ['converting', 'transcribing'].includes(j.status)).length;
  const waiting = list.filter((j) => ['queued', 'waiting-model'].includes(j.status)).length;
  $('#queueSum').textContent = [running ? running + ' transcrevendo' : '', waiting ? waiting + ' na fila' : ''].filter(Boolean).join(' · ');
  const badge = $('#navBadge'); badge.textContent = running + waiting; badge.style.display = running + waiting ? 'block' : 'none';
  $('#btnPause').textContent = S.paused ? 'Retomar fila' : 'Pausar fila';
  $('#queue').innerHTML = list.length ? list.map((j) => {
    const cls = j.status === 'done' ? 'done' : j.status === 'error' ? 'error' : ['converting', 'transcribing'].includes(j.status) ? 'run' : '';
    const indet = j.status === 'waiting-model' || (j.status === 'converting' && !j.duration);
    const pct = j.status === 'done' ? 100 : j.status === 'error' || j.status === 'canceled' ? 100 : j.progress || 0;
    return `<div class="job ${cls}" data-id="${esc(j.id)}">
      <div class="jicon">${j.status === 'done' ? IC.ok : j.status === 'error' ? IC.err : IC.wave}</div>
      <div class="grow" style="gap:6px">
        <div class="row" style="align-items:baseline"><span class="ell" style="font-size:14px;font-weight:600" title="${esc(j.src)}">${esc(j.name)}</span><span class="jstate">${esc(jobState(j))}</span></div>
        <div class="bar ${indet ? 'indet' : ''}"><i style="width:${pct}%;${j.status === 'canceled' ? 'background:rgba(255,255,255,.2);box-shadow:none' : ''}"></i></div>
        <span class="small muted ell" data-meta>${esc(jobMeta(j))}</span>
      </div>
      ${j.status === 'done' ? `<button class="btn sm" data-open="${esc(j.transcriptId)}">Abrir</button>` : ''}
      ${j.status === 'error' || j.status === 'canceled' ? `<button class="iconbtn" aria-label="Tentar de novo" title="Tentar de novo" data-retry="${esc(j.id)}">${IC.retry}</button>` : ''}
      ${['done', 'error', 'canceled'].includes(j.status) ? `<button class="iconbtn" aria-label="Remover da fila" title="Remover da fila" data-remove="${esc(j.id)}">${IC.x}</button>` : `<button class="iconbtn" aria-label="Cancelar" title="Cancelar" data-cancel="${esc(j.id)}">${IC.x}</button>`}
    </div>`;
  }).join('') : '<div class="empty" style="margin:4px 4px 10px">Nenhum arquivo na fila. Arraste áudios ou vídeos para começar.</div>';
  $$('[data-open]', $('#queue')).forEach((b) => b.addEventListener('click', () => openDoc(b.dataset.open)));
  $$('[data-retry]', $('#queue')).forEach((b) => b.addEventListener('click', () => window.vt.jobRetry(b.dataset.retry)));
  $$('[data-remove]', $('#queue')).forEach((b) => b.addEventListener('click', () => window.vt.jobRemove(b.dataset.remove)));
  $$('[data-cancel]', $('#queue')).forEach((b) => b.addEventListener('click', () => window.vt.jobCancel(b.dataset.cancel)));
}
function patchJob(j) {
  const i = S.jobs.findIndex((x) => x.id === j.id); if (i < 0) return;
  const prev = S.jobs[i]; S.jobs[i] = j;
  const el = $(`.job[data-id="${CSS.escape(j.id)}"]`);
  if (!el || prev.status !== j.status) return renderQueue();
  el.querySelector('.bar i').style.width = (j.progress || 0) + '%';
  el.querySelector('.bar').classList.toggle('indet', j.status === 'converting' && !j.duration);
  el.querySelector('.jstate').textContent = jobState(j);
  el.querySelector('[data-meta]').textContent = jobMeta(j);
}
$('#btnClear').addEventListener('click', () => window.vt.jobsClear());
$('#btnPause').addEventListener('click', () => window.vt.queuePause(!S.paused));

// ---------- Avisos (motor e modelo) ----------
function renderBanners() {
  const b = [];
  const e = S.engine, g = S.gpu, d = S.downloads || {};
  if (g.nvidia && !e.cudaInstalled) {
    const dl = d.cuda;
    if (dl && !dl.error) b.push(`<div class="banner"><div class="grow"><b>${dl.extracting ? 'Instalando a aceleração pela placa de vídeo…' : 'Baixando a aceleração pela placa de vídeo — ' + (dl.pct || 0) + '%'}</b><span>As transcrições continuam no processador até terminar.</span><div class="bar" style="margin-top:8px"><i style="width:${dl.pct || 0}%"></i></div></div>${dl.extracting ? '' : '<button class="btn sm" data-act="cuda-cancel">Cancelar</button>'}</div>`);
    else b.push(`<div class="banner"><div class="grow"><b>Ative a aceleração pela sua ${esc(g.name || 'placa NVIDIA')}</b><span>${dl && dl.error ? 'Falhou: ' + esc(dl.error) + '. ' : ''}Download único de ${esc(e.cudaSize || '670 MB')}. Transcreve muitas vezes mais rápido que o processador.</span></div><button class="btn primary sm" data-act="cuda">${dl && dl.error ? 'Tentar de novo' : 'Ativar'}</button></div>`);
  }
  if (!g.nvidia && g.name && page !== 'models') b.push(`<div class="banner warn"><div class="grow"><b>Transcrevendo no processador</b><span>A aceleração por GPU deste app usa placas NVIDIA. Detectamos: ${esc(g.name)}. Funciona normalmente, só que mais devagar — prefira os modelos "small" ou "large-v3-turbo compacto".</span></div></div>`);
  const m = S.models.find((x) => x.id === S.settings.model);
  if (m && !m.have) {
    const dl = m.downloading;
    if (dl && !dl.error) b.push(`<div class="banner"><div class="grow"><b>Baixando o modelo ${esc(m.label)} — ${dl.pct || 0}%</b><span>${dl.total ? gb(dl.received || 0) + ' de ' + gb(dl.total) : 'Iniciando…'} · só na primeira vez</span><div class="bar" style="margin-top:8px"><i style="width:${dl.pct || 0}%"></i></div></div><button class="btn sm" data-act="model-cancel" data-id="${m.id}">Cancelar</button></div>`);
    else b.push(`<div class="banner warn"><div class="grow"><b>Baixe o modelo ${esc(m.label)} para começar</b><span>${dl && dl.error ? 'Falhou: ' + esc(dl.error) + '. ' : ''}${esc(m.size)} · fica salvo no computador e funciona sem internet depois.</span></div><button class="btn primary sm" data-act="model" data-id="${m.id}">Baixar</button></div>`);
  }
  $('#banners').innerHTML = b.join('');
  $('#engBanner').innerHTML = b.filter((x) => /cuda|placa/i.test(x)).join('');
  $$('[data-act]').forEach((x) => x.addEventListener('click', () => {
    const a = x.dataset.act;
    if (a === 'cuda') window.vt.cudaInstall(); else if (a === 'cuda-cancel') window.vt.cudaCancel();
    else if (a === 'model') window.vt.modelDownload(x.dataset.id); else if (a === 'model-cancel') window.vt.modelCancel(x.dataset.id);
  }));
}

// ---------- Opções ----------
function renderOptions() {
  const s = S.settings;
  $('#oModel').innerHTML = S.models.map((m) => `<option value="${m.id}">${esc(m.label)} — ${esc(m.desc.toLowerCase())}${m.have ? '' : ' (baixar ' + esc(m.size) + ')'}</option>`).join('');
  $('#oModel').value = s.model;
  $('#oLang').value = s.lang;
  $$('#oOuts button').forEach((b) => b.setAttribute('aria-pressed', (s.outs || []).includes(b.dataset.o)));
  $$('[data-out]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.out === s.outMode));
  $('#outFolderRow').style.display = s.outMode === 'folder' ? 'flex' : 'none';
  $('#outFolder').textContent = s.outFolder || '';
  $('#oTs').setAttribute('aria-pressed', !!s.timestamps);
  $('#oVad').setAttribute('aria-pressed', !!s.vad);
  if (document.activeElement !== $('#oPrompt')) $('#oPrompt').value = s.prompt || '';
  $$('#devSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.dev === s.device));
  $('#threads').value = s.threads; $('#thrVal').textContent = s.threads;
  $('#pWatch').setAttribute('aria-pressed', !!s.watchVoxa);
  $('#pNotify').setAttribute('aria-pressed', !!s.notify);
}
$('#oModel').addEventListener('change', (e) => setS({ model: e.target.value }));
$('#oLang').addEventListener('change', (e) => setS({ lang: e.target.value }));
$$('#oOuts button').forEach((b) => b.addEventListener('click', () => { const o = b.dataset.o, cur = S.settings.outs || []; setS({ outs: cur.includes(o) ? cur.filter((x) => x !== o) : cur.concat(o) }); }));
$$('[data-out]').forEach((b) => b.addEventListener('click', () => setS({ outMode: b.dataset.out })));
$('#btnOutFolder').addEventListener('click', async () => { const p = await window.vt.pickFolder(S.settings.outFolder); if (p) setS({ outFolder: p }); });
$('#oTs').addEventListener('click', () => setS({ timestamps: !S.settings.timestamps }));
$('#oVad').addEventListener('click', () => setS({ vad: !S.settings.vad }));
$('#oPrompt').addEventListener('change', (e) => setS({ prompt: e.target.value }));
$$('#devSeg button').forEach((b) => b.addEventListener('click', () => setS({ device: b.dataset.dev })));
$('#threads').addEventListener('input', (e) => { $('#thrVal').textContent = e.target.value; });
$('#threads').addEventListener('change', (e) => setS({ threads: Number(e.target.value) }));
$('#pWatch').addEventListener('click', () => setS({ watchVoxa: !S.settings.watchVoxa }));
$('#pNotify').addEventListener('click', () => setS({ notify: !S.settings.notify }));
$('#btnMDir').addEventListener('click', () => { const m = S.models[0]; if (m) window.vt.openPath(m.path.replace(/[\\/][^\\/]+$/, '')); });

// ---------- GPU ----------
const sparkEl = $('#spark'); sparkEl.innerHTML = spark.map(() => '<span></span>').join('');
function renderGpu() {
  const g = S.gpu || {}, e = S.engine || {};
  const onGpu = e.active === 'cuda';
  $('#gName').textContent = g.name || 'Placa de vídeo não identificada';
  $('#gTag').textContent = onGpu ? 'CUDA' : 'PROCESSADOR'; $('#gTag').className = 'tag ' + (onGpu ? 'ok' : 'warn');
  $('#navDot').className = 'gdot' + (onGpu ? '' : ' cpu');
  $('#navEng').textContent = onGpu ? 'GPU pronta' : 'Usando o processador';
  $('#navGpu').textContent = g.name || '';
  $('#gStats').style.display = g.nvidia ? 'flex' : 'none';
  if (g.nvidia) {
    spark.push(g.util || 0); spark.shift();
    $$('#spark span').forEach((s, i) => { s.style.height = Math.max(2, spark[i] / 100 * 36) + 'px'; });
    $('#gUse').textContent = (g.util ?? 0) + '%';
    $('#gMem').textContent = g.memTotal ? `${(g.memUsed / 1024).toFixed(1).replace('.', ',')} de ${(g.memTotal / 1024).toFixed(0)} GB` : '—';
    $('#gMemBar').style.width = g.memTotal ? (g.memUsed / g.memTotal * 100) + '%' : '0';
  }
  $('#gNote').textContent = onGpu ? 'As transcrições rodam na placa de vídeo.' : g.nvidia ? (e.cudaInstalled ? 'Dispositivo definido como processador.' : 'Ative a aceleração no aviso acima.') : 'Sem placa NVIDIA: transcrição pelo processador.';
  $('#devHint').textContent = onGpu ? 'Usando agora: placa de vídeo (CUDA).' : 'Usando agora: processador.';
}

// ---------- Modelos ----------
function renderModels() {
  $('#mDir').textContent = S.models[0] ? S.models[0].path.replace(/[\\/][^\\/]+$/, '') : '';
  $('#models').innerHTML = S.models.map((m) => {
    const def = S.settings.model === m.id, d = m.downloading;
    const dots = (n, c) => `<span class="dots ${c}" aria-label="${n} de 5">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? 'on' : ''}"></span>`).join('')}</span>`;
    return `<div class="card model ${def ? 'def' : ''}">
      <div class="row" style="align-items:flex-start"><div class="grow" style="gap:3px"><span style="font-size:16px;font-weight:700">${esc(m.label)}</span><span class="small muted">${esc(m.desc)}</span></div>${def ? '<span class="tag white">Padrão</span>' : ''}</div>
      <div style="display:flex;flex-direction:column;gap:8px"><div class="row small"><span class="muted">Velocidade</span>${dots(m.speed, 's')}</div><div class="row small"><span class="muted">Precisão</span>${dots(m.acc, 'a')}</div></div>
      ${d && !d.error ? `<div style="display:flex;flex-direction:column;gap:6px"><div class="bar"><i style="width:${d.pct || 0}%"></i></div><span class="small" style="color:#64d2ff">Baixando… ${d.pct || 0}%</span></div>` : ''}
      ${d && d.error ? `<span class="small" style="color:#ff6961">Falha: ${esc(d.error)}</span>` : ''}
      <div class="row" style="margin-top:auto"><span class="small muted">${esc(m.size)} · ${d && !d.error ? 'baixando' : m.have ? 'baixado' : 'não baixado'}</span>
        <div style="display:flex;gap:6px">
          ${d && !d.error ? `<button class="btn sm" data-mc="${m.id}">Cancelar</button>` : !m.have ? `<button class="btn sm" data-md="${m.id}">Baixar</button>` : ''}
          ${m.have && !def ? `<button class="iconbtn" aria-label="Excluir ${esc(m.label)}" title="Excluir do computador" data-mx="${m.id}">${IC.x}</button>` : ''}
          ${!def ? `<button class="btn sm primary" data-mu="${m.id}">Usar</button>` : ''}
        </div></div>
    </div>`;
  }).join('');
  $$('[data-md]').forEach((b) => b.addEventListener('click', () => window.vt.modelDownload(b.dataset.md)));
  $$('[data-mc]').forEach((b) => b.addEventListener('click', () => window.vt.modelCancel(b.dataset.mc)));
  $$('[data-mu]').forEach((b) => b.addEventListener('click', () => { setS({ model: b.dataset.mu }); const m = S.models.find((x) => x.id === b.dataset.mu); if (m && !m.have) window.vt.modelDownload(m.id); }));
  $$('[data-mx]').forEach((b) => b.addEventListener('click', () => { const m = S.models.find((x) => x.id === b.dataset.mx); if (confirm('Excluir o modelo ' + m.label + ' do computador?')) window.vt.modelDelete(m.id); }));
}

// ---------- Transcrições ----------
let docQ = '';
$('#docQ').addEventListener('input', (e) => { docQ = e.target.value.toLowerCase(); renderDocs(); });
function renderDocs() {
  const list = S.transcripts.filter((t) => !docQ || t.name.toLowerCase().includes(docQ));
  $('#docCount').textContent = S.transcripts.length + (S.transcripts.length === 1 ? ' transcrição' : ' transcrições');
  $('#docs').innerHTML = list.length ? list.map((t) => `
    <button class="trow" data-doc="${esc(t.id)}">
      <div class="jicon">${IC.doc}</div>
      <div class="grow" style="gap:3px"><span class="ell" style="font-size:14px;font-weight:600">${esc(t.name)}</span>
        <span class="small muted ell">${new Date(t.created).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${hms(t.duration)} · ${t.words.toLocaleString('pt-BR')} palavras · ${esc(t.model)}</span></div>
      <span class="tag">${esc((t.language || '').toUpperCase())}</span>
    </button>`).join('') : `<div class="empty" style="margin:12px">${S.transcripts.length ? 'Nada encontrado.' : 'As transcrições concluídas aparecem aqui.'}</div>`;
  $$('[data-doc]').forEach((b) => b.addEventListener('click', () => openDoc(b.dataset.doc)));
}

let doc = null, curSeg = -1, findQ = '';
const audio = $('#audio');
async function openDoc(id) {
  const t = await window.vt.transcript(id);
  if (!t) { toast('Transcrição não encontrada'); return; }
  doc = t; curSeg = -1; findQ = ''; $('#find').value = '';
  go('docs');
  $('#docList').style.display = 'none'; $('#docView').style.display = 'flex';
  $('#docTitle').textContent = t.name;
  $('#pErr').style.display = 'none';
  audio.src = 'file:///' + t.src.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  audio.playbackRate = 1; $$('#speeds button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sp === '1'));
  $('#pDur').textContent = hms(t.duration);
  $('#info').innerHTML = [
    ['Idioma', LANGS[t.language] || t.language], ['Modelo', t.model], ['Processado em', human(t.elapsed) + (t.engine === 'cuda' ? ' (GPU)' : ' (processador)')],
    ['Duração', hms(t.duration)], ['Velocidade', t.elapsed ? Math.max(1, Math.round(t.duration / t.elapsed)) + '× o tempo real' : '—'], ['Palavras', t.words.toLocaleString('pt-BR')]
  ].map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('') +
    (t.outputs && t.outputs.length ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">${t.outputs.map((p, i) => `<button class="linkbtn ell" style="text-align:left;display:flex;gap:6px;align-items:center" data-out-i="${i}">${IC.folder}${esc(p.split(/[\\/]/).pop())}</button>`).join('')}</div>` : '');
  $$('[data-out-i]').forEach((b) => b.addEventListener('click', () => window.vt.reveal(t.outputs[Number(b.dataset.outI)])));
  renderSegs();
  $('main').scrollTop = 0;
}
function hl(text) {
  if (!findQ) return esc(text);
  const i = text.toLowerCase().indexOf(findQ); if (i < 0) return esc(text);
  let out = '', pos = 0, low = text.toLowerCase();
  for (let k = low.indexOf(findQ); k >= 0; k = low.indexOf(findQ, pos)) { out += esc(text.slice(pos, k)) + '<mark>' + esc(text.slice(k, k + findQ.length)) + '</mark>'; pos = k + findQ.length; }
  return out + esc(text.slice(pos));
}
function renderSegs() {
  let hits = 0;
  $('#segs').innerHTML = doc.segments.map((s, i) => {
    const hit = findQ && s.text.toLowerCase().includes(findQ); if (hit) hits++;
    return `<div class="sg ${i === curSeg ? 'cur' : ''} ${hit ? 'hit' : ''} ${findQ && !hit ? 'dimmed' : ''}" data-i="${i}">
      <button class="t" data-seek="${i}" aria-label="Ouvir a partir de ${hms(s.start / 1000)}">${hms(s.start / 1000)}</button>
      <div class="tx" contenteditable="plaintext-only" spellcheck="true" data-edit="${i}">${hl(s.text)}</div></div>`;
  }).join('') || '<div class="empty">Nenhuma fala encontrada neste áudio.</div>';
  $('#hits').textContent = findQ ? hits + (hits === 1 ? ' resultado' : ' resultados') : '';
  $$('[data-seek]').forEach((b) => b.addEventListener('click', () => { audio.currentTime = doc.segments[Number(b.dataset.seek)].start / 1000; audio.play().catch(() => {}); }));
  $$('[data-edit]').forEach((el) => {
    el.addEventListener('focus', () => { if (findQ) el.textContent = doc.segments[Number(el.dataset.edit)].text; });
    el.addEventListener('blur', () => {
      const i = Number(el.dataset.edit), v = el.textContent.replace(/\s+/g, ' ').trim();
      if (v !== doc.segments[i].text) { doc.segments[i].text = v; saveDoc(); }
      if (findQ) el.innerHTML = hl(doc.segments[i].text);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } if (e.key === 'Escape') { el.textContent = doc.segments[Number(el.dataset.edit)].text; el.blur(); } });
  });
}
let saveT = null;
function saveDoc() { clearTimeout(saveT); saveT = setTimeout(async () => { await window.vt.transcriptSave(doc); toast('Correção salva'); }, 300); }
$('#find').addEventListener('input', (e) => { findQ = e.target.value.trim().toLowerCase(); renderSegs(); });
$('#btnBack').addEventListener('click', () => { audio.pause(); $('#docView').style.display = 'none'; $('#docList').style.display = 'flex'; doc = null; renderDocs(); });
$$('[data-exp]').forEach((b) => b.addEventListener('click', async () => { if (!doc) return; await window.vt.transcriptSave(doc); const p = await window.vt.exportAs({ id: doc.id, fmt: b.dataset.exp }); if (p) toast('Exportado: ' + p.split(/[\\/]/).pop()); }));
$('#btnCopy').addEventListener('click', async () => { if (!doc) return; await window.vt.transcriptSave(doc); await window.vt.copyText(doc.id); toast('Texto copiado'); });
$('#btnReveal').addEventListener('click', () => doc && window.vt.reveal(doc.src));
$('#btnDelDoc').addEventListener('click', async () => { if (doc && confirm('Excluir esta transcrição? Os arquivos já exportados não são apagados.')) { await window.vt.transcriptDelete(doc.id); $('#btnBack').click(); } });

// Player
$('#pPlay').addEventListener('click', () => { audio.paused ? audio.play().catch(() => { $('#pErr').style.display = 'block'; }) : audio.pause(); });
audio.addEventListener('play', () => { $('#icPlay').style.display = 'none'; $('#icPause').style.display = ''; $('#pPlay').setAttribute('aria-label', 'Pausar'); });
audio.addEventListener('pause', () => { $('#icPlay').style.display = ''; $('#icPause').style.display = 'none'; $('#pPlay').setAttribute('aria-label', 'Reproduzir'); });
audio.addEventListener('error', () => { if (doc) $('#pErr').style.display = 'block'; });
audio.addEventListener('loadedmetadata', () => { if (isFinite(audio.duration)) $('#pDur').textContent = hms(audio.duration); });
audio.addEventListener('timeupdate', () => {
  if (!doc) return;
  const dur = isFinite(audio.duration) && audio.duration ? audio.duration : doc.duration || 1;
  const p = Math.min(100, audio.currentTime / dur * 100);
  $('#seekFill').style.width = p + '%'; $('#seekKnob').style.left = p + '%'; $('#seek').setAttribute('aria-valuenow', Math.round(p));
  $('#pNow').textContent = hms(audio.currentTime);
  const ms = audio.currentTime * 1000;
  let i = -1; for (let k = 0; k < doc.segments.length; k++) { if (doc.segments[k].start <= ms) i = k; else break; }
  if (i !== curSeg) {
    const old = $(`.sg[data-i="${curSeg}"]`); if (old) old.classList.remove('cur');
    curSeg = i; const el = $(`.sg[data-i="${i}"]`);
    if (el) { el.classList.add('cur'); if (!audio.paused && document.activeElement?.dataset?.edit === undefined) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
});
function seekTo(e) { const r = $('#seek').getBoundingClientRect(); const dur = isFinite(audio.duration) ? audio.duration : doc.duration; audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur; }
$('#seek').addEventListener('pointerdown', (e) => { seekTo(e); const mv = (ev) => seekTo(ev); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', () => window.removeEventListener('pointermove', mv), { once: true }); });
$('#seek').addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') audio.currentTime += 5; if (e.key === 'ArrowLeft') audio.currentTime -= 5; });
$$('#speeds button').forEach((b) => b.addEventListener('click', () => { audio.playbackRate = Number(b.dataset.sp); $$('#speeds button').forEach((x) => x.setAttribute('aria-pressed', x === b)); }));

// ---------- Voxa ----------
$('#btnVoxa').addEventListener('click', async () => {
  const list = await window.vt.voxaList();
  if (!list) { toast('Não encontramos o Voxa neste computador.'); return; }
  $('#vList').innerHTML = list.length ? list.map((r, i) => `<label class="vrow"><input type="checkbox" data-v="${i}" ${r.already ? '' : 'checked'}><div class="grow" style="gap:2px"><span class="ell" style="font-size:14px;font-weight:600">${esc(r.name)}</span><span class="small muted">${new Date(r.start).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${hms(r.duration)}${r.already ? ' · já transcrita' : ''}</span></div><span class="tag">${esc(r.origin || '')}</span></label>`).join('') : '<div class="empty">Nenhuma gravação do Voxa encontrada.</div>';
  $('#voxaModal').classList.add('open');
  $('#voxaModal').dataset.list = JSON.stringify(list.map((r) => r.path));
  $('#vList').dataset.already = JSON.stringify(list.map((r) => r.already));
});
$('#vClose').addEventListener('click', () => $('#voxaModal').classList.remove('open'));
$('#voxaModal').addEventListener('click', (e) => { if (e.target.id === 'voxaModal') $('#voxaModal').classList.remove('open'); });
$('#vAll').addEventListener('click', () => { const a = JSON.parse($('#vList').dataset.already || '[]'); $$('#vList input').forEach((c, i) => { c.checked = !a[i]; }); });
$('#vAdd').addEventListener('click', async () => {
  const paths = JSON.parse($('#voxaModal').dataset.list || '[]');
  const sel = $$('#vList input').filter((c) => c.checked).map((c) => paths[Number(c.dataset.v)]);
  $('#voxaModal').classList.remove('open');
  if (sel.length) { const n = await window.vt.addFiles(sel); toast(n + (n === 1 ? ' gravação adicionada' : ' gravações adicionadas')); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#voxaModal').classList.remove('open'); });

// ---------- Estado ----------
function apply(st) {
  S = { ...S, ...st }; S.paused = !!st.paused;
  renderOptions(); renderQueue(); renderBanners(); renderGpu(); renderModels();
  if (page === 'docs' && !doc) renderDocs();
}
window.vt.onState(apply);
window.vt.onJob(patchJob);
window.vt.onGpu((g) => { S.gpu = g; renderGpu(); });
window.vt.onDownload((d) => {
  S.downloads[d.key] = d;
  if (d.key.startsWith('model:')) { const m = S.models.find((x) => 'model:' + x.id === d.key); if (m) m.downloading = d; if (page === 'models') renderModels(); }
  renderBanners(); S.jobs.filter((j) => j.status === 'waiting-model').forEach(patchJob);
});
setInterval(() => S.jobs.filter((j) => ['converting', 'transcribing'].includes(j.status)).forEach(patchJob), 1000);
(async () => { apply(await window.vt.state()); })();
