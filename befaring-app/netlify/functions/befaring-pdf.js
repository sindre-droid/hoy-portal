// ─────────────────────────────────────────────────────────────────────────────
// Netlify Function: befaring-pdf.js
//
// Genererer PDF-rapport fra befaringsdata, laster opp til HubSpot Files,
// og oppretter en note på dealen med PDF-en vedlagt.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');
const https       = require('https');

// ── HELPERS ──────────────────────────────────────────────────────────────────

function fetchBuffer(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'HoY-Befaring-PDF/1.0' } };
      const req = https.request(opts, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          return fetchBuffer(res.headers.location, redirects - 1).then(resolve, reject);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
      req.end();
    } catch (e) { reject(e); }
  });
}

async function hsApi(method, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} -> ${res.status}: ${txt}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

function uploadPdfToHubSpot(buffer, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----FormBoundary' + Date.now().toString(16);
    const parts = [];
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`, 'utf8'));
    parts.push(buffer);
    parts.push(Buffer.from('\r\n', 'utf8'));
    const options = JSON.stringify({ access: 'PUBLIC_NOT_INDEXABLE', overwrite: false, duplicateValidationStrategy: 'NONE' });
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${options}\r\n`, 'utf8'));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="folderPath"\r\n\r\n/befaringsrapporter\r\n`, 'utf8'));
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(parts);
    const req = https.request({
      hostname: 'api.hubapi.com', path: '/files/v3/files', method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { const d = JSON.parse(txt); resolve({ fileUrl: d.url, fileId: d.id }); }
          catch (e) { reject(new Error(`Parse error: ${txt}`)); }
        } else { reject(new Error(`Upload failed ${res.statusCode}: ${txt}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── DESIGN TOKENS ─────────────────────────────────────────────────────────────
const NAVY      = '#0a2140';
const TEAL      = '#0a3a4a';
const MUTED     = '#64748b';
const DANGER    = '#991b1b';
const RULE      = '#e2e8f0';
const SCORE_BG  = { 5: '#dcfce7', 4: '#dbeafe', 3: '#fef3c7', 2: '#ffedd5', 1: '#fee2e2' };
const SCORE_FG  = { 5: '#166534', 4: '#1e40af', 3: '#92400e', 2: '#c2410c', 1: '#991b1b' };
const SCORE_LBL = { 5: 'Utmerket', 4: 'Bra', 3: 'Akseptabel', 2: 'Mangelfull', 1: 'Kritisk' };

// ── LAYOUT HELPERS ────────────────────────────────────────────────────────────

const MARGIN = 50;
const PAGE_H  = 841.89; // A4
const PAGE_W  = 595.28;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM_LIMIT = PAGE_H - MARGIN - 30; // 30px footer zone

function rule(doc, y) {
  const yy = y ?? doc.y;
  doc.moveTo(MARGIN, yy).lineTo(PAGE_W - MARGIN, yy).strokeColor(RULE).lineWidth(0.5).stroke();
}

function sectionHeader(doc, text) {
  if (doc.y > BOTTOM_LIMIT - 60) doc.addPage();
  doc.moveDown(0.6);
  doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL).text(text.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.5 });
  doc.moveDown(0.15);
  rule(doc);
  doc.fillColor('#000').moveDown(0.4);
}

function kvRow(doc, label, value) {
  if (!value && value !== 0) return;
  if (doc.y > BOTTOM_LIMIT - 16) doc.addPage();
  const y = doc.y;
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(MUTED).text(label, MARGIN, y, { width: 160, lineBreak: false });
  doc.font('Helvetica').fillColor('#111').text(String(value), MARGIN + 168, y, { width: CONTENT_W - 168 });
  doc.moveDown(0.1);
}

function scoreBadge(doc, score, flag) {
  if (!score) return;
  const bg   = SCORE_BG[score] || '#f1f5f9';
  const fg   = SCORE_FG[score] || '#334155';
  const lbl  = SCORE_LBL[score] || String(score);
  const text = `${lbl}  ${score}/5${flag ? '  · Trenger oppfølging' : ''}`;
  const badgeW = doc.widthOfString(text, { fontSize: 8.5 }) + 16;
  const bx = MARGIN;
  const by = doc.y;
  const bh = 16;
  doc.roundedRect(bx, by, badgeW, bh, 3).fill(bg);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(fg).text(text, bx + 8, by + 3.5, { lineBreak: false });
  doc.fillColor('#000');
  doc.y = by + bh + 4;
}

