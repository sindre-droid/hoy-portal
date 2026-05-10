// ── servicehistorikk-pdf.js ─────────────────────────────────────────────────
// Genererer "utvidet servicerapport" som PDF.
//
// Rapporten består av:
//   1. Forside (båtnavn, dato, oppdragsnummer)
//   2. Tilstandsoppsummering
//   3. Servicehistorikk
//   4. Nylige oppgraderinger
//   5. Anmerkninger
//   6. Verifiserbare punkter (highlights_long)
//   7. (valgfritt) Fullstendige originalfakturaer som vedlegg
//
// pdfkit brukes for hovedinnholdet (matcher befaring-pdf.js sin stil).
// pdf-lib brukes for å merge originaldokumenter (PDF + bilder) bak rapporten.
// ─────────────────────────────────────────────────────────────────────────────

const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLibDocument } = require('pdf-lib');

// Visuelle konstanter — speiler befaring-pdf.js for konsistent HoY-look
const NAVY  = '#0a2140';
const TEAL  = '#0f5b4f';
const GOLD  = '#c9a84c';
const TEXT  = '#12233a';
const MUTED = '#6b7a8d';

const PAGE_W   = 595.28;   // A4 i punkter
const PAGE_H   = 841.89;
const MARGIN   = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ── Hjelpere ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('nb-NO', {
    day: '2-digit', month: 'long', year: 'numeric',
  });
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > PAGE_H - MARGIN) doc.addPage();
}

function drawSectionTitle(doc, text) {
  ensureSpace(doc, 60);
  doc.moveDown(0.6);
  doc.fontSize(13).font('Helvetica-Bold').fillColor(NAVY)
    .text(text.toUpperCase(), MARGIN, doc.y, { characterSpacing: 0.6 });
  // Linje under tittel
  doc.moveTo(MARGIN, doc.y + 2).lineTo(MARGIN + 40, doc.y + 2)
    .strokeColor(GOLD).lineWidth(1.2).stroke();
  doc.moveDown(0.6);
}

function drawBody(doc, text, opts = {}) {
  if (!text) return;
  doc.fontSize(opts.size || 10).font(opts.font || 'Helvetica').fillColor(opts.color || TEXT)
    .text(text, MARGIN, doc.y, { width: CONTENT_W, align: opts.align || 'left' });
}

function drawBulletList(doc, items) {
  if (!items || items.length === 0) {
    doc.fontSize(10).font('Helvetica-Oblique').fillColor(MUTED)
      .text('(Ingen innhold)', MARGIN, doc.y, { width: CONTENT_W });
    return;
  }
  for (const item of items) {
    ensureSpace(doc, 18);
    const startY = doc.y;
    // Bullet-punkt
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GOLD)
      .text('•', MARGIN, startY, { width: 12, lineBreak: false });
    // Tekst
    doc.fontSize(10).font('Helvetica').fillColor(TEXT)
      .text(item, MARGIN + 14, startY, { width: CONTENT_W - 14 });
    doc.moveDown(0.15);
  }
}

function drawEmptyPlaceholder(doc) {
  doc.fontSize(10).font('Helvetica-Oblique').fillColor(MUTED)
    .text('(Ingen informasjon dokumentert)', MARGIN, doc.y, { width: CONTENT_W });
}

// ── Hovedrapport (cover + tekstseksjoner) ───────────────────────────────────

