// ── wix-migrate.js ──────────────────────────────────────────────────────────
// One-time Wix → HubSpot migration helper.
//
// Usage:
//   POST ?action=pilot           → runs hardcoded 5-boat pilot
//   POST ?action=run             → runs boats passed in body: { boats: [...] }
//
// Each boat spec:
//   { slug, action: 'create'|'update', hs_id?, props: {...}, image_url? }
//
// CREATE: POSTs new boat record with all props, uploads image → sets gallery_images, activated=no (safety)
// UPDATE: PATCHes ONLY status + sold_date_proxy (conservative — doesn't overwrite existing fields)
// ──────────────────────────────────────────────────────────────────────────────

const https = require('https');

const BOAT_OBJ_TYPE = '2-145214665';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const JSON_H = { 'Content-Type': 'application/json' };

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convert Wix HTML body → clean plain text suitable for HubSpot `description`
function cleanWixHtml(html) {
  if (!html) return '';
  let s = String(html);
  // Decode common HTML entities
  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&ldquo;': '“', '&rdquo;': '”',
    '&aring;': 'å', '&Aring;': 'Å', '&oslash;': 'ø', '&Oslash;': 'Ø',
    '&aelig;': 'æ', '&AElig;': 'Æ', '&eacute;': 'é', '&egrave;': 'è',
    '&ouml;': 'ö', '&auml;': 'ä', '&uuml;': 'ü', '&hellip;': '…',
    '&mdash;': '—', '&ndash;': '–',
  };
  for (const [k, v] of Object.entries(entities)) s = s.replace(new RegExp(k, 'g'), v);
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  // Replace block elements with newlines so paragraph structure survives
  s = s.replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // Drop wix layout artifacts
  s = s.replace(/\u200B/g, ''); // zero-width space (wixGuard)
  // Cut boilerplate "Om oss" section onwards (consistent across Wix listings)
  const omOssIdx = s.search(/\bOm oss\s*:/i);
  if (omOssIdx > 0) s = s.slice(0, omOssIdx);
  // Cut "Ta kontakt for avtale" + contact info if it appears as trailing block
  const contactIdx = s.search(/Ta kontakt (for|med)/i);
  if (contactIdx > 200) s = s.slice(0, contactIdx);
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n[ \t]+/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}


async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadImage(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Image download failed: ${res.statusCode} ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || 'image/jpeg',
      }));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function uploadImage(buffer, filename, contentType) {
  const boundary = '----FormBoundary' + Date.now().toString(16);
  const parts = [];
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
  parts.push(buffer);
  parts.push('\r\n');
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify({ access: 'PUBLIC_INDEXABLE', overwrite: false, duplicateValidationStrategy: 'NONE' })}\r\n`);
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="folderPath"\r\n\r\n/boats-migrated\r\n`);
  parts.push(`--${boundary}--\r\n`);
  const bodyBuf = Buffer.concat(parts.map(p => typeof p === 'string' ? Buffer.from(p, 'utf8') : p));

  const result = await new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.hubapi.com',
      path: '/files/v3/files',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuf.length,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: { error: raw } }); }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`File upload failed: ${result.status} ${JSON.stringify(result.body)}`);
  }
  return { id: result.body.id, url: result.body.url };
}

// ── Per-boat migration ────────────────────────────────────────────────────────

