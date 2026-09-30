-- Oppgjør v2e (30.9.2026, etter Sindres gjennomgang): sporbarhet på koblinger, gjeld-detaljer, mottakernavn
alter table klientkonto_transaksjon add column if not exists koblet_grunn text;   -- hvorfor transaksjonen ble koblet (automatisk: kriteriene; manuelt: hvem)
alter table oppgjor add column if not exists selger_konto_navn text;              -- kontoeier slik nettbanken krever (default selgers navn)
alter table oppgjor add column if not exists gjeld_bank_navn text;                -- panthaver
alter table oppgjor add column if not exists gjeld_saldo_dato date;               -- saldo for sletting gjelder per denne datoen — innfrielse må skje da
alter table oppgjor add column if not exists gjeld_referanse text;                -- KID / saksnr
