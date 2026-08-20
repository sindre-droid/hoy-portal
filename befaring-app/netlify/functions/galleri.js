// galleri.js — API for Galleri-modulen i internportalen (megler-administrasjon).
//
//   GET  ?action=boats                → båter med galleri (id, navn, folder, status)
//   GET  ?action=files&folder=ID      → undermapper med filer (id, navn, url, b/h)
//   POST {action:'reorder', folderId, order:[fileId,…]}  → nye 001-prefikser i gitt rekkefølge
//   POST {action:'move', fileId, targetFolderId}
//   POST {action:'delete', fileId}
//   POST {action:'upload', folderId, filename, dataUrl}  → base64 → HubSpot Files (PUBLIC_INDEXABLE)
//
// Galleriene er kilden nettsiden leser (gallery-folder.js, 5 min cache) — endringer
// her er synlige på boat-siden innen ~5 min. Auth: Netlify Identity, @h-y.no.

const BOATS = '2-145214665';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const err = (s, m) => ({ statusCode: s, headers: CORS, body: JSON.stringify({ error: m }) });
const ok = (d) => ({ statusCode: 200, headers: CORS, body: JSON.stringify(d) });

function parseJwt(t) {
  try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8')); }
  catch { return {}; }
}

async function hs(path, opts = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

const hsJson = (path, body, method = 'POST') =>
  hs(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function listFiles(folderId) {
  const out = [];
  let after = null;
  for (let page = 0; page < 10; page++) {
    const qs = `parentFolderIds=${folderId}&limit=100` + (after ? `&after=${encodeURIComponent(after)}` : '');
    const res = await hs(`/files/v3/files/search?${qs}`);
    if (!res.ok) break;
    for (const f of (res.data.results || [])) {
      out.push({ id: f.id, name: f.name, url: f.url, width: f.width || 0, height: f.height || 0, ext: f.extension || 'jpg' });
    }
    after = res.data.paging?.next?.after || null;
    if (!after) break;
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb', { numeric: true }));
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS };

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  if (!authHeader.startsWith('Bearer ')) return err(401, 'Unauthorized');
  const email = String(parseJwt(authHeader.slice(7)).email || '').toLowerCase();
  if (!email.endsWith('@h-y.no')) return err(403, 'Ingen tilgang');

  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};

      if ((q.action || '') === 'boats') {
        const boats = [];
        let after;
        do {
          const res = await hsJson(`/crm/v3/objects/${BOATS}/search`, {
            filterGroups: [{ filters: [{ propertyName: 'gallery_folder_id', operator: 'HAS_PROPERTY' }] }],
            properties: ['boat_name', 'gallery_folder_id', 'status', 'activated', 'page_path2'],
            limit: 200, after,
          });
          if (!res.ok) throw new Error(`HubSpot ${res.status}`);
          boats.push(...res.data.results);
          after = res.data.paging?.next?.after;
        } while (after);
        const rows = boats
          .map((b) => ({
            boatId: b.id,
            name: b.properties.boat_name || `(uten navn ${b.id})`,
            folder: b.properties.gallery_folder_id,
            forSale: b.properties.status === 'for-sale',
            live: b.properties.activated === 'yes',
            path: b.properties.page_path2 || null,
          }))
          .filter((b) => b.folder && b.folder !== '264782168284') // hopp over rot-feilpekere
          .sort((a, b2) => (Number(b2.forSale) - Number(a.forSale)) || a.name.localeCompare(b2.name, 'nb'));
        return ok(rows);
      }

      if ((q.action || '') === 'files') {
        const folderId = String(q.folder || '').trim();
        if (!/^\d+$/.test(folderId)) return err(400, 'Ugyldig folder');
        const subsRes = await hs(`/files/v3/folders/search?parentFolderIds=${folderId}&limit=30`);
        const subs = subsRes.ok ? (subsRes.data.results || []) : [];
        // sørg for at alle tre standardmappene finnes (lag ved behov, så opplasting alltid har mål)
        const wanted = ['Exterior', 'Interior', 'Details'];
        for (const w of wanted) {
          if (!subs.find((s) => s.name === w)) {
            const c = await hsJson('/files/v3/folders', { name: w, parentFolderId: folderId });
            if (c.ok) subs.push(c.data);
          }
        }
        const groups = [];
        for (const s of subs.sort((a, b) => wanted.indexOf(a.name) - wanted.indexOf(b.name))) {
          groups.push({ folder: s.name, folderId: s.id, items: await listFiles(s.id) });
        }
        return ok(groups);
      }

      return err(400, 'Ukjent action');
    }

    // POST-handlinger
    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {}
    const action = body.action || '';

    if (action === 'reorder') {
      const { folderId, order } = body;
      if (!/^\d+$/.test(String(folderId)) || !Array.isArray(order) || !order.length) return err(400, 'folderId + order kreves');
      const files = await listFiles(folderId);
      const byId = Object.fromEntries(files.map((f) => [String(f.id), f]));
      let n = 0, endret = 0;
      for (const fid of order) {
        const f = byId[String(fid)];
        if (!f) continue;
        n++;
        const base = String(f.name).replace(/^\d{3}-/, '');
        const nytt = `${String(n).padStart(3, '0')}-${base}`;
        if (nytt !== f.name) {
          const r = await hsJson(`/files/v3/files/${f.id}`, { name: nytt }, 'PATCH');
          if (r.ok) endret++;
        }
      }
      return ok({ ok: true, antall: n, endret });
    }

    if (action === 'move') {
      const { fileId, targetFolderId } = body;
      if (!/^\d+$/.test(String(fileId)) || !/^\d+$/.test(String(targetFolderId))) return err(400, 'fileId + targetFolderId kreves');
      const r = await hsJson(`/files/v3/files/${fileId}`, { parentFolderId: String(targetFolderId) }, 'PATCH');
      return r.ok ? ok({ ok: true }) : err(502, `HubSpot ${r.status}`);
    }

    if (action === 'delete') {
      const { fileId } = body;
      if (!/^\d+$/.test(String(fileId))) return err(400, 'fileId kreves');
      const r = await hs(`/files/v3/files/${fileId}`, { method: 'DELETE' });
      return (r.ok || r.status === 204) ? ok({ ok: true }) : err(502, `HubSpot ${r.status}`);
    }

    if (action === 'thumb') {
      const { boatId, url } = body;
      if (!/^\d+$/.test(String(boatId)) || !/^https:\/\//.test(String(url))) return err(400, 'boatId + url kreves');
      const r = await hsJson(`/crm/v3/objects/${BOATS}/${boatId}`, { properties: { gallery_images: String(url) } }, 'PATCH');
      return r.ok ? ok({ ok: true }) : err(502, `HubSpot ${r.status}`);
    }

    if (action === 'upload') {
      const { folderId, filename, dataUrl } = body;
      if (!/^\d+$/.test(String(folderId)) || !filename || !dataUrl) return err(400, 'folderId + filename + dataUrl kreves');
      const m = String(dataUrl).match(/^data:(image\/jpeg|image\/png);base64,(.+)$/);
      if (!m) return err(400, 'dataUrl må være jpeg/png base64');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 4.5 * 1024 * 1024) return err(413, 'Bildet er for stort (maks ~4,5 MB) — komprimering feilet?');
      const safe = String(filename).replace(/[^\w.\-æøåÆØÅ ]/g, '').slice(0, 120) || 'bilde.jpg';
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: m[1] }), safe);
      fd.append('folderId', String(folderId));
      fd.append('options', JSON.stringify({ access: 'PUBLIC_INDEXABLE' }));
      const res = await fetch('https://api.hubapi.com/files/v3/files', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) return err(502, `Opplasting feilet (${res.status})`);
      return ok({ ok: true, id: data.id, url: data.url, name: data.name });
    }

    return err(400, 'Ukjent action');
  } catch (e) {
    console.error('galleri error:', e);
    return err(500, String(e.message || e));
  }
};
