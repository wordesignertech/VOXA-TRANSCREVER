'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const exporters = require('./exporters');

app.setAppUserModelId('com.wordesigner.voxa.transcrever');
app.commandLine.appendSwitch('lang', 'pt-BR');
if (!app.requestSingleInstanceLock()) app.quit();

const CUDA_URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip';
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const VAD_URL = 'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin';
const MODELS = [
  { id: 'large-v3-turbo', file: 'ggml-large-v3-turbo.bin', label: 'large-v3-turbo', desc: 'Melhor custo-benefício', size: '1,6 GB', bytes: 1624555275, speed: 4, acc: 5 },
  { id: 'large-v3-turbo-q5_0', file: 'ggml-large-v3-turbo-q5_0.bin', label: 'large-v3-turbo compacto', desc: 'Quase a mesma precisão, menos memória', size: 574 + ' MB', bytes: 574041195, speed: 4, acc: 4 },
  { id: 'large-v3', file: 'ggml-large-v3.bin', label: 'large-v3', desc: 'Máxima precisão, mais lento', size: '3,1 GB', bytes: 3095033483, speed: 2, acc: 5 },
  { id: 'medium', file: 'ggml-medium.bin', label: 'medium', desc: 'Equilibrado', size: '1,5 GB', bytes: 1533763059, speed: 3, acc: 4 },
  { id: 'small', file: 'ggml-small.bin', label: 'small', desc: 'Leve e rápido', size: '488 MB', bytes: 487601967, speed: 4, acc: 3 },
  { id: 'base', file: 'ggml-base.bin', label: 'base', desc: 'Testes rápidos', size: '148 MB', bytes: 147951465, speed: 5, acc: 2 },
  { id: 'tiny', file: 'ggml-tiny.bin', label: 'tiny', desc: 'Mínimo', size: '78 MB', bytes: 77691713, speed: 5, acc: 1 }
];

let win = null;
let quitting = false;

// ---------- Pastas ----------
const isAscii = (p) => /^[\x00-\x7F]*$/.test(p);
function workDir() {
  // O motor whisper.cpp não aceita caminhos com acentos: usa uma pasta "segura"
  if (process.env.VOXT_WORKDIR) return process.env.VOXT_WORKDIR;
  const local = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'VoxaTranscrever');
  if (isAscii(local)) return local;
  return path.join(process.env.ProgramData || 'C:\\ProgramData', 'VoxaTranscrever');
}
const W = () => workDir();
const modelsDir = () => db.settings.modelsDir || path.join(W(), 'modelos');
const tmpDir = () => path.join(W(), 'tmp');
const cudaDir = () => path.join(W(), 'motor-cuda');
const transcriptsDir = () => path.join(app.getPath('userData'), 'transcricoes');
const DATA_FILE = () => path.join(app.getPath('userData'), 'dados.json');
const res = (...p) => app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, '..', 'vendor', ...p);
const EXE = process.platform === 'win32' ? '.exe' : '';
const ffmpegPath = () => process.env.VOXT_FFMPEG || res('bin', 'ffmpeg' + EXE);
const cpuWhisper = () => process.env.VOXT_WHISPER || res('motor-cpu', 'whisper-cli' + EXE);
const cudaWhisper = () => path.join(cudaDir(), 'whisper-cli' + EXE);