async function buildMainReport({ run, boatName, oppdragsnummer, sourceFiles }) {
  return new Promise((resolve, reject) => {
    const data = run.edits || run.ai_output_parsed || {};

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title:   `Servicedokumentasjon – ${boatName || ''}`,
        Author:  'House of Yachts',
        Subject: 'Servicehistorikk',
        Creator: 'HoY Internportal',
      },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const today = formatDate(new Date().toISOString());

    // ─── FORSIDE ─────────────────────────────────────────────────────────────
    doc.moveDown(4);
    doc.fontSize(9).font('Helvetica').fillColor(MUTED)
      .text('HOUSE OF YACHTS', { align: 'center', characterSpacing: 3 });
    doc.moveDown(0.6);
    doc.fontSize(26).font('Helvetica-Bold').fillColor(NAVY)
      .text('SERVICEDOKUMENTASJON', { align: 'center' });
    doc.moveDown(0.4);

    // Dekorativ linje
    const midX = PAGE_W / 2;
    doc.moveTo(midX - 35, doc.y).lineTo(midX + 35, doc.y)
      .strokeColor(GOLD).lineWidth(1.5).stroke();
    doc.moveDown(2);

    // Båtnavn
    doc.fontSize(20).font('Helvetica-Bold').fillColor(TEXT)
      .text(boatName || 'Uten navn', { align: 'center' });
    doc.moveDown(0.4);

    // Meta-info
    const metaParts = [`Generert ${today}`];
    if (oppdragsnummer) metaParts.push(`Oppdrag ${oppdragsnummer}`);
    if (sourceFiles && sourceFiles.length) {
      metaParts.push(`${sourceFiles.length} dokument${sourceFiles.length === 1 ? '' : 'er'}`);
    }
    doc.fontSize(10).font('Helvetica').fillColor(MUTED)
      .text(metaParts.join('  ·  '), { align: 'center' });

    // Disclaimer i bunn
    doc.moveDown(8);
    doc.fontSize(8).font('Helvetica-Oblique').fillColor(MUTED)
      .text(
        'Denne rapporten er sammenstilt fra opplastet servicedokumentasjon. ' +
        'Innholdet er strukturert med AI-assistanse, men gjengir kun det som er ' +
        'eksplisitt dokumentert i de vedlagte fakturaene/rapportene. Originaldokumentene ' +
        'finnes som vedlegg bak.',
        MARGIN, doc.y,
        { width: CONTENT_W, align: 'center' }
      );

    // ─── INNHOLDSDEL ─────────────────────────────────────────────────────────
    doc.addPage();

    // 1. Tilstandsoppsummering
    drawSectionTitle(doc, 'Tilstandsoppsummering');
    if (data.condition_summary) drawBody(doc, data.condition_summary);
    else drawEmptyPlaceholder(doc);

    // 2. Servicehistorikk (én hendelse per linje)
    drawSectionTitle(doc, 'Servicehistorikk');
    if (data.service_history) {
      const lines = data.service_history.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        ensureSpace(doc, 18);
        doc.fontSize(10).font('Helvetica').fillColor(TEXT)
          .text(line, MARGIN, doc.y, { width: CONTENT_W });
        doc.moveDown(0.25);
      }
    } else {
      drawEmptyPlaceholder(doc);
    }

    // 3. Nylige oppgraderinger
    drawSectionTitle(doc, 'Nylige oppgraderinger');
    if (data.recent_upgrades) {
      const lines = data.recent_upgrades.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        ensureSpace(doc, 18);
        doc.fontSize(10).font('Helvetica').fillColor(TEXT)
          .text(line, MARGIN, doc.y, { width: CONTENT_W });
        doc.moveDown(0.25);
      }
    } else {
      drawEmptyPlaceholder(doc);
    }

    // 4. Anmerkninger
    drawSectionTitle(doc, 'Anmerkninger');
    if (data.known_notes) drawBody(doc, data.known_notes);
    else drawEmptyPlaceholder(doc);

    // 5. Highlights (verifiserbare punkter)
    drawSectionTitle(doc, 'Verifiserbare punkter');
    drawBulletList(doc, data.highlights_long || []);

    // 6. Bilag-innledning hvis vi skal merge inn vedlegg etterpå
    if (sourceFiles && sourceFiles.length) {
      doc.addPage();
      drawSectionTitle(doc, 'Bilag — originaldokumenter');
      doc.fontSize(10).font('Helvetica').fillColor(TEXT)
        .text(
          `De følgende ${sourceFiles.length} dokument${sourceFiles.length === 1 ? 'et er' : 'ene er'} ` +
          'lagt ved i sin helhet. Hvert bilag svarer til en faktura, kvittering ' +
          'eller rapport som er brukt som kilde for sammenstillingen over.',
          MARGIN, doc.y,
          { width: CONTENT_W }
        );
      doc.moveDown(0.8);
      // Liste over bilag
      sourceFiles.forEach((f, i) => {
        ensureSpace(doc, 16);
        doc.fontSize(9).font('Helvetica-Bold').fillColor(NAVY)
          .text(`Bilag ${i + 1}:`, MARGIN, doc.y, { continued: true, lineBreak: false })
          .font('Helvetica').fillColor(TEXT)
          .text(`  ${f.name}`);
        doc.moveDown(0.15);
      });
    }

    // Sidetall
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      doc.fontSize(8).font('Helvetica').fillColor(MUTED)
        .text(`Side ${i + 1} av ${range.count}`, MARGIN, PAGE_H - 30, {
          width: CONTENT_W, align: 'center', lineBreak: false,
        });
    }

    doc.end();
  });
}

