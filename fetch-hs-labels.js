#!/usr/bin/env node
// Run: HUBSPOT_TOKEN=pat-xxx node fetch-hs-labels.js
// Dumps all association labels for Deal→Contact and Boat→Contact

const TOKEN = process.env.HUBSPOT_TOKEN;
if (!TOKEN) { console.error('Set HUBSPOT_TOKEN env var'); process.exit(1); }

const BOAT_OBJ_TYPE = '2-145214665';

async function hs(path) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) { console.error('HubSpot error', res.status, JSON.stringify(data)); }
  return data;
}

async function main() {
  const [dealContact, boatContact] = await Promise.all([
    hs('/crm/v4/associations/deals/contacts/labels'),
    hs(`/crm/v4/associations/${BOAT_OBJ_TYPE}/contacts/labels`),
  ]);

  console.log('\n══════════════════════════════════════════════');
  console.log('  DEAL → CONTACT  labels');
  console.log('══════════════════════════════════════════════');
  for (const r of (dealContact.results || [])) {
    console.log(`  [${String(r.typeId).padStart(3)}]  ${r.category.padEnd(20)}  ${r.label || '(no label)'}`);
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`  BOAT (${BOAT_OBJ_TYPE}) → CONTACT  labels`);
  console.log('══════════════════════════════════════════════');
  for (const r of (boatContact.results || [])) {
    console.log(`  [${String(r.typeId).padStart(3)}]  ${r.category.padEnd(20)}  ${r.label || '(no label)'}`);
  }

  console.log('');
}

main().catch(console.error);