async function migrateBoat(spec) {
  const started = Date.now();
  const log = [];
  try {
    let imageId = null;

    if (spec.action === 'create' && spec.image_url) {
      try {
        const { buffer, contentType } = await downloadImage(spec.image_url);
        const ext = contentType.includes('png') ? 'png' : 'jpg';
        const filename = `${spec.slug}.${ext}`;
        const up = await uploadImage(buffer, filename, contentType);
        imageId = up.id;
        log.push(`✓ uploaded image as file ${up.id}`);
      } catch (e) {
        log.push(`⚠ image upload failed: ${e.message} (continuing without image)`);
      }
    }

    if (spec.action === 'create') {
      const props = { ...spec.props };

      // Sanitize + normalize against HubSpot's actual boats schema
      // Slug requires alphanumeric only (no hyphens, etc.)
      if (!props.slug && props.page_path2) props.slug = props.page_path2;
      if (props.slug) props.slug = String(props.slug).replace(/[^a-zA-Z0-9]/g, '');

      // lengde_i_fot must be integer: "47 fot" → 47
      if (props.lengde_i_fot) {
        const m = String(props.lengde_i_fot).match(/(\d+)/);
        props.lengde_i_fot = m ? m[1] : undefined;
      }

      // pris must be integer. Prefer numeric `price_two` value, fallback drop non-numeric pris.
      const priceTwo = props.price_two;
      if (props.pris && !/^\d+$/.test(String(props.pris))) {
        delete props.pris;
      }
      if (!props.pris && priceTwo && /^\d+$/.test(String(priceTwo))) {
        props.pris = String(priceTwo);
      }

      // customer_comment is for BUYER feedback, not boat narrative. The Wix body text goes in `description`.
      // Also: clean HTML tags + trim boilerplate (Om oss/kontakt sections)
      if (props.customer_comment && !props.description) {
        props.description = cleanWixHtml(props.customer_comment);
      } else if (props.description) {
        props.description = cleanWixHtml(props.description);
      }
      delete props.customer_comment;

      // Remove properties that don't map cleanly:
      // - merke/modell/price_two/market_type: don't exist in HubSpot schema
      // - motortype: Wix "Innenbords"/"Utenbords" doesn't match HubSpot type_motor enum (1/2/3/Strak aksling/IPS/Zeus pod)
      // - type_motor: skip — team must set manually
      for (const k of ['merke', 'modell', 'price_two', 'motortype', 'type_motor', 'market_type']) {
        delete props[k];
      }

      if (imageId) props.gallery_images = String(imageId);
      const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}`, 'POST', { properties: props });
      if (!res.ok) throw new Error(`Create failed: ${res.status} ${JSON.stringify(res.data)}`);
      const id = res.data.id;
      return {
        ok: true,
        slug: spec.slug,
        action: 'create',
        hs_id: id,
        hs_url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${id}`,
        duration_ms: Date.now() - started,
        log,
      };
    }

    if (spec.action === 'update') {
      // CONSERVATIVE: only set status + sold_date_proxy (don't overwrite existing data)
      const minimalProps = {};
      if (spec.props.status) minimalProps.status = spec.props.status;
      if (spec.props.sold_date_proxy) minimalProps.sold_date_proxy = spec.props.sold_date_proxy;

      if (Object.keys(minimalProps).length === 0) {
        return { ok: true, slug: spec.slug, action: 'update-noop', hs_id: spec.hs_id, note: 'nothing to update', log };
      }

      const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${spec.hs_id}`, 'PATCH', { properties: minimalProps });
      if (!res.ok) throw new Error(`Update failed: ${res.status} ${JSON.stringify(res.data)}`);
      return {
        ok: true,
        slug: spec.slug,
        action: 'update',
        hs_id: spec.hs_id,
        hs_url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${spec.hs_id}`,
        updated_fields: minimalProps,
        duration_ms: Date.now() - started,
        log,
      };
    }

    throw new Error(`Unknown action: ${spec.action}`);
  } catch (err) {
    return {
      ok: false,
      slug: spec.slug,
      action: spec.action,
      hs_id: spec.hs_id || null,
      error: err.message,
      duration_ms: Date.now() - started,
      log,
    };
  }
}

// ── Pilot data (hardcoded) ────────────────────────────────────────────────────