// ---------- Dados ----------
function defaults() {
  return {
    settings: {
      model: 'large-v3-turbo', lang: 'pt', outs: ['txt', 'srt'], timestamps: true, vad: true, notify: true,
      watchVoxa: false, outMode: 'same', outFolder: path.join(app.getPath('documents'), 'Transcrições'),
      device: 'auto', threads: Math.max(2, Math.min(8, os.cpus().length - 1)), prompt: '', modelsDir: '', voxaSeen: 0
    },
    jobs: [], transcripts: []
  };
}
let db = defaults();
function load() {
  try { const r = JSON.parse(fs.readFileSync(DATA_FILE(), 'utf8')); const d = defaults(); db = { ...d, ...r, settings: { ...d.settings, ...(r.settings || {}) } }; }
  catch (e) { db = defaults(); }
  // trabalhos interrompidos voltam para a fila
  db.jobs.forEach((j) => { if (['converting', 'transcribing'].includes(j.status)) { j.status = 'queued'; j.progress = 0; } });
}
let saveT = null;
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 250); }
function saveNow() {
  clearTimeout(saveT);
  try { fs.mkdirSync(path.dirname(DATA_FILE()), { recursive: true }); fs.writeFileSync(DATA_FILE() + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DATA_FILE() + '.tmp', DATA_FILE()); } catch (e) { console.error(e); }
}
function send(ch, p) { if (win && !win.isDestroyed()) win.webContents.send(ch, p); }
function pushState() { send('state', publicState()); }
function publicState() {
  return { paused: !!db.paused, settings: db.settings, jobs: db.jobs, transcripts: db.transcripts, models: modelStatus(), engine: engineStatus(), gpu: gpuInfo, downloads };
}

// ---------- GPU ----------
let gpuInfo = { vendor: 'unknown', name: '', nvidia: false, util: null, memUsed: null, memTotal: null };
function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}
async function detectGpu() {
  const out = await run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits']);
  if (out && out.trim()) {
    const [name, util, used, total] = out.trim().split('\n')[0].split(',').map((s) => s.trim());
    gpuInfo = { vendor: 'nvidia', nvidia: true, name, util: Number(util), memUsed: Number(used), memTotal: Number(total) };
    return;
  }
  if (process.platform === 'win32' && !gpuInfo.name) {
    const ps = await run('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "|"'], 8000);
    const names = (ps || '').trim().split('|').filter(Boolean);
    const name = names.find((n) => /nvidia|radeon|amd|intel|arc/i.test(n)) || names[0] || '';
    gpuInfo = { vendor: /nvidia/i.test(name) ? 'nvidia' : /amd|radeon/i.test(name) ? 'amd' : /intel|arc/i.test(name) ? 'intel' : 'unknown', nvidia: false, name, util: null, memUsed: null, memTotal: null };
  }
}
let gpuTimer = null;
function startGpuPolling() {
  clearInterval(gpuTimer);
  gpuTimer = setInterval(async () => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
    if (gpuInfo.nvidia) { await detectGpu(); send('gpu', gpuInfo); }
  }, 2000);
}

// ---------- Motor ----------
function engineStatus() {
  const cudaOk = fs.existsSync(cudaWhisper());
  const cpuOk = fs.existsSync(cpuWhisper());
  let active = 'cpu';
  if (db.settings.device !== 'cpu' && cudaOk && gpuInfo.nvidia) active = 'cuda';
  if (db.settings.device === 'gpu' && cudaOk) active = 'cuda';
  return { cudaInstalled: cudaOk, cpuInstalled: cpuOk, active, cudaSize: '670 MB' };
}
function vadPath() { return path.join(modelsDir(), 'ggml-silero-v5.1.2.bin'); }

