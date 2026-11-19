'use strict';
const pad = (n, w = 2) => String(n).padStart(w, '0');
function ts(ms, sep = ',') {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, x = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(x, 3)}`;
}
function short(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
}
const LANGS = { pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', it: 'Italiano', de: 'Alemão', ja: 'Japonês', zh: 'Chinês', ko: 'Coreano', ru: 'Russo', nl: 'Holandês' };

function paragraphs(segs) {
  // agrupa trechos em parágrafos quando há pausa longa ou o parágrafo fica grande
  const out = []; let cur = null;
  for (const s of segs) {
    if (!cur || s.start - cur.end > 2500 || cur.text.length > 700) { cur = { start: s.start, end: s.end, text: s.text }; out.push(cur); }
    else { cur.text += ' ' + s.text; cur.end = s.end; }
  }
  return out;
}

async function render(fmt, t, opts = {}) {
  const segs = t.segments || [];
  if (fmt === 'txt') {
    if (opts.timestamps) return segs.map((s) => `[${short(s.start)}] ${s.text}`).join('\r\n') + '\r\n';
    return paragraphs(segs).map((p) => p.text).join('\r\n\r\n') + '\r\n';
  }
  if (fmt === 'srt') return segs.map((s, i) => `${i + 1}\r\n${ts(s.start)} --> ${ts(s.end)}\r\n${s.text}\r\n`).join('\r\n');
  if (fmt === 'vtt') return 'WEBVTT\r\n\r\n' + segs.map((s) => `${ts(s.start, '.')} --> ${ts(s.end, '.')}\r\n${s.text}\r\n`).join('\r\n');
  if (fmt === 'json') return JSON.stringify({ arquivo: t.src, idioma: t.language, modelo: t.model, duracao_s: t.duration, criado: new Date(t.created).toISOString(), trechos: segs.map((s) => ({ inicio_ms: s.start, fim_ms: s.end, texto: s.text })) }, null, 2);
  if (fmt === 'docx') {
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
    const d = new Date(t.created);
    const meta = `${LANGS[t.language] || t.language || ''} · ${short((t.duration || 0) * 1000)} de áudio · transcrito em ${d.toLocaleDateString('pt-BR')} com ${t.model}`;
    const body = opts.timestamps
      ? paragraphs(segs).map((p) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: `[${short(p.start)}]  `, bold: true, color: '777777', size: 20 }), new TextRun({ text: p.text, size: 24 })] }))
      : paragraphs(segs).map((p) => new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: p.text, size: 24 })] }));
    const doc = new Document({
      creator: 'Voxa Transcrever', title: t.name,
      styles: { default: { document: { run: { font: 'Calibri' } } } },
      sections: [{ children: [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: t.name })] }), new Paragraph({ spacing: { after: 320 }, children: [new TextRun({ text: meta, color: '666666', size: 20 })] }), ...body] }]
    });
    return Buffer.from(await Packer.toBuffer(doc));
  }
  throw new Error('Formato desconhecido: ' + fmt);
}
module.exports = { render, ts, short };
