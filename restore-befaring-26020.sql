-- Gjenopprett befaringsdata for 26020 - Stormway F-26
-- Lim inn i Supabase Query Editor og kjør

INSERT INTO befaring_drafts (deal_id, data, updated_at)
VALUES (
  '498914840802',
  '{
    "isSailboat": false,
    "motorCount": 1,
    "hasGenerator": false,
    "isOnLand": true,
    "saved_at": "2026-04-16T08:08:48.632Z",
    "condState": {
      "skrog": {
        "score": 3,
        "comment": "Dekk ok. Skrog litt matt, men ok. Akterspeil matt. Stolteste korrodert",
        "flag": false,
        "photoUrls": [
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326318574.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326338646.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326532235.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326540463.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326548800.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326556309.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_skrog_1776326565478.jpg"
        ]
      },
      "undervann": {
        "score": 4,
        "comment": "Ser skadefritt ut, men litt ruglete grunnet gamle bunnstoffrester",
        "flag": false,
        "photoUrls": [
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_undervann_1776326440238.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_undervann_1776326449969.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_undervann_1776326471830.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_undervann_1776326489908.jpg"
        ]
      },
      "styring": {
        "score": 4,
        "comment": "Virker greit. Litt dødgang i ratt, føles innenfor normalen med båt på land",
        "flag": false,
        "photoUrls": []
      },
      "interior": {
        "score": 3,
        "comment": "Skittent men greit. Vanskelig å vurdere før vask.",
        "flag": false,
        "photoUrls": [
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_interior_1776326672309.jpg"
        ]
      },
      "elektrisk": {
        "score": null,
        "comment": "",
        "flag": false,
        "photoUrls": []
      },
      "vvs": {
        "score": 4,
        "comment": "Ser bra ut.",
        "flag": false,
        "photoUrls": []
      },
      "motor": {
        "score": 3,
        "comment": "Ser ok ut for alderen. Ligger noe væske nederst som burde vært drenert før opplag. Ser ut som vann.",
        "flag": false,
        "photoUrls": [
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_motor_1776326789323.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_motor_1776326823377.jpg",
          "https://26753504.fs1.hubspotusercontent-eu1.net/hubfs/26753504/befaringsrapporter/befaring_motor_1776326859073.jpg"
        ]
      }
    },
    "fields": {}
  }'::jsonb,
  NOW()
)
ON CONFLICT (deal_id) DO UPDATE
  SET data = EXCLUDED.data, updated_at = NOW();