// ---------- Downloads ----------
const downloads = {}; // key -> {pct, received, total, error}
const aborters = {};
async function download(key, url, dest) {
  if (downloads[key] && !downloads[key].error) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ac = new AbortController(); aborters[key] = ac;
  downloads[key] = { pct: 0, received: 0, total: 0 };
  pushState();
  const part = dest + '.part';
  try {
    const r = await net.fetch(url, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const total = Number(r.headers.get('content-length')) || 0;
    downloads[key].total = total;
    const fd = fs.openSync(part, 'w');
    const reader = r.body.getReader();
    let received = 0, last = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      fs.writeSync(fd, Buffer.from(value)); received += value.length;
      const now = Date.now();
      if (now - last > 300) { last = now; downloads[key].received = received; downloads[key].pct = total ? Math.floor(received / total * 100) : 0; send('download', { key, ...downloads[key] }); }
    }
    fs.closeSync(fd);
    if (total && received < total) throw new Error('Download incompleto');
    fs.renameSync(part, dest);
    delete downloads[key];
    return true;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch (x) {}
    if (ac.signal.aborted) { delete downloads[key]; pushState(); return false; }
    downloads[key] = { error: e.message || String(e) };
    pushState();
    throw e;
  } finally { delete aborters[key]; }
}
function extractZip(zip, dest) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(dest, { recursive: true });
    const p = spawn('tar', ['-xf', zip, '-C', dest], { windowsHide: true });
    p.on('error', () => fallback());
    p.on('close', (c) => c === 0 ? resolve() : fallback());
    function fallback() {
      const ps = spawn('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`], { windowsHide: true });
      ps.on('close', (c) => c === 0 ? resolve() : reject(new Error('Não foi possível extrair o motor')));
      ps.on('error', reject);
    }
  });
}
async function installCuda() {
  const zip = path.join(W(), 'motor-cuda.zip');
  try {
    const ok = await download('cuda', CUDA_URL, zip);
    if (!ok) return;
    downloads.cuda = { pct: 100, extracting: true }; pushState();
    const tmp = path.join(W(), 'motor-cuda-tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    await extractZip(zip, tmp);
    const inner = fs.existsSync(path.join(tmp, 'Release')) ? path.join(tmp, 'Release') : tmp;
    fs.rmSync(cudaDir(), { recursive: true, force: true });
    fs.mkdirSync(cudaDir(), { recursive: true });
    for (const f of fs.readdirSync(inner)) {
      if (/\.dll$/i.test(f) || /^whisper-cli\.exe$/i.test(f)) fs.renameSync(path.join(inner, f), path.join(cudaDir(), f));
    }
    // runtime do Visual C++ que acompanha o motor do processador
    try { for (const f of fs.readdirSync(path.dirname(cpuWhisper()))) if (/^(msvcp140|vcruntime140|vcomp140)/i.test(f) && !fs.existsSync(path.join(cudaDir(), f))) fs.copyFileSync(path.join(path.dirname(cpuWhisper()), f), path.join(cudaDir(), f)); } catch (e) {}
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    delete downloads.cuda;
    notify('Aceleração pela placa de vídeo instalada', 'As próximas transcrições vão usar a GPU.');
  } catch (e) {
    downloads.cuda = { error: e.message || String(e) };
  }
  pushState();
  kick();
}

// ---------- Modelos ----------
function modelStatus() {
  return MODELS.map((m) => {
    const p = path.join(modelsDir(), m.file);
    let have = false; try { have = fs.statSync(p).size > 1e6; } catch (e) {}
    return { ...m, have, path: p, downloading: downloads['model:' + m.id] || null };
  });
}
async function downloadModel(id) {
  const m = MODELS.find((x) => x.id === id); if (!m) return;
  try { await download('model:' + id, HF + m.file, path.join(modelsDir(), m.file)); } catch (e) {}
  pushState(); kick();
}
async function ensureVad() {
  if (fs.existsSync(vadPath())) return true;
  try { await download('vad', VAD_URL, vadPath()); return fs.existsSync(vadPath()); } catch (e) { return false; }
}

// ---------- Fila ----------
let currentProc = null;
let busy = false;
function addFiles(files, origin = 'Manual') {
  const known = new Set(db.jobs.filter((j) => j.status !== 'done' && j.status !== 'error' && j.status !== 'canceled').map((j) => j.src));
  let n = 0;
  for (const f of files) {
    if (!f || known.has(f)) continue;
    try { if (!fs.statSync(f).isFile()) continue; } catch (e) { continue; }
    db.jobs.unshift({ id: 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), src: f, name: path.basename(f), origin, status: 'queued', progress: 0, added: Date.now(), duration: null, error: null });
    n++;
  }
  db.jobs = db.jobs.slice(0, 300);
  save(); pushState(); kick();
  return n;
}
function kick() { if (!busy) setTimeout(processNext, 50); }
function updJob(j, patch, push = true) { Object.assign(j, patch); if (push) send('job', j); save(); }

function parseTime(s) { const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null; }

