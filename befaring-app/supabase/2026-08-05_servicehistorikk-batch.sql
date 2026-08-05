-- ── Servicehistorikk: batch-generering for store dokumentmengder ───────────
-- 2026-08-05. Anthropic har en hard 32 MB-grense per API-request (base64
-- blåser opp filene ~33 %), så generate-kallet feilet med 413 når mange
-- bilag var lastet opp. Analysen deles nå i flere runder (generate_batch)
-- med en sammenstilling til slutt (generate_final). Denne kolonnen lagrer
-- ekstraksjonsresultatene per runde:
--   { "hash": "<plan-fingeravtrykk>", "count": <antall runder>,
--     "results": { "0": { files, events, notes, input_tokens, ... }, ... } }

alter table service_history_runs
  add column if not exists ai_batches jsonb;

comment on column service_history_runs.ai_batches is
  'Batch-ekstraksjonsresultater fra generate_batch (hash, count, results per runde). Tømmes ikke automatisk — overskrives ved ny generering.';
