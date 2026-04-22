#!/usr/bin/env bash
# Runs 5 setname batches to clean up boat_name prefixes
set -e
API='https://silver-puffpuff-8a67de.netlify.app/.netlify/functions/wix-migrate?action=setname'

echo "=== Batch 1/5 (20 records) ==="
curl -sX POST "$API" -H 'Content-Type: application/json' --data @- <<'EOF' | jq '.ok, .failed'
{"boats": [{"hs_id": "351414280441", "boat_name": "Fjord Terne 28"}, {"hs_id": "351419699393", "boat_name": "Fjord Terne 28"}, {"hs_id": "351443089657", "boat_name": "Fjord Terne 28"}, {"hs_id": "351443141844", "boat_name": "Nimbus 230R"}, {"hs_id": "351443263682", "boat_name": "Nidelv 300 Sport"}, {"hs_id": "351443280098", "boat_name": "Hanse 430e"}, {"hs_id": "351443280099", "boat_name": "Enter 360 Explicit OD"}, {"hs_id": "351443280100", "boat_name": "Capelli Tempest 1000 Open"}, {"hs_id": "351443280102", "boat_name": "Beneteau Oceanis 473"}, {"hs_id": "351443280104", "boat_name": "Cormate SU23"}, {"hs_id": "351443280107", "boat_name": "Nordic star 32 Cruiser/ Dødsbo"}, {"hs_id": "351443280108", "boat_name": "Hanse 341"}, {"hs_id": "351443280110", "boat_name": "Jeanneau Cap Camerat 7,5 dc"}, {"hs_id": "351443280111", "boat_name": "Skilsø 33 Sport"}, {"hs_id": "351443280112", "boat_name": "Marex 360 CC"}, {"hs_id": "351443280113", "boat_name": "Riviera 925"}, {"hs_id": "351443280114", "boat_name": "Beneteau Oceanis Clipper 361"}, {"hs_id": "351456244954", "boat_name": "Goldfish 28 Tender 2x450"}, {"hs_id": "351456244956", "boat_name": "Najad 343"}, {"hs_id": "351456244959", "boat_name": "Cormate 23 SU"}]}
EOF

echo "=== Batch 2/5 (20 records) ==="
curl -sX POST "$API" -H 'Content-Type: application/json' --data @- <<'EOF' | jq '.ok, .failed'
{"boats": [{"hs_id": "351456244960", "boat_name": "Nimbus 380 Commander"}, {"hs_id": "351456244962", "boat_name": "Hanse 445"}, {"hs_id": "351475307739", "boat_name": "One Design Båtbygger Are Wiig"}, {"hs_id": "351475307740", "boat_name": "Hanse 315"}, {"hs_id": "351475307742", "boat_name": "Nimbus W9"}, {"hs_id": "351475307743", "boat_name": "Bavaria 36 AC"}, {"hs_id": "351475307746", "boat_name": "Hanse 430"}, {"hs_id": "351475307747", "boat_name": "Bavaria Vision 44"}, {"hs_id": "351475307748", "boat_name": "Brig Eagle 8 Hankø Edition"}, {"hs_id": "351475307749", "boat_name": "Elan GT5"}, {"hs_id": "351475307751", "boat_name": "Goldfish 30 Sport"}, {"hs_id": "351475307756", "boat_name": "Dehler 38"}, {"hs_id": "351475307758", "boat_name": "Grand Banks Eastbay 45 SX"}, {"hs_id": "351481028807", "boat_name": "Argo Furuholmen OD 33"}, {"hs_id": "351481028808", "boat_name": "1912 Anker & Jensen 9mR Flirt IV"}, {"hs_id": "351481028809", "boat_name": "Beneteau First 27 Seascape"}, {"hs_id": "351481028810", "boat_name": "Dufour Prestige 54"}, {"hs_id": "351481028811", "boat_name": "Fjord 40 Open"}, {"hs_id": "351481028812", "boat_name": "Windy 35 Khamsin"}, {"hs_id": "351481028813", "boat_name": "Chris Craft Speedster Heritage"}]}
EOF