function convert(j, out) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-y', '-i', j.src, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', out];
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    currentProc = p;
    let err = '';
    p.stderr.on('data', (d) => {
      err += d; if (err.length > 20000) err = err.slice(-20000);
      if (!j.duration) { const m = /Duration:\s*(\d+:\d+:\d+\.\d+)/.exec(err); if (m) updJob(j, { duration: parseTime(m[1]) }); }
    });
    p.stdout.on('data', (d) => {
      const m = /out_time_us=(\d+)/.exec(String(d));
      if (m && j.duration) updJob(j, { progress: Math.min(10, (Number(m[1]) / 1e6) / j.duration * 10) });
    });
    p.on('error', (e) => reject(new Error('Conversor de áudio não encontrado')));
    p.on('close', (c) => {
      currentProc = null;
      if (j.status === 'canceled') return reject(new Error('cancelado'));
      if (c !== 0) { const line = err.trim().split('\n').slice(-1)[0] || ''; return reject(new Error(/does not contain any stream|no audio|matches no streams/i.test(err) ? 'O arquivo não tem áudio' : /Invalid data|Invalid argument|could not find codec|moov atom/i.test(err) ? 'Arquivo inválido ou corrompido — não é um áudio/vídeo legível' : 'Não foi possível ler o arquivo: ' + line.slice(0, 160))); }
      resolve();
    });
  });
}

function transcribe(j, wav, base, opts) {
  return new Promise((resolve, reject) => {
    const args = ['-m', opts.model, '-f', wav, '-l', opts.lang, '-oj', '-of', base, '-pp', '-t', String(opts.threads)];
    if (opts.vad) args.push('--vad', '--vad-model', opts.vadModel);
    if (opts.prompt) args.push('--prompt', opts.prompt);
    if (opts.engine === 'cpu') args.push('-ng');
    const p = spawn(opts.bin, args, { windowsHide: true, cwd: path.dirname(opts.bin) });
    currentProc = p;
    let log = '';
    const onData = (d) => {
      const s = String(d); log += s; if (log.length > 40000) log = log.slice(-40000);
      const all = s.match(/progress\s*=\s*(\d+)%/g);
      if (all) { const v = Number(/(\d+)%/.exec(all[all.length - 1])[1]); updJob(j, { progress: 10 + v * 0.9 }); }
    };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', () => reject(new Error('Motor de transcrição não encontrado')));
    p.on('close', (c) => {
      currentProc = null;
      if (j.status === 'canceled') return reject(new Error('cancelado'));
      if (c !== 0 || !fs.existsSync(base + '.json')) {
        let msg = 'O motor de transcrição falhou (código ' + c + ').';
        if (/out of memory|cudaMalloc|failed to allocate/i.test(log)) msg = 'Faltou memória de vídeo. Use o modelo "large-v3-turbo compacto" ou um menor.';
        else if (/failed to load model|invalid model/i.test(log)) msg = 'O modelo parece corrompido. Exclua e baixe de novo em Modelos e GPU.';
        return reject(Object.assign(new Error(msg), { log }));
      }
      resolve(log);
    });
  });
}