const PILOT_BOATS = [
  {
    "slug": "azimut-47-fly",
    "action": "create",
    "hs_id": null,
    "props": {
      "boat_name": "Azimut 47 Fly",
      "page_path2": "azimut-47-fly",
      "merke": "Azimut",
      "modell": "47 Fly",
      "arsmodell": "2010",
      "lengde_i_fot": "47 fot",
      "pris": "Solgt!",
      "price_two": "4900000",
      "motorfabrikant": "2 x CAT C9 575",
      "motortype": "Innenbords",
      "motorstorrelse": "1150 HK",
      "customer_comment": "<p class=\"font_8\"><em><strong>Rålekker Azimut 47 fly selges! Meget pen 2010 modell, med riktig utstyr. Båten er nylig sjøsatt og klar for ny sesong. Alltid lagret innendørs, og med kun ca. 620 timer på motorene er dette en meget velholdt båt.</strong></em></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><em><strong>Om båten:</strong></em></p>\n<p class=\"font_8\">Azimut 47 Fly er en fantastisk familiebåt. Med 3 store, doble kabiner har du mer enn nok plass. Båten er bredere enn sine konkurrenter, og byr dermed på ekstra romslig plass ombord. Flybridgen er utrolig godt disponert, og har flere sosiale sittegrupper.</p>\n<p class=\"font_8\">Meget sterk sjøbåt, som i tillegg til stabilitet byr på godt fartspotensiale. Med Joystick styring, baug og hekkthruster samt to motorer får du også en båt som er enkel å manøvrere, selv i dårlig vær.</p>\n<p class=\"font_8\">Azimut byr også på lekkert Italiensk design og smakfullt interiør.</p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Ta kontakt for avtale om visning:</strong></p>\n<p class=\"font_8\"><strong>Sindre Jacobsen</strong></p>\n<p class=\"font_8\"><strong>+ 47 938 40189</strong></p>\n<p class=\"font_8\"><strong>sindre@h-y.no</strong></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Om oss:</strong></p>\n<p class=\"font_8\"><em><strong>House of Yachts er din selvsagte samarbeidspartner når det kommer til kjøp og salg av båt i annenhåndsmarkedet.</strong></em></p>\n<p class=\"font_8\"><em><strong>Vi skiller oss fra våre konkurrenter ved å tilby personlig service og rådgiving, bilder og video av ypperste kvalitet, og en enkel og forutsigbar kostnadsmodell. Vårt fokus er å være en markedsledende aktør og samarbeidspartner, enten du er i markedet for å kjøpe, selge, bytte eller chartre.</strong></em></p>\n<p class=\"font_8\"><em><strong>Sammen kartlegger vi dine behov og ønsker, og finner riktig løsning for deg.</strong></em></p>\n<p class=\"font_8\"><em><strong>Gjennom et etablert internasjonalt nettverk kan vi bistå med å fremskaffe de fleste båter for import, eller tilrettelegge for ditt båthold i utlandet.</strong></em></p>\n<p class=\"font_8\"><em><strong>Vi kan bistå med frakt, forsikring, finansiering, verdivurdering og verditakst.</strong></em></p>\n<p class=\"font_8\"><em><strong>Vi tar forbehold om eventuelle feil i salgsoppgaven.</strong></em></p>\n<p class=\"font_8\"><em><strong>Fartøyet selges “as is”. Kjøpet er regulert av kjøpsloven og House of Yachts AS er kun mellomann og således ikke part i kjøpekontrakten.</strong></em></p>",
      "activated": "no",
      "status": "sold",
      "market_type": "used",
      "sold_date_proxy": "2021-05-11"
    },
    "image_url": "https://static.wixstatic.com/media/ad1ced_96127d0d70034710b6cb2a2263cafdd0~mv2.jpg"
  },
  {
    "slug": "sargo-25",
    "action": "create",
    "hs_id": null,
    "props": {
      "boat_name": "Sargo 25",
      "page_path2": "sargo-25",
      "merke": "Sargo",
      "modell": "25",
      "arsmodell": "2018",
      "lengde_i_fot": "25 fot",
      "pris": "Solgt!",
      "price_two": "1590000",
      "motorfabrikant": "Volvo Penta D4-260",
      "motortype": "Innenbords",
      "motorstorrelse": "260 HK",
      "customer_comment": "<p class=\"font_8\"><em><strong>VI HAR FÅTT INN FOR SALG EN RÅTØFF SARGO 25. BÅTEN ER MEGET VELHOLDT, LAGRET INNENDØRS OG MED FULL SERVICEHISTORIKK.</strong></em><em>&nbsp;</em></p>\n<p class=\"font_8\"><br>\nNydelig &nbsp;helårsbåt med solide egenskaper. Skumfylt skrog, stor takluke og dører &nbsp;ut på hver side. Båten er meget godt ustyrt, og fremstår som en svært &nbsp;moderne og komfortabel styrhusbåt.<br>\nSvært pertentlig holdt båt, kommer &nbsp;nettopp fra service hos Volvo Penta autorisert verksted, ca 200 timer &nbsp;på motor.&nbsp;</p>\n<p class=\"font_8\">Alle bilder av båten tatt August 2020.<br>\nBåten er skipsregistrert, og kan dermed belånes med pant i båt. Vi ordner gunstig finansiering, og frakt over hele landet.</p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Ligger i Østfold.<br>\n</strong></p>\n<p class=\"font_8\"><strong>Ta kontakt for avtale om visning og mer informasjon:</strong></p>\n<p class=\"font_8\"><strong>Sindre Jacobsen<br>\n938 40 189<br>\nsindre@h-y.no<br>\n<br>\neller<br>\n<br>\nSondre Klungland<br>\n924 62 418<br>\nsondre@h-y.no</strong></p>",
      "activated": "no",
      "status": "sold",
      "market_type": "used",
      "sold_date_proxy": "2020-09-12"
    },
    "image_url": "https://static.wixstatic.com/media/ad1ced_f3e9771304ba45afabad68dd9f2a4c4e~mv2.jpg"
  },
  {
    "slug": "windy-7500",
    "action": "create",
    "hs_id": null,
    "props": {
      "boat_name": "Windy 7500",
      "page_path2": "windy-7500",
      "merke": "Windy",
      "modell": "7500",
      "arsmodell": "2000",
      "lengde_i_fot": "25 fot",
      "pris": "Solgt!",
      "price_two": "290000",
      "motorfabrikant": "Volvo Penta AQ KAD 32",
      "motortype": "Innenbords",
      "motorstorrelse": "160 HK",
      "customer_comment": "<p style=\"font-size:14px\"><span style=\"font-size:14px\"><span style=\"font-family:questrial,sans-serif\"><span style=\"font-style:italic\"><span style=\"font-weight:bold\">Vi har f&aring;tt inn for salg en meget velholdt og oppgradert Windy 7500 fra 1999. B&aring;ten har v&aelig;rt i eie hos selger siden 2002 og er tatt meget godt vare p&aring; opp gjennom &aring;rene. Tidl&oslash;s klassiker, en av de siste Windy 7500 som ble bygget og en av f&aring; b&aring;ter utstyrt med Kad 32 Diesel motor.</span></span><br />\n<br />\n<span style=\"font-weight:bold\">Om b&aring;ten:</span><br />\nWindy 7500 er en tidl&oslash;s klassiker, tegnet av Jan H. Linge. B&aring;ten har n&aelig;rmest oppn&aring;dd kultstatus, og er for mange et kj&aelig;rt samleobjekt. Den perfekte kombinasjonen av sportslige cruiser-egenskaper og sosiale l&oslash;sninger for hele familien. Med Volvo Pentas 4-sylindrete dieselmotor med turbo og kompressor oppn&aring;r du toppfart opp mot 36 knop. B&aring;ten har i praksis ingen planingsterskel da den slipper vannet p&aring; rundt 12 knop. Utstyrt med egen av/p&aring; bryter for kompressor. Meget godt egnet for vannsport med kraftig dreiemoment, og drar selvsagt fordelen av langt lavere drivstoff-forbruk enn sine s&oslash;sterskip med bensin.<br />\n<br />\n<span style=\"font-weight:bold\">Oppgraderinger:</span></span></span></p>\n\n<p style=\"font-size:14px\"><span style=\"font-size:14px\"><span style=\"font-family:questrial,sans-serif\">- I 2016 ble instrumentpanelet byttet, samt elektriske brytere og installering av kartplotter som kan justeres fra st&aring;ende til liggende posisjon.<br />\n- I 2018 ble drivlinje, aggregat, elektrisk system og drivstoffsystemet renovert. Ny syrefast dieseltank, elektriske tilf&oslash;rselsledninger, dynamo, startmotor og duo-prop skiftet. Det ble ogs&aring; tatt en gjennomgang av motor - turbo og kompressor.</span></span></p>\n\n<p style=\"font-size:14px\"><span style=\"font-size:14px\"><span style=\"font-family:questrial,sans-serif\"><span class=\"wixGuard\">​</span></span></span></p>\n\n<h2 style=\"font-size:14px\"><span style=\"font-weight:bold\"><span style=\"font-size:14px\"><span style=\"font-family:questrial,sans-serif\">Utstyr</span></span></span></h2>\n\n<p style=\"font-size:14px\"><span style=\"font-size:14px\"><span style=\"font-family:questrial,sans-serif\">- Trimflaps med indikator<br />\n- Dybdem&aring;ler<br />\n- Automatisk brannslukkingssystem i motorrom<br />\n- Badestige<br />\n- Vindushvisker<br />\n- Kompass</span></span></p>",
      "activated": "no",
      "status": "sold",
      "market_type": "used",
      "sold_date_proxy": "2020-04-22"
    },
    "image_url": "https://static.wixstatic.com/media/ad1ced_9640aed22f864a3eac4954ce5d9e3f3f~mv2_d_5760_3840_s_4_2.jpg"
  },
  {
    "slug": "saffier-se-33-ud",
    "action": "update",
    "hs_id": "351443310798",
    "props": {
      "boat_name": "Saffier SE 33 UD",
      "page_path2": "saffier-se-33-ud",
      "merke": "Saffier Yachts",
      "modell": "SE 33 UD",
      "arsmodell": "2016",
      "lengde_i_fot": "31 fot",
      "pris": "Solgt!",
      "price_two": "1600000",
      "motorfabrikant": "Yanmar",
      "motortype": "Innenbords",
      "motorstorrelse": "14 hk",
      "customer_comment": "<p class=\"font_8\"><em>House of Yacht Sail Division presenterer denne Saffier SE 33 UD for salg. En linjelekker og rask båt, designet for enkel single- og shorthanded håndtering.</em></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\">Saffier Yachts er et nederlandsk verft som er spesialisert på å bygge high-end dagseilere. Samtlige av verftets modeller er designet for å kunne seiles short- eller singlehanded, og kjennetegnes av flotte seilegenskaper, sosiale- og komfortable cockpitlayouts i kombinasjon med ekte nederlandsk byggekvalitet.</p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\">Da denne båten ble bestilt ny i 2016 (levert vår 2017) ble det ikke spart på noe. Listen over tilvalg kostet alene over 1 MNOK.</p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Båten ligger i Holmsbu, klar for visning.&nbsp;</strong></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\">Om du ønsker å vite mer om denne båten kan salgsprospektet lastes ned på denne siden. Fyll inn epost og klikk deretter på knappen \"Last ned salgsprospekt som PDF\".</p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Denne båten er skipsregistrert og kan lånefinansieres. Vi kan tilby finansiering gjennom Sparebank1. Kontakt oss for tilbud.</strong><br>\n</p>\n<p class=\"font_8\"><br>\n<strong>Sondre Klungland</strong><br>\n<strong>924 62&nbsp;418</strong><br>\n<strong>sondre@h-y.no</strong></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>eller</strong></p>\n<p class=\"font_8\"><br></p>\n<p class=\"font_8\"><strong>Sindre Jacobsen</strong><br>\n<strong>938 40&nbsp;189</strong><br>\n<strong>sindre@h-y.no</strong></p>",
      "activated": "no",
      "status": "sold",
      "market_type": "used",
      "sold_date_proxy": "2021-11-10"
    },
    "image_url": "https://static.wixstatic.com/media/b99d91_cb5dc831392842e99d5992f36566f359~mv2.jpg"
  },
  {
    "slug": "chris-craft-carina-21",
    "action": "update",
    "hs_id": "351443310803",
    "props": {
      "boat_name": "Chris-Craft Carina 21",
      "page_path2": "chris-craft-carina-21",
      "merke": "Chris-Craft",
      "modell": "Carina 21",
      "arsmodell": "2014",
      "lengde_i_fot": "21 fot",
      "pris": "Solgt!",
      "price_two": "575000",
      "motorfabrikant": "Volvo Penta V8-300 FWC",
      "motortype": "Innenbords",
      "motorstorrelse": "300 HK",
      "customer_comment": "<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\">For salg har vi en lekker Carina 21 fra 2014 utstyrt med en Volvo Penta V8 bensinmotor med kun ca 120 timer.&nbsp;</span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\"><span class=\"wixGuard\">​</span></span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\">Om b&aring;ten:</span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Om du er en som tenker at alle 21-fots bowridere ser like ut, er det tydelig at du ikke kjenner til Chris-Craft. Fra baug til akter er Carina 21 original i designet. Dette er en elegant b&aring;t som vekker oppmerksomhet, og som garantert vil gi deg kommentarer og tommeler opp.</span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Carina 21 er en super daycruiser, med plass til inntil 7 personer. Med kraftig motorisering byr Carina 21 p&aring; sportlige ytelser, og egner seg supert for vannski/vannsport.</span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Den aktuelle b&aring;ten er smakfult spec:et med skrog lakkert i fargen &ldquo;Dark Graphite&rdquo;, interi&oslash;r i Silvertex i fargen &ldquo;Cream&rdquo; med diamantm&oslash;nster, og matter p&aring; d&oslash;rken av typen &ldquo;Seagrass&rdquo;.&nbsp;</span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\">B&aring;ten ligger lagret innend&oslash;rs i Leangbukta i Asker.</span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\"><span class=\"wixGuard\">​</span></span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-weight:bold;\"><span style=\"font-size:14px;\">Last ned salgsprospekt for utstyrsliste med mer.</span></span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Ta kontakt med</span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Sondre Klungland</span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">924 62 418</span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">sondre@h-y.no</span></p>\n\n<p style=\"font-size: 14px;\">&nbsp;</p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">eller</span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\"><span class=\"wixGuard\">​</span></span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">Sindre Jacobsen</span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">938 40 189</span></p>\n\n<p style=\"font-size: 14px;\"><span style=\"font-size:14px;\">sindre@h-y.no</span></p>",
      "activated": "no",
      "status": "sold",
      "market_type": "used",
      "sold_date_proxy": "2021-05-03"
    },
    "image_url": "https://static.wixstatic.com/media/b99d91_31df5bc5951e4a21a754a718ed924b99~mv2_d_5760_3840_s_4_2.jpg"
  }
];

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const action = event.queryStringParameters?.action;
  let boats = [];

  try {
    if (action === 'convertgallery') {
      // For each boat: read gallery_images (file ID), fetch file URL, PATCH gallery_images to full URL
      // Skips if already a URL. Idempotent.
      const body = JSON.parse(event.body || '{}');
      const ids = body.hs_ids || [];
      const results = [];
      for (const hsId of ids) {
        try {
          const fetched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${hsId}?properties=gallery_images`, 'GET');
          if (!fetched.ok) throw new Error(`fetch: ${fetched.status}`);
          const current = (fetched.data?.properties?.gallery_images || '').trim();
          if (!current) { results.push({ ok: true, hs_id: hsId, action: 'skipped', reason: 'empty' }); continue; }
          if (current.startsWith('http')) { results.push({ ok: true, hs_id: hsId, action: 'skipped', reason: 'already url' }); continue; }
          if (current.includes(';')) { results.push({ ok: true, hs_id: hsId, action: 'skipped', reason: 'multi-image gallery (team-managed) — leaving untouched' }); continue; }
          const firstId = current.split(';')[0].trim();
          const fileRes = await hs(`/files/v3/files/${firstId}`, 'GET');
          if (!fileRes.ok) throw new Error(`file fetch: ${fileRes.status}`);
          const url = fileRes.data?.url || fileRes.data?.defaultHostingUrl;
          if (!url) throw new Error('no url in file response');
          const patched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${hsId}`, 'PATCH', { properties: { gallery_images: url } });
          if (!patched.ok) throw new Error(`patch: ${patched.status}`);
          results.push({ ok: true, hs_id: hsId, action: 'converted', from: firstId, to: url });
        } catch (e) {
          results.push({ ok: false, hs_id: hsId, error: e.message });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, converted: results.filter(r => r.action==='converted').length, skipped: results.filter(r => r.action==='skipped').length, results }, null, 2) };
    } else if (action === 'findunconverted') {
      // Lists activated boats with single file ID gallery_images (convertgallery candidates)
      // Query param: status=sold|for-sale|any (default: any)
      const statusFilter = event.queryStringParameters?.status || 'any';
      const all = [];
      let after;
      do {
        const q = after ? `?limit=100&after=${after}&properties=boat_name,gallery_images,status,activated` : '?limit=100&properties=boat_name,gallery_images,status,activated';
        const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}${q}`, 'GET');
        if (!res.ok) throw new Error(`list failed: ${res.status}`);
        (res.data.results || []).forEach(r => {
          const p = r.properties || {};
          const gi = (p.gallery_images || '').trim();
          const statusOk = statusFilter === 'any' || p.status === statusFilter;
          if (statusOk && p.activated === 'yes' && gi && !gi.startsWith('http') && !gi.includes(';') && /^\d+$/.test(gi)) {
            all.push({ id: r.id, boat_name: p.boat_name, status: p.status, gallery_images: gi });
          }
        });
        after = res.data.paging?.next?.after;
      } while (after);
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: all.length, hs_ids: all.map(b => b.id), boats: all }, null, 2) };
    } else if (action === 'findmissing') {
      // List all sold+activated boats with empty gallery_images
      const all = [];
      let after;
      do {
        const q = after ? `?limit=100&after=${after}&properties=boat_name,gallery_images,status,activated` : '?limit=100&properties=boat_name,gallery_images,status,activated';
        const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}${q}`, 'GET');
        if (!res.ok) throw new Error(`list failed: ${res.status}`);
        (res.data.results || []).forEach(r => {
          const p = r.properties || {};
          if (p.status === 'sold' && p.activated === 'yes' && (!p.gallery_images || !p.gallery_images.trim())) {
            all.push({ id: r.id, boat_name: p.boat_name, url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${r.id}` });
          }
        });
        after = res.data.paging?.next?.after;
      } while (after);
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: all.length, boats: all }, null, 2) };
    } else if (action === 'peekfile') {
      // Compare file metadata for debugging missing images
      const ids = (event.queryStringParameters?.ids || '').split(',').filter(Boolean);
      const out = [];
      for (const id of ids) {
        const r = await hs(`/files/v3/files/${id}`, 'GET');
        out.push({ id, ok: r.ok, status: r.status, file: r.data });
      }
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(out, null, 2) };
    } else if (action === 'peek') {
      // Fetch full properties for one or more boats (debugging)
      const ids = (event.queryStringParameters?.ids || '').split(',').filter(Boolean);
      const out = [];
      for (const id of ids) {
        const r = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${id}?properties=boat_name,slug,page_path2,gallery_images,status,activated,pris,boat_type,batmerke,bat_modell,lengde_i_fot,arsmodell`, 'GET');
        out.push({ id, ok: r.ok, properties: r.data?.properties });
      }
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(out, null, 2) };
    } else if (action === 'archivepages') {
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'no token' }) };
      const body = JSON.parse(event.body || '{}');
      const ids = body.ids || [];
      const results = [];
      for (const id of ids) {
        const r = await fetch(`https://api.hubapi.com/cms/v3/pages/site-pages/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const t = await r.text();
        results.push({ id, status: r.status, ok: r.ok, error: r.ok ? null : t.slice(0, 200) });
      }
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok: results.filter(x => x.ok).length, results }, null, 2) };
    } else if (action === 'listpages') {
      // List all site pages
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'no token' }) };
      const all = [];
      let after;
      do {
        const q = after ? `?limit=100&after=${after}&archived=false` : '?limit=100&archived=false';
        const r = await fetch(`https://api.hubapi.com/cms/v3/pages/site-pages${q}`, { headers: { Authorization: `Bearer ${token}` } });
        const d = await r.json();
        (d.results || []).forEach(p => all.push({
          id: p.id,
          name: p.name,
          slug: p.slug,
          url: p.url,
          state: p.state,
          updated: p.updated,
          created: p.created,
        }));
        after = d.paging?.next?.after;
      } while (after);
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: all.length, pages: all }, null, 2) };
    } else if (action === 'createredirects') {
      // Bulk create URL redirects. Body: { redirects: [{ source, destination, code=301 }] }
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'HUBSPOT_CONTENT_TOKEN not set' }) };
      const body = JSON.parse(event.body || '{}');
      const redirects = body.redirects || [];
      const results = [];
      for (const r of redirects) {
        try {
          const req = await fetch('https://api.hubapi.com/cms/v3/url-redirects/', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              routePrefix: r.source,
              destination: r.destination,
              redirectStyle: r.code || 301,
              precedence: 1,
              isOnlyAfterNotFound: false,
              isMatchFullUrl: false,
              isMatchQueryString: false,
              isPattern: false,
              isTrailingSlashOptional: true,
              isProtocolAgnostic: true,
            }),
          });
          const t = await req.text();
          let data; try { data = JSON.parse(t); } catch { data = { raw: t.slice(0, 200) }; }
          results.push({ ok: req.ok, status: req.status, source: r.source, destination: r.destination, id: data.id, error: req.ok ? null : (data.message || data.raw) });
        } catch (e) {
          results.push({ ok: false, source: r.source, error: e.message });
        }
      }
      const ok = results.filter(x => x.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }, null, 2) };
    } else if (action === 'writetheme_raw') {
      // Write raw source to a theme path. Body: { path, source }
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'HUBSPOT_CONTENT_TOKEN not set' }) };
      const body = JSON.parse(event.body || '{}');
      if (!body.path || typeof body.source !== 'string') return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'need path + source' }) };
      const fname = body.path.split('/').pop();
      const boundary = '----FormBoundary' + Date.now().toString(16);
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: text/html\r\n\r\n`,
        body.source,
        `\r\n--${boundary}--\r\n`,
      ];
      const payload = Buffer.concat(parts.map(x => Buffer.from(x, 'utf8')));
      const r = await fetch(`https://api.hubapi.com/cms/v3/source-code/published/content/${encodeURI(body.path)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body: payload,
      });
      const t = await r.text();
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ status: r.status, ok: r.ok, resp: t.slice(0, 400) }, null, 2) };
    } else if (action === 'repubtheme') {
      // Reads + re-writes same content to trigger HubSpot theme recompile
      const p = event.queryStringParameters?.path;
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!p || !token) return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'missing path or token' }) };
      const r1 = await fetch(`https://api.hubapi.com/cms/v3/source-code/published/content/${encodeURI(p)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r1.ok) return { statusCode: r1.status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ step: 'read', error: await r1.text() }) };
      const src = await r1.text();
      // Add a timestamp comment to ensure actual change
      const modified = `{# republished-${Date.now()} #}\n${src}`;
      // HubSpot Source Code API accepts multipart/form-data with 'file' field
      const boundary = '----FormBoundary' + Date.now().toString(16);
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${p.split('/').pop()}"\r\nContent-Type: text/html\r\n\r\n`,
        modified,
        `\r\n--${boundary}--\r\n`,
      ];
      const body = Buffer.concat(parts.map(x => Buffer.from(x, 'utf8')));
      const r2 = await fetch(`https://api.hubapi.com/cms/v3/source-code/published/content/${encodeURI(p)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const t2 = await r2.text();
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ read: { ok: r1.ok, bytes: src.length }, write: { status: r2.status, ok: r2.ok, resp: t2.slice(0, 300) } }, null, 2) };
    } else if (action === 'readtheme') {
      const p = event.queryStringParameters?.path;
      if (!p) return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'missing path' }) };
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'HUBSPOT_CONTENT_TOKEN not set' }) };
      const r = await fetch(`https://api.hubapi.com/cms/v3/source-code/published/content/${encodeURI(p)}`, { headers: { Authorization: `Bearer ${token}` } });
      const t = await r.text();
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'text/plain' }, body: `status=${r.status}\n${t.slice(0, 2000)}` };
    } else if (action === 'writetheme') {
      // Write theme file via Source Code API. Body: { path, source }
      const token = process.env.HUBSPOT_CONTENT_TOKEN;
      if (!token) return { statusCode: 500, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'HUBSPOT_CONTENT_TOKEN not set' }) };
      const body = JSON.parse(event.body || '{}');
      if (!body.path || typeof body.source !== 'string') return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'need path + source' }) };
      const r = await fetch(`https://api.hubapi.com/cms/v3/source-code/published/content/${encodeURI(body.path)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: body.source }),
      });
      const t = await r.text();
      let parsed; try { parsed = JSON.parse(t); } catch { parsed = { raw: t.slice(0, 500) }; }
      return { statusCode: r.status, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ status: r.status, ok: r.ok, response: parsed }, null, 2) };
    } else if (action === 'setname') {
      // Set boat_name to explicit new value (for special cases)
      const body = JSON.parse(event.body || '{}');
      const items = body.boats || [];
      const results = [];
      for (const it of items) {
        try {
          const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${it.hs_id}`, 'PATCH', { properties: { boat_name: it.boat_name } });
          results.push({ ok: res.ok, hs_id: it.hs_id, boat_name: it.boat_name, error: res.ok ? null : JSON.stringify(res.data).slice(0, 200) });
        } catch (e) {
          results.push({ ok: false, hs_id: it.hs_id, error: e.message });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }, null, 2) };
    } else if (action === 'findprefixed') {
      // Fetch all boats with boat_name starting with "NNNNN - " pattern (oppdragsnummer prefix)
      const all = [];
      let after = undefined;
      do {
        const q = after ? `?limit=100&after=${after}&properties=boat_name` : '?limit=100&properties=boat_name';
        const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}${q}`, 'GET');
        if (!res.ok) throw new Error(`List failed: ${res.status}`);
        (res.data.results || []).forEach(r => all.push({ id: r.id, boat_name: r.properties?.boat_name || '' }));
        after = res.data.paging?.next?.after;
      } while (after);
      const matches = all.filter(b => /^\s*\d{3,6}\s*-\s*/.test(b.boat_name));
      const preview = matches.map(b => ({
        hs_id: b.id,
        current: b.boat_name,
        proposed: b.boat_name.replace(/^\s*\d{3,6}\s*-\s*/, '').trim(),
      }));
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total_boats: all.length, matches: preview.length, preview }, null, 2) };
    } else if (action === 'stripprefix') {
      // Strip oppdragsnummer prefix from boat_name for given hs_ids
      const body = JSON.parse(event.body || '{}');
      const ids = body.hs_ids || [];
      const results = [];
      for (const hsId of ids) {
        try {
          const fetched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${hsId}?properties=boat_name`, 'GET');
          if (!fetched.ok) throw new Error(`fetch: ${fetched.status}`);
          const current = fetched.data?.properties?.boat_name || '';
          const stripped = current.replace(/^\s*\d{3,6}\s*-\s*/, '').trim();
          if (stripped === current) {
            results.push({ ok: true, hs_id: hsId, action: 'skipped', reason: 'no prefix', current });
            continue;
          }
          const patched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${hsId}`, 'PATCH', { properties: { boat_name: stripped } });
          if (!patched.ok) throw new Error(`patch: ${patched.status} ${JSON.stringify(patched.data)}`);
          results.push({ ok: true, hs_id: hsId, action: 'stripped', from: current, to: stripped });
        } catch (e) {
          results.push({ ok: false, hs_id: hsId, error: e.message });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }, null, 2) };
    } else if (action === 'setboattype') {
      const body = JSON.parse(event.body || '{}');
      const items = body.boats || [];
      const results = [];
      for (const it of items) {
        try {
          const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${it.hs_id}`, 'PATCH', { properties: { boat_type: it.boat_type } });
          results.push({ ok: res.ok, hs_id: it.hs_id, boat_type: it.boat_type, error: res.ok ? null : JSON.stringify(res.data).slice(0, 200) });
        } catch (e) {
          results.push({ ok: false, hs_id: it.hs_id, boat_type: it.boat_type, error: e.message });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }, null, 2) };
    } else if (action === 'schema') {
      // Inspect boat_type property to see valid enum values
      const prop = event.queryStringParameters?.prop || 'boat_type';
      const res = await hs(`/crm/v3/properties/${BOAT_OBJ_TYPE}/${prop}`, 'GET');
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify(res.data, null, 2) };
    } else if (action === 'fillimages') {
      // For each {hs_id, slug, image_url}: fetch boat, check gallery_images, if empty → upload image + PATCH
      const body = JSON.parse(event.body || '{}');
      const items = body.boats || [];
      if (!Array.isArray(items) || items.length === 0) {
        return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'no boats' }) };
      }
      const results = [];
      for (const it of items) {
        const started = Date.now();
        try {
          // Check current gallery_images
          const fetched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${it.hs_id}?properties=gallery_images`, 'GET');
          if (!fetched.ok) throw new Error(`fetch failed: ${fetched.status}`);
          const existing = (fetched.data?.properties?.gallery_images || '').trim();
          if (existing) {
            results.push({ ok: true, slug: it.slug, hs_id: it.hs_id, action: 'skipped', reason: 'already has images', existing, duration_ms: Date.now() - started });
            continue;
          }
          if (!it.image_url) {
            results.push({ ok: false, slug: it.slug, hs_id: it.hs_id, action: 'skipped', reason: 'no wix image url', duration_ms: Date.now() - started });
            continue;
          }
          // Download + upload + PATCH
          const { buffer, contentType } = await downloadImage(it.image_url);
          const ext = contentType.includes('png') ? 'png' : 'jpg';
          const up = await uploadImage(buffer, `${it.slug}.${ext}`, contentType);
          const patched = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${it.hs_id}`, 'PATCH', { properties: { gallery_images: String(up.id) } });
          if (!patched.ok) throw new Error(`patch failed: ${patched.status} ${JSON.stringify(patched.data)}`);
          results.push({ ok: true, slug: it.slug, hs_id: it.hs_id, action: 'filled', file_id: up.id, hs_url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${it.hs_id}`, duration_ms: Date.now() - started });
        } catch (e) {
          results.push({ ok: false, slug: it.slug, hs_id: it.hs_id, error: e.message, duration_ms: Date.now() - started });
        }
      }
      const ok = results.filter(r => r.ok).length;
      return { statusCode: 200, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, filled: results.filter(r => r.action==='filled').length, skipped: results.filter(r => r.action==='skipped').length, results }, null, 2) };
    } else if (action === 'activate') {
      // Batch-activate boats: PATCH activated=yes for each HS ID
      const body = JSON.parse(event.body || '{}');
      const hsIds = body.hs_ids || [];
      if (!Array.isArray(hsIds) || hsIds.length === 0) {
        return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'no hs_ids' }) };
      }
      const results = [];
      for (const hsId of hsIds) {
        const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${hsId}`, 'PATCH', { properties: { activated: 'yes' } });
        results.push({
          ok: res.ok,
          hs_id: hsId,
          hs_url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${hsId}`,
          error: res.ok ? null : JSON.stringify(res.data).slice(0, 200),
        });
      }
      const ok = results.filter(r => r.ok).length;
      return {
        statusCode: 200,
        headers: { ...CORS, ...JSON_H },
        body: JSON.stringify({ total: results.length, ok, failed: results.length - ok, results }, null, 2),
      };
    } else if (action === 'fixpilot') {
      // Fix the 3 pilot CREATEs that used customer_comment: clear it, set description (cleaned)
      const pilotCreates = [
        { hs_id: '426915761383', slug: 'azimut-47-fly' },
        { hs_id: '426912355563', slug: 'sargo-25' },
        { hs_id: '426911553726', slug: 'windy-7500' },
      ];
      const results = [];
      for (const pc of pilotCreates) {
        const src = PILOT_BOATS.find(b => b.slug === pc.slug);
        const cleaned = cleanWixHtml(src?.props?.customer_comment || '');
        const res = await hs(`/crm/v3/objects/${BOAT_OBJ_TYPE}/${pc.hs_id}`, 'PATCH', {
          properties: { description: cleaned, customer_comment: '' },
        });
        results.push({
          ok: res.ok,
          slug: pc.slug,
          hs_id: pc.hs_id,
          hs_url: `https://app-eu1.hubspot.com/contacts/26753504/record/2-145214665/${pc.hs_id}`,
          description_chars: cleaned.length,
          description_preview: cleaned.slice(0, 300) + (cleaned.length > 300 ? '…' : ''),
          error: res.ok ? null : JSON.stringify(res.data),
        });
      }
      return {
        statusCode: 200,
        headers: { ...CORS, ...JSON_H },
        body: JSON.stringify({ total: results.length, results }, null, 2),
      };
    } else if (action === 'pilot') {
      boats = PILOT_BOATS;
    } else if (action === 'run') {
      const body = JSON.parse(event.body || '{}');
      boats = body.boats || [];
    } else {
      return {
        statusCode: 400,
        headers: { ...CORS, ...JSON_H },
        body: JSON.stringify({ error: 'missing ?action=pilot or ?action=run' }),
      };
    }

    if (!Array.isArray(boats) || boats.length === 0) {
      return { statusCode: 400, headers: { ...CORS, ...JSON_H }, body: JSON.stringify({ error: 'no boats' }) };
    }

    const results = [];
    for (const spec of boats) {
      const r = await migrateBoat(spec);
      results.push(r);
      console.log(JSON.stringify(r));
    }

    const ok = results.filter(r => r.ok).length;
    const failed = results.length - ok;

    return {
      statusCode: 200,
      headers: { ...CORS, ...JSON_H },
      body: JSON.stringify({ total: results.length, ok, failed, results }, null, 2),
    };
  } catch (err) {
    console.error('wix-migrate error:', err.message);
    return {
      statusCode: 500,
      headers: { ...CORS, ...JSON_H },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