// Place images 2-per-row below section text.
// Returns actual Y after all images rendered.
async function placeImages(doc, urls, maxImgH = 180) {
  if (!urls || !urls.length) return;

  const imgW = (CONTENT_W - 8) / 2;

  // Fetch all images first (parallel, fail-soft)
  const buffers = await Promise.all(urls.map(u => fetchBuffer(u).catch(() => null)));
  const valid   = buffers.filter(Boolean);
  if (!valid.length) return;

  for (let i = 0; i < valid.length; i += 2) {
    const rowH = maxImgH + 6;
    if (doc.y + rowH > BOTTOM_LIMIT) doc.addPage();

    const rowY = doc.y;
    const buf1 = valid[i];
    const buf2 = valid[i + 1] || null;

    if (buf2) {
      // Two images side by side
      doc.image(buf1, MARGIN,           rowY, { fit: [imgW, maxImgH] });
      doc.image(buf2, MARGIN + imgW + 8, rowY, { fit: [imgW, maxImgH] });
    } else {
      // Single image: center it (smaller than full width)
      const singleW = Math.min(CONTENT_W * 0.65, 300);
      const offsetX = MARGIN + (CONTENT_W - singleW) / 2;
      doc.image(buf1, offsetX, rowY, { fit: [singleW, maxImgH] });
    }

    // Manually advance Y — PDFKit doesn't reliably track Y after absolute-positioned images
    doc.y = rowY + maxImgH + 6;
  }
  doc.moveDown(0.3);
}

// ── PDF GENERATOR ─────────────────────────────────────────────────────────────

