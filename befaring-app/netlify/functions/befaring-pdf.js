// ─────────────────────────────────────────────────────────────────────────────
// Netlify Function: befaring-pdf.js
//
// Genererer PDF-rapport fra befaringsdata, laster opp til HubSpot Files,
// og oppretter en note på dealen med PDF-en vedlagt.
//
// Trigges fra completion-screen i befaringsskjemaet (eget "Generer PDF"-knapp).
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
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(new Error('Image fetch timeout')); });
      req.end();
    } catch (e) { reject(e); }
  });
}

async function hsApi(method, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
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
      hostname: 'api.hubapi.com',
      path: '/files/v3/files',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const txt = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(txt);
            resolve({ fileUrl: data.url, fileId: data.id });
          } catch (e) { reject(new Error(`Parse error: ${txt}`)); }
        } else {
          reject(new Error(`Upload failed ${res.statusCode}: ${txt}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── PDF LAYOUT ───────────────────────────────────────────────────────────────

const BRAND      = '#0a3a4a';
const BRAND_SOFT = '#64748b';
const DANGER     = '#991b1b';
const LIGHT_LINE = '#e5e7eb';

function sectionHeader(doc, text) {
  doc.moveDown(0.5);
  doc.fontSize(13).font('Helvetica-Bold').fillColor(BRAND).text(text);
  const y = doc.y + 2;
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.width - doc.page.margins.right, y).strokeColor(LIGHT_LINE).lineWidth(1).stroke();
  doc.fillColor('#000');
  doc.moveDown(0.5);
}

function kvTable(doc, rows) {
  doc.fontSize(9).font('Helvetica');
  const labelW = 170;
  const valueX = doc.page.margins.left + labelW + 10;
  const valueW = doc.page.width - doc.page.margins.right - valueX;
  rows.forEach(([k, v]) => {
    if (doc.y > doc.page.height - 100) doc.addPage();
    const y = doc.y;
    doc.font('Helvetica-Bold').fillColor(BRAND_SOFT).text(k, doc.page.margins.left, y, { width: labelW, lineBreak: false });
    doc.font('Helvetica').fillColor('#000').text(String(v), valueX, y, { width: valueW });
    doc.moveDown(0.15);
  });
}

function ensureSpaceForImage(doc, minHeight = 250) {
  if (doc.y + minHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

async function embedImage(doc, url) {
  try {
    const buf = await fetchBuffer(url);
    ensureSpaceForImage(doc, 280);
    const maxW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const maxH = 340;
    doc.image(buf, { fit: [maxW, maxH], align: 'center' });
    doc.moveDown(1);
  } catch (e) {
    console.warn('[befaring-pdf] Image embed failed:', url, e.message);
    doc.fontSize(8).fillColor(DANGER).text(`Kunne ikke laste bilde: ${url}`);
    doc.fillColor('#000');
    doc.moveDown(0.5);
  }
}

async function generatePDF(data) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true, // kreves for at footer-loopen (switchToPage) skal fungere
    info: {
      Title: `Befaringsrapport – ${data.dealName || ''}`,
      Author: 'House of Yachts',
      Subject: 'Befaringsrapport',
      Creator: 'HoY Internportal',
    },
  });

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  // ─── COVER ───
  doc.fontSize(10).font('Helvetica').fillColor(BRAND_SOFT).text('HOUSE OF YACHTS', { align: 'center', characterSpacing: 2 });
  doc.moveDown(0.5);
  doc.fontSize(26).font('Helvetica-Bold').fillColor(BRAND).text('BEFARINGSRAPPORT', { align: 'center' });
  doc.moveDown(0.3);
  doc.strokeColor(BRAND).lineWidth(1.5)
    .moveTo(doc.page.width / 2 - 40, doc.y).lineTo(doc.page.width / 2 + 40, doc.y).stroke();
  doc.moveDown(1.5);

  const dateStr = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: 'long', year: 'numeric' });
  doc.fillColor('#000').fontSize(16).font('Helvetica-Bold').text(data.dealName || 'Uten navn', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').fillColor(BRAND_SOFT).text(`Befaring ${dateStr}${data.brokerName ? ' · Megler: ' + data.brokerName : ''}`, { align: 'center' });
  doc.fillColor('#000').moveDown(2);

  // ─── BÅTINFORMASJON ───
  if (data.boat && Object.keys(data.boat).length) {
    sectionHeader(doc, 'BÅTINFORMASJON');
    const mergedMakeModel = [data.boat.batmerke, data.boat.bat_modell].filter(Boolean).join(' ');
    const rows = [
      ['Merke / modell', mergedMakeModel || null],
      ['Årsmodell', data.boat.arsmodell],
      ['Lengde', data.boat.lengde_i_fot ? `${data.boat.lengde_i_fot} fot${data.boat.lengde_i_cm ? ' (' + data.boat.lengde_i_cm + ' cm)' : ''}` : null],
      ['Bredde', data.boat.bredde ? `${data.boat.bredde} cm` : null],
      ['HIN / CIN', data.boat.hin__cin_nr],
      ['Kjenningssignal', data.boat.kjenningssignal],
      ['Seilnummer', data.boat.seilnummer],
      ['CE-kategori', data.boat.ce_konstruksjonskategori],
      ['MVA-status', data.boat.mva_status],
      ['Kahytter', data.boat.antall_kahytter],
      ['Soveplasser', data.boat.antall_soveplasser],
      ['Bad', data.boat.antall_bad],
      ['Lokasjon', data.boat.location],
      ['Motorfabrikant', data.boat.motorfabrikant],
      ['Motorstørrelse', data.boat.motorstorrelse],
      ['Type motor', data.boat.type_motor],
      ['Antall motorer', data.boat.antall_motorer],
      ['Driftstimer motor 1', data.boat.driftstimer_motor],
      ['Driftstimer motor 2', data.boat.driftstimer_motor_2],
      ['Driftstimer motor 3', data.boat.driftstimer_motor_3],
      ['Generator fabrikant', data.boat.generator_fabrikant],
      ['Generator kW', data.boat.generator_kw],
      ['Generator driftstimer', data.boat.generator_driftstimer],
      ['Historikk / skader', data.boat.historikk_skader],
    ].filter((r) => r[1] != null && r[1] !== '');
    if (rows.length) kvTable(doc, rows);
    else doc.fontSize(9).fillColor(BRAND_SOFT).text('Ingen båtinformasjon registrert.');
  }

  // ─── PRIS OG VILKÅR ───
  if (data.deal && Object.keys(data.deal).length) {
    sectionHeader(doc, 'PRIS OG VILKÅR');
    const rows = [
      ['Selgers forventede pris', data.deal.seller_expected_price__nok_ ? `${Number(data.deal.seller_expected_price__nok_).toLocaleString('no-NO')} NOK` : null],
      ['Foreslått provisjon', data.deal.proposed_commission__ ? `${(Number(data.deal.proposed_commission__) * 100).toFixed(2)} %` : null],
      ['Prisbånd', data.deal.price_band],
      ['Autoritet bekreftet', data.deal.authority_confirmed_],
      ['Tidsplan til listing', data.deal.timeline_to_list],
      ['Neste steg', data.deal.hs_next_step],
      ['Neste møte', data.deal.next_meeting_date_time ? new Date(data.deal.next_meeting_date_time).toLocaleString('no-NO') : null],
    ].filter((r) => r[1] != null && r[1] !== '');
    if (rows.length) kvTable(doc, rows);
  }

  // ─── TILSTANDSVURDERING ───
  const sections = Array.isArray(data.sections) ? data.sections : [];
  const ratedSections = sections.filter((s) => s.score || s.comment || (s.photoUrls && s.photoUrls.length));
  if (ratedSections.length) {
    doc.addPage();
    sectionHeader(doc, 'TILSTANDSVURDERING');

    for (const sec of ratedSections) {
      if (doc.y > doc.page.height - 150) doc.addPage();
      doc.moveDown(0.3);
      doc.fontSize(12).font('Helvetica-Bold').fillColor(BRAND).text(sec.title || '—');
      doc.fillColor('#000');

      const flag = sec.flag ? '  🔧 Trenger oppfølging' : '';
      const scoreTxt = sec.score ? `Tilstand: ${sec.scoreLabel || sec.score} (${sec.score}/5)${flag}` : 'Tilstand: Ikke vurdert';
      doc.fontSize(10).font('Helvetica-Bold').fillColor(sec.flag ? DANGER : '#000').text(scoreTxt);
      doc.fillColor('#000');

      if (sec.comment) {
        doc.moveDown(0.2);
        doc.fontSize(10).font('Helvetica').text(sec.comment, { align: 'left' });
      }
      doc.moveDown(0.4);

      if (Array.isArray(sec.photoUrls)) {
        for (const url of sec.photoUrls) {
          await embedImage(doc, url);
        }
      }

      // Seksjonsskiller
      if (doc.y < doc.page.height - doc.page.margins.bottom - 10) {
        doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y)
          .strokeColor(LIGHT_LINE).lineWidth(0.5).stroke();
        doc.moveDown(0.5);
      }
    }
  }

  // ─── DOKUMENTASJONSBILDER ───
  const extras = [
    ['HIN-plate', data.hinUrl],
    ['CE-plate', data.ceUrl],
    ['Motortimer motor 1', data.motortimer_url],
    ['Motortimer motor 2', data.motortimer2_url],
    ['Motortimer motor 3', data.motortimer3_url],
    ['Generator – timervisning', data.generator_url],
  ].filter((e) => e[1]);

  if (extras.length) {
    doc.addPage();
    sectionHeader(doc, 'DOKUMENTASJONSBILDER');
    for (const [label, url] of extras) {
      if (doc.y > doc.page.height - 280) doc.addPage();
      doc.fontSize(11).font('Helvetica-Bold').fillColor(BRAND).text(label);
      doc.fillColor('#000').moveDown(0.2);
      await embedImage(doc, url);
    }
  }

  // ─── MOTIVASJON / MEGLERS KOMMENTAR ───
  if (data.motivation || data.brokerComment) {
    doc.addPage();
    if (data.motivation) {
      sectionHeader(doc, 'SELGERS MOTIVASJON');
      doc.fontSize(10).font('Helvetica').text(data.motivation, { align: 'left' });
      doc.moveDown(1.5);
    }
    if (data.brokerComment) {
      sectionHeader(doc, 'MEGLERS KOMMENTAR');
      doc.fontSize(10).font('Helvetica').text(data.brokerComment, { align: 'left' });
    }
  }

  // ─── FOOTER på alle sider ───
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).font('Helvetica').fillColor(BRAND_SOFT)
      .text(
        `House of Yachts · Befaringsrapport · ${dateStr} · Side ${i + 1} av ${pageCount}`,
        doc.page.margins.left,
        doc.page.height - 30,
        { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right }
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
    if (!data.dealId) {
      return { statusCode: 400, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing dealId' }) };
    }

    const t0 = Date.now();
    const pdfBuffer = await generatePDF(data);
    console.log(`[befaring-pdf] PDF generated ${pdfBuffer.length} bytes in ${Date.now() - t0}ms`);

    const safeName = (data.dealName || data.dealId).replace(/[^a-zA-ZæøåÆØÅ0-9_-]/g, '_').slice(0, 80);
    const filename = `Befaringsrapport-${safeName}-${new Date().toISOString().slice(0, 10)}.pdf`;

    const { fileUrl, fileId } = await uploadPdfToHubSpot(pdfBuffer, filename);
    console.log(`[befaring-pdf] Uploaded to HubSpot: ${fileUrl}`);

    // Opprett note på dealen med PDF-en vedlagt
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
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfUrl: fileUrl, fileId, noteId, sizeBytes: pdfBuffer.length, filename }),
    };
  } catch (err) {
    console.error('[befaring-pdf] Error:', err);
    return {
      statusCode: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
