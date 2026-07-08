// ── gallery-folder.js ───────────────────────────────────────────────────────
// Erstatter 5FortyFive sin Vercel-proxy (hubspot-folder-wine.vercel.app).
// Henter galleri-bilder for en båt fra HubSpot Files v3 og returnerer
// identisk format som Vercel-appen:
//
//   GET /gallery-folder?parentFolderIds={folderId}
//   → [ { "folder": "Exterior", "items": [ { "id", "name", "url" } ] }, ... ]
//
// VIKTIG: Ingen auth-gate — kalles av anonyme besøkende på offentlig nettside.
// Returnerer alltid 200 med tom liste [] ved feil, så galleriet degraderer pent.
// ──────────────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function hs(path, method = 'GET', body = null) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization:  `Bearer ${process.env.HUBSPOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
  catch { return { ok: false, status: res.status, data: { raw: text } }; }
}

// Hent alle filer i en mappe (paginert — galleri kan ha >100 bilder)
async function getFilesInFolder(folderId) {
  const items = [];
  let after = null;

  for (let page = 0; page < 10; page++) { // hard stopp ved 1000 filer
    const qs = `parentFolderIds=${folderId}&limit=100` + (after ? `&after=${encodeURIComponent(after)}` : '');
    const res = await hs(`/files/v3/files/search?${qs}`);
    if (!res.ok) {
      console.error('gallery-folder: files/search feilet', folderId, res.status, JSON.stringify(res.data).slice(0, 300));
      break;
    }

    for (const f of (res.data.results || [])) {
      items.push({ id: f.id, name: f.name, url: f.url });
    }

    after = res.data.paging?.next?.after || null;
    if (!after) break;
  }

  return items;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const respond = (payload) => ({
    statusCode: 200,
    headers: {
      ...CORS,
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=300', // 5 min edge/browser-cache — avlaster HubSpot-API
    },
    body: JSON.stringify(payload),
  });

  try {
    const folderId = String((event.queryStringParameters || {}).parentFolderIds || '').trim();
    if (!/^\d+$/.test(folderId)) return respond([]);

    // 1) Undermapper av parent (samme rekkefølge som HubSpot returnerer — matcher Vercel-appen)
    const foldersRes = await hs(`/files/v3/folders/search?parentFolderIds=${folderId}&limit=100`);
    if (!foldersRes.ok) {
      console.error('gallery-folder: folders/search feilet', folderId, foldersRes.status);
      return respond([]);
    }
    const folders = foldersRes.data.results || [];

    // 2) Filer per undermappe
    const groups = await Promise.all(
      folders.map(async (f) => ({ folder: f.name, items: await getFilesInFolder(f.id) }))
    );

    // 3) Filer som ligger direkte i parent-mappa (finnes normalt ikke, men tas med
    //    som egen gruppe uten fanenavn-treff hvis de dukker opp)
    const rootItems = await getFilesInFolder(folderId);
    if (rootItems.length) groups.push({ folder: '', items: rootItems });

    return respond(groups.filter(g => g.items.length));
  } catch (err) {
    console.error('gallery-folder: uventet feil', err);
    return respond([]);
  }
};