async function generatePDF(data) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title:   `Befaringsrapport – ${data.dealName || ''}`,
      Author:  'House of Yachts',
      Subject: 'Befaringsrapport',
      Creator: 'HoY Internportal',
    },
  });

  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const dateStr = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: 'long', year: 'numeric' });

  // ─── FORSIDE ────────────────────────────────────────────────────────────────
  doc.moveDown(3);
  doc.fontSize(9).font('Helvetica').fillColor(MUTED)
    .text('HOUSE OF YACHTS', { align: 'center', characterSpacing: 3 });
  doc.moveDown(0.6);
  doc.fontSize(28).font('Helvetica-Bold').fillColor(NAVY)
    .text('BEFARINGSRAPPORT', { align: 'center' });
  doc.moveDown(0.4);

  // Dekorativ strek
  const midX = PAGE_W / 2;
  doc.moveTo(midX - 35, doc.y).lineTo(midX + 35, doc.y)
    .strokeColor(NAVY).lineWidth(1.5).stroke();
  doc.moveDown(2.5);

  doc.fontSize(18).font('Helvetica-Bold').fillColor('#000')
    .text(data.dealName || 'Uten navn', { align: 'center' });
  doc.moveDown(0.4);
  doc.fontSize(10).font('Helvetica').fillColor(MUTED)
    .text(`Befaring ${dateStr}${data.brokerName ? '  ·  Megler: ' + data.brokerName : ''}`, { align: 'center' });
  doc.fillColor('#000');

  // ─── BÅTINFORMASJON ─────────────────────────────────────────────────────────
  // (Kun tekniske og faktaopplysninger — ingen interne forretningsdata)
  const b = data.boat || {};
  const hasBoatInfo = Object.values(b).some(v => v != null && v !== '');
  if (hasBoatInfo) {
    doc.addPage();
    sectionHeader(doc, 'Båtinformasjon');

    const makeMod = [b.batmerke, b.bat_modell].filter(Boolean).join(' ');
    kvRow(doc, 'Merke / modell',      makeMod || null);
    kvRow(doc, 'Årsmodell',           b.arsmodell);
    kvRow(doc, 'Lengde',              b.lengde_i_fot ? `${b.lengde_i_fot} fot${b.lengde_i_cm ? ' (' + b.lengde_i_cm + ' cm)' : ''}` : null);
    kvRow(doc, 'Bredde',              b.bredde      ? `${b.bredde} cm` : null);
    kvRow(doc, 'HIN / CIN',           b.hin__cin_nr);
    kvRow(doc, 'Kjenningssignal',     b.kjenningssignal);
    kvRow(doc, 'Seilnummer',          b.seilnummer);
    kvRow(doc, 'CE-kategori',         b.ce_konstruksjonskategori);
    kvRow(doc, 'MVA-status',          b.mva_status);
    kvRow(doc, 'Kahytter',            b.antall_kahytter);
    kvRow(doc, 'Soveplasser',         b.antall_soveplasser);
    kvRow(doc, 'Bad',                 b.antall_bad);
    kvRow(doc, 'Lokasjon',            b.location);

    if (b.motorfabrikant || b.motorstorrelse || b.driftstimer_motor) {
      doc.moveDown(0.5);
      sectionHeader(doc, 'Motor og fremdrift');
      kvRow(doc, 'Motorfabrikant',       b.motorfabrikant);
      kvRow(doc, 'Motorstørrelse (hk)',  b.motorstorrelse);
      kvRow(doc, 'Antall motorer',       b.antall_motorer);
      kvRow(doc, 'Driftstimer motor 1',  b.driftstimer_motor);
      kvRow(doc, 'Driftstimer motor 2',  b.driftstimer_motor_2);
      kvRow(doc, 'Driftstimer motor 3',  b.driftstimer_motor_3);
      kvRow(doc, 'Generator fabrikant',  b.generator_fabrikant);
      kvRow(doc, 'Generator kW',         b.generator_kw);
      kvRow(doc, 'Generator driftstimer',b.generator_driftstimer);
    }

    if (b.historikk_skader) {
      doc.moveDown(0.5);
      sectionHeader(doc, 'Historikk og skader');
      doc.fontSize(9.5).font('Helvetica').fillColor('#111').text(b.historikk_skader, MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(0.5);
    }
  }

  // ─── TILSTANDSVURDERING ──────────────────────────────────────────────────────
  const sections   = Array.isArray(data.sections) ? data.sections : [];
  const withContent = sections.filter(s => s.score || s.comment || (s.photoUrls && s.photoUrls.length));

  if (withContent.length) {
    doc.addPage();
    sectionHeader(doc, 'Tilstandsvurdering');

    for (const sec of withContent) {
      // Beregn om vi trenger ny side: tittel+score+litt kommentar = ~60px minimum
      const minH = 60;
      if (doc.y + minH > BOTTOM_LIMIT) doc.addPage();

      // Tittel
      doc.fontSize(11).font('Helvetica-Bold').fillColor(TEAL)
        .text(sec.title || '—', MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(0.2);

      // Score-badge
      scoreBadge(doc, sec.score, sec.flag);
      doc.moveDown(0.2);

      // Kommentar
      if (sec.comment) {
        doc.fontSize(9.5).font('Helvetica').fillColor('#111')
          .text(sec.comment, MARGIN, doc.y, { width: CONTENT_W });
        doc.moveDown(0.3);
      }

      // Bilder — 2 i bredden, under teksten
      if (sec.photoUrls && sec.photoUrls.length) {
        doc.moveDown(0.2);
        await placeImages(doc, sec.photoUrls, 185);
      }

      // Seksjonsskiller
      doc.moveDown(0.3);
      rule(doc);
      doc.moveDown(0.5);
    }
  }

  // ─── DOKUMENTASJONSBILDER (HIN, CE, motortimer) ──────────────────────────────
  const extras = [
    ['HIN-plate',              data.hinUrl],
    ['CE-plate',               data.ceUrl],
    ['Motortimer motor 1',     data.motortimer_url],
    ['Motortimer motor 2',     data.motortimer2_url],
    ['Motortimer motor 3',     data.motortimer3_url],
    ['Generator – timervisning', data.generator_url],
  ].filter(([, url]) => url);

  if (extras.length) {
    doc.addPage();
    sectionHeader(doc, 'Dokumentasjonsbilder');

    // Legg bildene ut 2 i bredden
    const imgW  = (CONTENT_W - 8) / 2;
    const imgH  = 200;
    const labels = extras.map(([l]) => l);
    const urls   = extras.map(([, u]) => u);

    const buffers = await Promise.all(urls.map(u => fetchBuffer(u).catch(() => null)));

    for (let i = 0; i < buffers.length; i += 2) {
      if (doc.y + imgH + 30 > BOTTOM_LIMIT) doc.addPage();

      const rowY = doc.y;
      const buf1 = buffers[i];
      const buf2 = buffers[i + 1] || null;

      // Etiketter
      doc.fontSize(8.5).font('Helvetica-Bold').fillColor(TEAL)
        .text(labels[i], MARGIN, rowY, { width: imgW, lineBreak: false });
      if (buf2) {
        doc.text(labels[i + 1], MARGIN + imgW + 8, rowY, { width: imgW, lineBreak: false });
      }
      doc.fillColor('#000');
      const afterLabel = doc.y + 3;

      if (buf1) doc.image(buf1, MARGIN,            afterLabel, { fit: [imgW, imgH] });
      if (buf2) doc.image(buf2, MARGIN + imgW + 8, afterLabel, { fit: [imgW, imgH] });

      doc.y = afterLabel + imgH + 16;
    }
  }

  // ─── MOTIVASJON / MEGLERS KOMMENTAR ─────────────────────────────────────────
  if (data.motivation || data.brokerComment) {
    doc.addPage();
    if (data.motivation) {
      sectionHeader(doc, 'Selgers motivasjon');
      doc.fontSize(9.5).font('Helvetica').fillColor('#111').text(data.motivation, MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(1.5);
    }
    if (data.brokerComment) {
      sectionHeader(doc, 'Meglers kommentar');
      doc.fontSize(9.5).font('Helvetica').fillColor('#111').text(data.brokerComment, MARGIN, doc.y, { width: CONTENT_W });
    }
  }

  // ─── FOOTER på alle sider ────────────────────────────────────────────────────
  // Bruker bufferPages + switchToPage; lineBreak:false forhindrer at PDFKit
  // oppretter nye sider ved absolutt Y-posisjonering nær bunnen av siden.
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(7.5).font('Helvetica').fillColor(MUTED)
      .text(
        `House of Yachts  ·  Befaringsrapport  ·  ${dateStr}  ·  Side ${i + 1} av ${pageCount}`,
        MARGIN,
        PAGE_H - 28,
        { width: CONTENT_W, align: 'center', lineBreak: false }
      );
  }

  doc.end();
  return done;
}

// ── HANDLER ──────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: cors, body: 'Method Not Allowed' };

  try {
    const data = JSON.parse(event.body || '{}');
    if (!data.dealId) return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing dealId' }) };

    const t0        = Date.now();
    const pdfBuffer = await generatePDF(data);
    console.log(`[befaring-pdf] ${pdfBuffer.length} bytes in ${Date.now() - t0}ms`);

    const safeName = (data.dealName || data.dealId).replace(/[^a-zA-ZæøåÆØÅ0-9_-]/g, '_').slice(0, 80);
    const filename = `Befaringsrapport-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;

    const { fileUrl, fileId } = await uploadPdfToHubSpot(pdfBuffer, filename);

    let noteId = null;
    try {
      const note = await hsApi('POST', '/engagements/v1/engagements', {
        engagement:   { active: true, type: 'NOTE', timestamp: Date.now() },
        associations: { dealIds: [parseInt(data.dealId, 10)] },
        metadata:     { body: `📄 Befaringsrapport (PDF) — ${new Date().toLocaleDateString('no-NO')}${data.brokerName ? ' — ' + data.brokerName : ''}<br><br><a href="${fileUrl}" target="_blank">Åpne befaringsrapport (PDF)</a>` },
        attachments:  [{ id: fileId }],
      });
      noteId = note?.engagement?.id || null;
    } catch (e) {
      console.warn('[befaring-pdf] Note creation failed:', e.message);
    }

    return {
      statusCode: 200,
      headers:    { ...cors, 'Content-Type': 'application/json' },
      body:       JSON.stringify({ pdfUrl: fileUrl, fileId, noteId, sizeBytes: pdfBuffer.length, filename }),
    };
  } catch (err) {
    console.error('[befaring-pdf] Error:', err);
    return {
      statusCode: 500,
      headers:    { ...cors, 'Content-Type': 'application/json' },
      body:       JSON.stringify({ error: err.message }),
    };
  }
};
