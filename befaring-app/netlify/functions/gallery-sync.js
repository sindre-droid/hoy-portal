// gallery-sync.js — hvert 10. min: synker galleribilder fra SUPABASE (bildeopplasteren)
// til HUBSPOT FILES (som nettsidens galleri leser fra). Tetter gapet oppdaget 18. aug
// og som bet 27. aug (Cormate Sportmate 24: 82 bilder i Supabase, tom HubSpot-mappe →
// «bilder ikke tilgjengelig» på houseofyachts.no).
//
// Flyt per kjøring (idempotent, maks MAX_FILES_PER_RUN filer per kjøring):
//   1) Aktive båter på nettsiden (activated=yes, status=for-sale) med gallery_folder_id.
//   2) For hver båt: tell filer i HubSpot-mappen (undermapper). Har den filer fra før
//      OG ikke færre enn Supabase → hopp over (rask sti).
//   3) Ellers: finn B-deal via boats→deals-assosiasjon, list Supabase
//      prospekt-bilder/{deal_id}/ (flatt eller med undermapper).
//   4) Overfør manglende filer: Supabase → HubSpot. Flat struktur → «Exterior».
//      Undermapper speiles (opprettes ved behov). Numerisk suffiks nullpaddes (001-)
//      så rekkefølgen blir riktig i galleriet.
//   5) «Forside»-filer hoppes ALLTID over (innbakt HoY-logo — skal ikke på nettsiden,
//      Sindres regel 27. aug 2026).
//   6) Er boat.gallery_images tom etterpå → settes til første overførte Exterior-bilde
//      slik at /buy-kortet får cover. NB: prospekt-rekkefølgen starter ofte med
//      collager/detaljbilder — megler bør sjekke coveret (nevnes i loggen).

const HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOATS = "2-145214665";
const HS = "https://api.hubapi.com";
const MAX_FILES_PER_RUN = 20; // holder oss trygt innenfor funksjons-timeout; resten tas neste kjøring

const hsHeaders = { Authorization: `Bearer ${HUBSPOT_TOKEN}`, "Content-Type": "application/json" };