async function processNext() {
  if (busy) return;
  const j = db.jobs.slice().reverse().find((x) => x.status === 'queued' || x.status === 'waiting-model');
  if (!j) return;
  if (db.paused) return;
  const m = MODELS.find((x) => x.id === db.settings.model) || MODELS[0];
  const mpath = path.join(modelsDir(), m.file);
  if (!fs.existsSync(mpath)) {
    updJob(j, { status: 'waiting-model', error: null });
    if (!downloads['model:' + m.id]) downloadModel(m.id);
    return;
  }
  busy = true;
  const eng = engineStatus();
  const bin = eng.active === 'cuda' ? cudaWhisper() : cpuWhisper();
  const started = Date.now();
  fs.mkdirSync(tmpDir(), { recursive: true });
  const wav = path.join(tmpDir(), j.id + '.wav');
  const base = path.join(tmpDir(), j.id);
  try {
    updJob(j, { status: 'converting', progress: 0, error: null, engine: eng.active, model: m.id, startedAt: started });
    await convert(j, wav);
    let vad = db.settings.vad;
    if (vad) vad = await ensureVad();
    updJob(j, { status: 'transcribing', progress: 10 });
    const topts = { bin, engine: eng.active, model: mpath, lang: db.settings.lang, threads: db.settings.threads, vad, vadModel: vadPath(), prompt: (db.settings.prompt || '').trim() };
    try { await transcribe(j, wav, base, topts); }
    catch (err) {
      // se a GPU falhar (driver antigo, por exemplo), tenta de novo no processador
      if (eng.active !== 'cuda' || j.status === 'canceled' || !fs.existsSync(cpuWhisper())) throw err;
      updJob(j, { status: 'transcribing', progress: 10, engine: 'cpu', gpuFallback: err.message });
      await transcribe(j, wav, base, { ...topts, bin: cpuWhisper(), engine: 'cpu' });
    }
    const raw = JSON.parse(fs.readFileSync(base + '.json', 'utf8'));
    const segments = (raw.transcription || []).map((s) => ({ start: (s.offsets && s.offsets.from) || 0, end: (s.offsets && s.offsets.to) || 0, text: String(s.text || '').trim() })).filter((s) => s.text && !/^\[.*\]$/.test(s.text));
    const t = {
      id: 't' + Date.now().toString(36), src: j.src, name: j.name.replace(/\.[^.]+$/, ''), created: Date.now(),
      duration: j.duration || (segments.length ? segments[segments.length - 1].end / 1000 : 0),
      language: (raw.result && raw.result.language) || db.settings.lang, model: m.label, engine: j.engine || eng.active, elapsed: (Date.now() - started) / 1000,
      words: segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0), segments, outputs: []
    };
    fs.mkdirSync(transcriptsDir(), { recursive: true });
    fs.writeFileSync(path.join(transcriptsDir(), t.id + '.json'), JSON.stringify(t));
    t.outputs = await autoExport(t, j.src);
    fs.writeFileSync(path.join(transcriptsDir(), t.id + '.json'), JSON.stringify(t));
    const { segments: _s, ...meta } = t;
    db.transcripts.unshift(meta);
    updJob(j, { status: 'done', progress: 100, transcriptId: t.id, elapsed: t.elapsed, outputs: t.outputs });
    if (db.settings.notify) notify('Transcrição pronta', `${t.name} — ${t.words} palavras em ${fmtDur(t.elapsed)}`);
  } catch (e) {
    if (j.status !== 'canceled') updJob(j, { status: 'error', error: e.message || String(e) });
  } finally {
    for (const f of [wav, base + '.json']) { try { fs.rmSync(f, { force: true }); } catch (x) {} }
    busy = false; save(); pushState();
    setTimeout(processNext, 300);
  }
}
function fmtDur(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return h ? `${h}h ${m}min` : m ? `${m} min ${x} s` : `${x} s`; }

function outDirFor(src) {
  if (db.settings.outMode === 'folder' && db.settings.outFolder) return db.settings.outFolder;
  return path.dirname(src);
}
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), b = p.slice(0, -ext.length);
  for (let i = 2; i < 999; i++) { const c = `${b} (${i})${ext}`; if (!fs.existsSync(c)) return c; }
  return p;
}
async function autoExport(t, src) {
  const dir = outDirFor(src);
  const outs = [];
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  for (const fmt of db.settings.outs || []) {
    try {
      const p = uniquePath(path.join(dir, t.name + '.' + fmt));
      fs.writeFileSync(p, await exporters.render(fmt, t, { timestamps: db.settings.timestamps }));
      outs.push(p);
    } catch (e) {
      // pasta sem permissão (ex.: pendrive somente leitura): salva na pasta padrão
      try {
        const alt = db.settings.outFolder; fs.mkdirSync(alt, { recursive: true });
        const p = uniquePath(path.join(alt, t.name + '.' + fmt));
        fs.writeFileSync(p, await exporters.render(fmt, t, { timestamps: db.settings.timestamps })); outs.push(p);
      } catch (x) {}
    }
  }
  return outs;
}
function notify(title, body) {
  try { if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'assets', 'icon.png') }).show(); } catch (e) {}
}