echo "=== Batch 3/5 (20 records) ==="
curl -sX POST "$API" -H 'Content-Type: application/json' --data @- <<'EOF' | jq '.ok, .failed'
{"boats": [{"hs_id": "351481028814", "boat_name": "Gib'Sea 392"}, {"hs_id": "351481028816", "boat_name": "Bavaria 37 Crusier"}, {"hs_id": "351481028818", "boat_name": "Finngulf 39"}, {"hs_id": "351481028823", "boat_name": "Comet 45 Sport"}, {"hs_id": "351481028824", "boat_name": "Moody 45 DS"}, {"hs_id": "351481028826", "boat_name": "Nimbus C11"}, {"hs_id": "351481042111", "boat_name": "Jeanneau Sun Fast 36 - Chili Pepper"}, {"hs_id": "351481042114", "boat_name": "Hanse 388"}, {"hs_id": "351481042116", "boat_name": "Bavaria 41H"}, {"hs_id": "351481042117", "boat_name": "Bavaria 39 Cr"}, {"hs_id": "351481042119", "boat_name": "Fairline Targa 43"}, {"hs_id": "351481042121", "boat_name": "Goldfish 38 SuperSport"}, {"hs_id": "351481042123", "boat_name": "Dufour 455 Grand Large"}, {"hs_id": "351481042125", "boat_name": "Anker & Jensen 12mR Danseuse"}, {"hs_id": "351481042126", "boat_name": "Hydrolift X-26S-R"}, {"hs_id": "351481042127", "boat_name": "Sweden Yachts 41R"}, {"hs_id": "351481042129", "boat_name": "1946 Anker og Jensen 8mCr SY Christina"}, {"hs_id": "351482888437", "boat_name": "Viknes 1030 SB"}, {"hs_id": "351482888438", "boat_name": "Goldfish 28 Tender"}, {"hs_id": "351482888439", "boat_name": "1914 Anker & Jensen 8mR Carmen IV"}]}
EOF

echo "=== Batch 4/5 (11 records) ==="
curl -sX POST "$API" -H 'Content-Type: application/json' --data @- <<'EOF' | jq '.ok, .failed'
{"boats": [{"hs_id": "351482888441", "boat_name": "Nimbus 29 Nova"}, {"hs_id": "351482889402", "boat_name": "Fleming 58"}, {"hs_id": "351482889403", "boat_name": "Bavaria C45 Style"}, {"hs_id": "351482889404", "boat_name": "Bavaria 30 Sport"}, {"hs_id": "351482889405", "boat_name": "Beneteau MC5"}, {"hs_id": "351482889406", "boat_name": "Beneteau MC6S"}, {"hs_id": "351482889408", "boat_name": "Goldfish 23 Tender"}, {"hs_id": "351482889411", "boat_name": "Princess v55"}, {"hs_id": "351482889412", "boat_name": "Bavaria E34 Fly"}, {"hs_id": "351482889416", "boat_name": "Axopar 28 Cabin"}, {"hs_id": "351484705007", "boat_name": "Hallberg Rassy 43"}]}
EOF

echo "=== Batch 5/5 (5 spesialtilfeller) ==="
curl -sX POST "$API" -H 'Content-Type: application/json' --data @- <<'EOF' | jq '.ok, .failed'
{"boats": [{"hs_id": "351443201219", "boat_name": "Nordic Oceancraft CAT 50"}, {"hs_id": "351479077104", "boat_name": "Baltic 52 Custom"}, {"hs_id": "351482911940", "boat_name": "Hanse 388"}, {"hs_id": "351456244961", "boat_name": "Bavaria 38 Cruiser"}, {"hs_id": "351481042120", "boat_name": "Bavaria 44 AC"}]}
EOF

echo "=== DONE ==="