// ── Merging av vedlegg via pdf-lib ──────────────────────────────────────────

async function mergeAttachments(reportBuffer, attachments) {
  // attachments: [{ buf: Buffer, mime: string, name: string }, ...]
  const merged = await PDFLibDocument.create();

  // Kopier inn rapportsidene først
  const reportDoc = await PDFLibDocument.load(reportBuffer);
  const reportPages = await merged.copyPages(reportDoc, reportDoc.getPageIndices());
  reportPages.forEach(p => merged.addPage(p));

  // Behandle hvert vedlegg
  for (const att of attachments) {
    const mime = (att.mime || '').toLowerCase();
    try {
      if (mime === 'application/pdf') {
        const srcDoc = await PDFLibDocument.load(att.buf, { ignoreEncryption: true });
        const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      } else if (mime === 'image/jpeg' || mime === 'image/jpg') {
        const img = await merged.embedJpg(att.buf);
        const page = merged.addPage([PAGE_W, PAGE_H]);
        const fitted = img.scaleToFit(PAGE_W - 80, PAGE_H - 80);
        page.drawImage(img, {
          x: (PAGE_W - fitted.width) / 2,
          y: (PAGE_H - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        });
      } else if (mime === 'image/png') {
        const img = await merged.embedPng(att.buf);
        const page = merged.addPage([PAGE_W, PAGE_H]);
        const fitted = img.scaleToFit(PAGE_W - 80, PAGE_H - 80);
        page.drawImage(img, {
          x: (PAGE_W - fitted.width) / 2,
          y: (PAGE_H - fitted.height) / 2,
          width: fitted.width,
          height: fitted.height,
        });
      } else {
        // HEIC/WebP etc. — pdf-lib støtter ikke direkte. Sett inn placeholder-side.
        const page = merged.addPage([PAGE_W, PAGE_H]);
        page.drawText(
          `[Bilag «${att.name}» kunne ikke embeddes — format ${mime} er ikke støttet i PDF.]`,
          { x: 60, y: PAGE_H / 2, size: 11, maxWidth: PAGE_W - 120 }
        );
      }
    } catch (e) {
      console.warn(`mergeAttachments: failed to embed ${att.name}: ${e.message}`);
      const page = merged.addPage([PAGE_W, PAGE_H]);
      page.drawText(
        `[Bilag «${att.name}» kunne ikke embeddes: ${e.message}]`,
        { x: 60, y: PAGE_H / 2, size: 11, maxWidth: PAGE_W - 120 }
      );
    }
  }

  const bytes = await merged.save();
  return Buffer.from(bytes);
}

// ── Public entry-point ──────────────────────────────────────────────────────

async function generateRapportPdf({ run, boatName, oppdragsnummer, sourceFiles, attachments, includeAttachments }) {
  // sourceFiles brukes til å lage bilag-listen i rapporten (filnavn).
  // attachments er selve binærdataen som skal merges (kun hvis includeAttachments=true).
  const mainReportBuf = await buildMainReport({
    run, boatName, oppdragsnummer,
    sourceFiles: includeAttachments ? sourceFiles : null,
  });

  if (!includeAttachments || !attachments || attachments.length === 0) {
    return mainReportBuf;
  }

  return mergeAttachments(mainReportBuf, attachments);
}

module.exports = { generateRapportPdf };