async function hs(path, opts = {}) {
  const res = await fetch(`${HS}${path}`, { headers: hsHeaders, ...opts });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot ${opts.method || "GET"} ${path} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function sbList(prefix, limit = 500) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/prospekt-bilder`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`Supabase list ${prefix} -> ${res.status}`);
  return res.json();
}

const isImage = (n) => /\.(jpe?g|png|webp)$/i.test(n);
const isForside = (n) => /forside/i.test(n);

// «Cormate-24-Sportmate-7.jpg» → «007-Cormate-24-Sportmate-7.jpg» (numerisk-riktig sortering)
function padName(name) {
  if (/^\d{3}-/.test(name)) return name;
  const m = name.match(/-(\d+)\.(jpe?g|png|webp)$/i);
  if (!m) return name;
  return `${String(parseInt(m[1], 10)).padStart(3, "0")}-${name}`;
}

async function hsSubfolders(parentId) {
  const d = await hs(`/files/v3/folders/search?parentFolderId=${parentId}&limit=100`);
  return d.results || [];
}

async function hsFilesIn(folderIds) {
  if (!folderIds.length) return [];
  // NB: parentFolderIds tar IKKE kommaseparert liste — må gjentas som egne query-params.
  const qs = folderIds.map((id) => `parentFolderIds=${id}`).join("&");
  const d = await hs(`/files/v3/files/search?${qs}&limit=100`);
  let results = d.results || [];
  let after = d.paging?.next?.after;
  while (after) {
    const p = await hs(`/files/v3/files/search?${qs}&limit=100&after=${encodeURIComponent(after)}`);
    results = results.concat(p.results || []);
    after = p.paging?.next?.after;
  }
  return results;
}

async function ensureSubfolder(parentId, name, existing) {
  const hit = existing.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const created = await hs(`/files/v3/folders`, {
    method: "POST",
    body: JSON.stringify({ name, parentFolderId: String(parentId) }),
  });
  existing.push({ id: created.id, name });
  return created.id;
}

async function transferFile(sbPath, destFolderId, filename) {
  const src = `${SUPABASE_URL}/storage/v1/object/public/prospekt-bilder/${encodeURIComponent(sbPath).replace(/%2F/g, "/")}`;
  const imgRes = await fetch(src);
  if (!imgRes.ok) throw new Error(`Supabase GET ${sbPath} -> ${imgRes.status}`);
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/jpeg" }), filename);
  form.append("options", JSON.stringify({ access: "PUBLIC_NOT_INDEXABLE", overwrite: true }));
  form.append("folderId", String(destFolderId));
  const up = await fetch(`${HS}/files/v3/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${HUBSPOT_TOKEN}` },
    body: form,
  });
  if (!up.ok) throw new Error(`HubSpot upload ${filename} -> ${up.status}`);
  return up.json();
}

exports.handler = async () => {
  const summary = { boatsChecked: 0, boatsSynced: [], filesTransferred: 0, coversSet: [], errors: [] };
  let budget = MAX_FILES_PER_RUN;
  try {
    // 1) Aktive båter på nettsiden
    const search = await hs(`/crm/v3/objects/${BOATS}/search`, {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [{ filters: [
          { propertyName: "activated", operator: "EQ", value: "yes" },
          { propertyName: "status", operator: "EQ", value: "for-sale" },
          { propertyName: "gallery_folder_id", operator: "HAS_PROPERTY" },
        ] }],
        properties: ["boat_name", "gallery_folder_id", "gallery_images"],
        limit: 100,
      }),
    });

    for (const boat of search.results || []) {
      if (budget <= 0) break;
      summary.boatsChecked += 1;
      const p = boat.properties;
      const folderId = (p.gallery_folder_id || "").trim();
      if (!folderId) continue;
      try {
        // 2) Rask sti: har HubSpot-mappen allerede filer?
        const subs = await hsSubfolders(folderId);
        const hsFiles = await hsFilesIn([folderId, ...subs.map((s) => s.id)]);
        // VIKTIG: kun helt tomme gallerier synkes automatisk. Delvise avvik kan være
        // bevisst kuratering i Galleri-modulen (slettede/omorganiserte bilder) — logges bare.
        if (hsFiles.length > 0) continue;
        // 3) Finn B-deal → Supabase-filer
        const assoc = await hs(`/crm/v4/objects/${BOATS}/${boat.id}/associations/deals?limit=20`);
        const dealIds = (assoc.results || []).map((r) => String(r.toObjectId));
        let sbFiles = [];
        let dealId = null;
        for (const d of dealIds) {
          const top = await sbList(`${d}/`, 500);
          const entries = Array.isArray(top) ? top : [];
          const flat = entries.filter((f) => f.id && isImage(f.name)).map((f) => ({ sub: "Exterior", path: `${d}/${f.name}`, name: f.name }));
          const folders = entries.filter((f) => !f.id);
          for (const fo of folders) {
            const inner = await sbList(`${d}/${fo.name}/`, 500);
            for (const f of (Array.isArray(inner) ? inner : []).filter((x) => x.id && isImage(x.name))) {
              flat.push({ sub: fo.name, path: `${d}/${fo.name}/${f.name}`, name: f.name });
            }
          }
          if (flat.length) { sbFiles = flat; dealId = d; break; }
        }
        if (!sbFiles.length) continue;
        sbFiles = sbFiles.filter((f) => !isForside(f.name));
        // 4) Hva mangler?
        const have = new Set(hsFiles.map((f) => f.name.replace(/\.(jpe?g|png|webp)$/i, "")));
        const missing = sbFiles.filter((f) => {
          const target = padName(f.name).replace(/\.(jpe?g|png|webp)$/i, "");
          return !have.has(target) && !have.has(f.name.replace(/\.(jpe?g|png|webp)$/i, ""));
        });
        if (!missing.length) continue;

        let transferredFirstExterior = null;
        for (const f of missing) {
          if (budget <= 0) break;
          const destId = await ensureSubfolder(folderId, f.sub, subs);
          const uploaded = await transferFile(f.path, destId, padName(f.name));
          summary.filesTransferred += 1;
          budget -= 1;
          if (!transferredFirstExterior && f.sub.toLowerCase() === "exterior") transferredFirstExterior = uploaded.url;
        }
        summary.boatsSynced.push(`${p.boat_name} (${missing.length} manglet, deal ${dealId})`);

        // 6) Cover hvis tomt
        if (!(p.gallery_images || "").trim() && transferredFirstExterior) {
          await hs(`/crm/v3/objects/${BOATS}/${boat.id}`, {
            method: "PATCH",
            body: JSON.stringify({ properties: { gallery_images: transferredFirstExterior } }),
          });
          summary.coversSet.push(`${p.boat_name} — SJEKK COVERET (auto-valgt første bilde)`);
        }
      } catch (e) {
        summary.errors.push(`${p.boat_name}: ${e.message}`);
      }
    }
    console.log("gallery-sync:", JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (e) {
    console.error("gallery-sync feilet:", e.message);
    return { statusCode: 500, body: JSON.stringify({ error: e.message, ...summary }) };
  }
};
