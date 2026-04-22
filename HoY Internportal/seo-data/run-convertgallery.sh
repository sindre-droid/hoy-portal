#!/usr/bin/env bash
# Convert gallery_images from file IDs to URLs for all migrated records
API="https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate?action=convertgallery"

echo "=== Batch 1/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351388463314", "351388463320", "351388463328", "351388463332", "351414280403", "351414280404", "351414280405", "351414280406"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 2/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351414280409", "351414280411", "351414280413", "351414280417", "351414280421", "351417864402", "351417864405", "351417864409"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 3/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351417864416", "351417864418", "351419698418", "351419699394", "351419699407", "351443090620", "351443141848", "351443141850"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 4/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443141853", "351443141854", "351443141855", "351443141857", "351443141858", "351443141859", "351443141860", "351443171558"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 5/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443171573", "351443201214", "351443201217", "351443201218", "351443201219", "351443201223", "351443201226", "351443201227"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 6/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443201229", "351443213550", "351443213551", "351443213552", "351443213557", "351443213559", "351443214523", "351443214525"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 7/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443214526", "351443214531", "351443214533", "351443214553", "351443214562", "351443214565", "351443229923", "351443229926"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 8/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443229932", "351443229934", "351443262696", "351443262703", "351443262706", "351443263674", "351443280097", "351443280103"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 9/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443280105", "351443280112", "351443280113", "351443281089", "351443310785", "351443310788", "351443310789", "351443310790"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 10/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351443310792", "351443310794", "351443310796", "351443310797", "351443310800", "351443310801", "351445109976", "351446910167"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 11/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351446935756", "351456244949", "351456244950", "351456244952", "351456244953", "351456244957", "351456244965", "351459866833"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 12/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351459866843", "351459866845", "351475307748", "351475307751", "351475307758", "351475307763", "351475308730", "351475308733"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 13/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351475308734", "351479078074", "351479119064", "351479119072", "351479119073", "351479119074", "351479119078", "351481028808"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 14/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351481028816", "351481028825", "351481028826", "351481042110", "351481042121", "351481042122", "351481042124", "351481058525"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 15/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351482888417", "351482888418", "351482888420", "351482888423", "351482888424", "351482888426", "351482888434", "351482888435"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 16/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351482888436", "351482888439", "351482889402", "351482889405", "351482889406", "351482889410", "351482889412", "351482889416"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 17/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["351484704998", "351484705000", "351484705008", "351484705014", "351484705015", "351484705016", "351484720352", "426845536502"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 18/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["426858650822", "426858651847", "426885566710", "426911553726", "426912355563", "426915761383", "426917392592", "426918089973"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 19/20 (8) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["426918090963", "426918090997", "426918225110", "426918285527", "426918356217", "426918995167", "426919256254", "426919257299"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== Batch 20/20 (6) ==="
curl -sX POST "$API" -H "Content-Type: application/json" --data '{"hs_ids": ["426919392488", "426919613659", "426919683264", "426920004854", "426920254650", "426924272831"]}' | jq ".ok, .failed, .converted, .skipped"

echo "=== DONE ==="