// ---------- Integração com o Voxa (gravador) ----------
function voxaRecordings() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'Voxa', 'voxa-data.json'), 'utf8'));
    const done = new Set(db.transcripts.map((t) => t.src).concat(db.jobs.map((j) => j.src)));
    return (d.recordings || []).filter((r) => { try { return fs.existsSync(r.path); } catch (e) { return false; } })
      .map((r) => ({ path: r.path, name: r.name, start: r.start, duration: r.duration, origin: r.origin, already: done.has(r.path) }));
  } catch (e) { return null; }
}
let watchT = null;
function startWatch() {
  clearInterval(watchT);
  watchT = setInterval(() => {
    if (!db.settings.watchVoxa) return;
    const list = voxaRecordings(); if (!list) return;
    const fresh = list.filter((r) => !r.already && r.start > (db.settings.voxaSeen || 0));
    if (fresh.length) {
      db.settings.voxaSeen = Math.max(...list.map((r) => r.start));
      addFiles(fresh.map((r) => r.path), 'Voxa');
    }
  }, 20000);
}

// ---------- IPC ----------
ipcMain.handle('state', () => publicState());
ipcMain.handle('settings', (e, p) => {
  if (p.watchVoxa && !db.settings.watchVoxa) { const l = voxaRecordings() || []; p.voxaSeen = Math.max(0, ...l.map((r) => r.start)); }
  db.settings = { ...db.settings, ...p }; save(); pushState(); if ('model' in p || 'device' in p) kick(); return db.settings;
});
ipcMain.handle('pick-files', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Escolha áudios ou vídeos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Áudio e vídeo', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wma', 'webm', 'mp4', 'mkv', 'mov', 'avi', 'wmv', 'm4v', 'amr', '3gp'] }, { name: 'Todos os arquivos', extensions: ['*'] }] });
  return r.canceled ? 0 : addFiles(r.filePaths);
});
ipcMain.handle('add-files', (e, files) => addFiles(files));
ipcMain.handle('pick-folder', async (e, cur) => { const r = await dialog.showOpenDialog(win, { defaultPath: cur, properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
ipcMain.handle('job-cancel', (e, id) => {
  const j = db.jobs.find((x) => x.id === id); if (!j) return;
  if (['converting', 'transcribing'].includes(j.status)) { j.status = 'canceled'; try { currentProc && currentProc.kill(); } catch (x) {} }
  else if (['queued', 'waiting-model'].includes(j.status)) j.status = 'canceled';
  save(); pushState();
});
ipcMain.handle('job-retry', (e, id) => { const j = db.jobs.find((x) => x.id === id); if (j) { j.status = 'queued'; j.progress = 0; j.error = null; save(); pushState(); kick(); } });
ipcMain.handle('job-remove', (e, id) => { db.jobs = db.jobs.filter((x) => x.id !== id || ['converting', 'transcribing'].includes(x.status)); save(); pushState(); });
ipcMain.handle('jobs-clear', () => { db.jobs = db.jobs.filter((x) => !['done', 'error', 'canceled'].includes(x.status)); save(); pushState(); });
ipcMain.handle('queue-pause', (e, v) => { db.paused = !!v; save(); pushState(); if (!v) kick(); });
ipcMain.handle('model-download', (e, id) => { downloadModel(id); });
ipcMain.handle('model-cancel', (e, id) => { const a = aborters['model:' + id]; if (a) a.abort(); });
ipcMain.handle('model-delete', (e, id) => { const m = MODELS.find((x) => x.id === id); if (m) try { fs.rmSync(path.join(modelsDir(), m.file), { force: true }); } catch (x) {} pushState(); });
ipcMain.handle('cuda-install', () => { installCuda(); });
ipcMain.handle('cuda-cancel', () => { const a = aborters.cuda; if (a) a.abort(); });
ipcMain.handle('transcript', (e, id) => { try { return JSON.parse(fs.readFileSync(path.join(transcriptsDir(), id + '.json'), 'utf8')); } catch (x) { return null; } });
ipcMain.handle('transcript-save', (e, t) => {
  fs.writeFileSync(path.join(transcriptsDir(), t.id + '.json'), JSON.stringify(t));
  const i = db.transcripts.findIndex((x) => x.id === t.id);
  if (i >= 0) { db.transcripts[i].words = t.segments.reduce((a, s) => a + s.text.split(/\s+/).filter(Boolean).length, 0); db.transcripts[i].name = t.name; }
  save(); return true;
});
ipcMain.handle('transcript-delete', (e, id) => { try { fs.rmSync(path.join(transcriptsDir(), id + '.json'), { force: true }); } catch (x) {} db.transcripts = db.transcripts.filter((x) => x.id !== id); save(); pushState(); });
ipcMain.handle('export', async (e, { id, fmt }) => {
  const t = JSON.parse(fs.readFileSync(path.join(transcriptsDir(), id + '.json'), 'utf8'));
  const r = await dialog.showSaveDialog(win, { title: 'Exportar transcrição', defaultPath: path.join(outDirFor(t.src), t.name + '.' + fmt), filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, await exporters.render(fmt, t, { timestamps: db.settings.timestamps }));
  shell.showItemInFolder(r.filePath);
  return r.filePath;
});
ipcMain.handle('copy-text', async (e, id) => { const t = JSON.parse(fs.readFileSync(path.join(transcriptsDir(), id + '.json'), 'utf8')); require('electron').clipboard.writeText(String(await exporters.render('txt', t, { timestamps: false }))); return true; });
ipcMain.handle('reveal', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-path', (e, p) => { fs.mkdirSync(p, { recursive: true }); return shell.openPath(p); });
ipcMain.handle('voxa-list', () => voxaRecordings());
ipcMain.handle('gpu-refresh', async () => { await detectGpu(); pushState(); return gpuInfo; });
ipcMain.on('win', (e, a) => { if (!win) return; if (a === 'min') win.minimize(); else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (a === 'close') win.close(); });

// ---------- Janela ----------
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Voxa Transcrever.lnk');
    const opts = { target: process.execPath, appUserModelId: 'com.wordesigner.voxa.transcrever', icon: process.execPath, iconIndex: 0, description: 'Voxa Transcrever — transcrição de áudio na placa de vídeo' };
    let ok = false; try { const c = shell.readShortcutLink(lnk); ok = c.target === process.execPath; } catch (e) {}
    if (!ok) shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts);
  } catch (e) {}
}
function createWindow() {
  win = new BrowserWindow({
    width: 1260, height: 880, minWidth: 940, minHeight: 640, frame: false, show: false, backgroundColor: '#050507', title: 'Voxa Transcrever',
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('maximized', true));
  win.on('unmaximize', () => send('maximized', false));
  win.on('close', (e) => {
    if (quitting) return;
    if (busy || db.jobs.some((j) => j.status === 'queued')) {
      const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Fechar mesmo assim', 'Continuar transcrevendo'], defaultId: 1, cancelId: 1, title: 'Voxa Transcrever', message: 'Ainda há transcrições na fila.', detail: 'Se fechar agora, elas continuam na fila e recomeçam quando você abrir o app de novo.' });
      if (r !== 0) { e.preventDefault(); return; }
    }
    quitting = true;
    try { currentProc && currentProc.kill(); } catch (x) {}
    saveNow();
  });
}
app.on('second-instance', (e, argv) => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } const files = argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a)); if (files.length) addFiles(files); });
app.whenReady().then(async () => {
  load();
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'notifications'));
  fs.mkdirSync(W(), { recursive: true });
  ensureStartMenuShortcut();
  createWindow();
  await detectGpu();
  pushState();
  startGpuPolling(); startWatch();
  const files = process.argv.slice(1).filter((a) => !a.startsWith('-') && a !== '.' && !a.endsWith('.js') && fs.existsSync(a));
  if (files.length) addFiles(files);
  kick();
});
app.on('window-all-closed', () => { saveNow(); app.quit(); });
