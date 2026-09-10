#!/usr/bin/env python3
# HoY 1-3-5-årsplan v11 — cash-proxy-caveat (rådgiver) + Q1-ansettelsesgate + bufferregel.
# HoY 1-3-5-årsplan v4 — etter rådgiver-runde 3 (27.08.2026):
#  - LES MEG-ark i klartekst (Sindre skal forstå hvert tall)
#  - Behov for målet løses SELVKONSISTENT (tre kostregimer — ikke lenger for lav kostbase)
#  - Kostbase i kapasitetsdelen bruker GJENNOMSNITTLIG bemanning (terskler på årets slutt)
#  - Kvartalsmål 2027 (rampen synlig per kvartal)
#  - Kohortnote rettet (1,16, ikke 1,25); 75/85-definisjon presisert; 17 hele uker igjen av H2
# Tidligere (v3):
#  1) Charter holdt HELT utenfor motoren; fasit = oppgjørslistene (ikke HubSpot-amount)
#  2) Kohortanalyse signert→solgt bygget (HubSpot B-deals); oppdrag/salg = 1,30 PLANANTAKELSE (kohort modne: 1,38)
#  3) 68 % merket PROXY overalt (Pipeline A-vinnrate, ikke befaring→signering)
#  4) Trinnvis kostbase per bemanningsnivå (grunn + per stol + leder ≥5 + backoffice ≥8)
#  5) Kvartalsvis rekrutterings- og rampemodell → kapasitets-P&L med GAP mot mål
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()
F = "Arial"
BLUE = Font(name=F, size=10, color="0000FF")
BLUEB = Font(name=F, size=10, color="0000FF", bold=True)
BLACK = Font(name=F, size=10)
BLACKB = Font(name=F, size=10, bold=True)
GREEN = Font(name=F, size=10, color="008000")
GREY = Font(name=F, size=9, color="666666", italic=True)
RED = Font(name=F, size=10, color="C00000", bold=True)
WHITEB = Font(name=F, size=11, color="FFFFFF", bold=True)
TITLE = Font(name=F, size=14, bold=True, color="1F3D2E")
HDR_FILL = PatternFill("solid", fgColor="1F3D2E")
SEC_FILL = PatternFill("solid", fgColor="DCE6DD")
YEL_FILL = PatternFill("solid", fgColor="FFFF00")
THIN = Side(style="thin", color="BBBBBB")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
NOK = '#,##0;(#,##0);-'
PCT = '0.0%'
PCT2 = '0.00%'
DES1 = '0.0'
DES2 = '0.00'
INT = '0'

def hdr_row(ws, row, labels, start=1):
    for i, h in enumerate(labels, start=start):
        c = ws.cell(row=row, column=i, value=h)
        c.font = WHITEB; c.fill = HDR_FILL
        c.alignment = Alignment(horizontal="center", wrap_text=True)

def sec(ws, row, text, ncols=6):
    ws.cell(row=row, column=1, value=text).font = BLACKB
    for col in range(1, ncols+1):
        ws.cell(row=row, column=col).fill = SEC_FILL

# ================= FORUTSETNINGER =================
fs = wb.active
fs.title = "Forutsetninger"
fs.sheet_view.showGridLines = False
fs.column_dimensions['A'].width = 46
fs.column_dimensions['B'].width = 13
fs.column_dimensions['C'].width = 95
fs['A1'] = "FORUTSETNINGER — én datadefinisjon per KPI"
fs['A1'].font = TITLE
fs['A2'] = "Gule celler = juster fritt (alt rekalkulerer). FASIT = oppgjørslistene («lønn solgte båter»), ikke HubSpot. Oppdatert 26.08.2026."
fs['A2'].font = GREY

rows = [
    ("FASIT SALG — kilde: oppgjørslister 2025+2026, solgt-dato 27.08.2025–26.08.2026, EX CHARTER", None, None, None, False),
    ("Inntekt per solgt båt, ex mva (MOTOR-INPUT)", 58375, NOK, "DEF: sum omsetning ex mva 4 378 153 / 75 båtsalg i oppgjørslistene siste 12 mnd. Median 50 400. Alle 75 har beløp (fasit — ikke HubSpot-amount, som manglet 4 deals og ga 64 100). Charter (170k) holdt HELT utenfor.", True),
    ("Snittbåtverdi (salgssum) — informativ", 1260458, NOK, "DEF: snitt salgssum i oppgjørslistene, 75/75 deals. Median 1 065 000. Brukes IKKE i motoren.", False),
    ("Provisjonsgrad 1: standard avtalt", 0.06, PCT2, "DEF: 6,00 % av salgssum INKL mva, min. 45 000 inkl mva (= 36 000 ex). Kontraktsstandard.", False),
    ("Provisjonsgrad 2: målt effektiv (fasit, alle 75)", 0.0579, PCT2, "DEF: sum(oms ex mva × 1,25) / sum(salgssum) = 5,79 % inkl mva (4,63 % ex). Teller og nevner er nå SAMME utvalg (75/75) — kontrolltallet fra v2 er dermed identisk og trengs ikke lenger. Gap til 6 % = rabatter/min.honorar.", False),
    ("Charter — holdes utenfor motoren", 170000, NOK, "1 charteroppdrag siste 12 mnd (AD Astra, 170 000 ex mva). Egen produksjonsenhet; regnes IKKE i inntekt per båt, båter/år eller stol-kapasitet.", False),
    ("", None, None, None, False),
    ("STOL-DEFINISJONER OG KAPASITET", None, None, None, False),
    ("DEF «stol»", None, None, "Én fullt produktiv megler ETTER ramp (6–9 mnd). Sindre er ALLTID egen stol utenom. «Producing FTE» = effektiv produksjonskapasitet i året (ramp-vektet, desimal). «Bemannet» = personer på lønn. Buffer-stol = planlagt tom (rekrutteringspipeline).", False),
    ("Omsetning per producing megler-stol (plantall)", 1500000, NOK, "PRODUKSJONSMÅL for rampet stol. Fasit siste 12 mnd KREDITERT (50/50 v/samarbeid — det lønna følger): Henrik 1 838 820, Sindre 1 491 253, Daniel 882 480. Solgt av: Henrik 2 007 420 (35 båter) — han lukker også andres oppdrag.", True),
    ("Sindre-stolens omsetning per år (plantall)", 2300000, NOK, "CFO-anbefalt mål ~2,28M. Fasit siste 12 mnd kreditert: 1 491 253 (2025: 2 083 205) — inkl. lederrolle; han HENTET oppdrag for langt mer (2,5M inn i 2025).", True),
    ("Break-even per ny stol (egne kostnader)", None, NOK, "FORMEL: løpende trinnkost ÷ megler-marginal (1−0,55−markedskost-rate) ≈ 200k omsetning dekker stolens EGNE kostnader. Å dekke en ANDEL av felles faste krever ~1,2–1,7M (jf. «Lønnsomhet per megler» i kostnadsmodellen) — det er Sindres poeng om når en megler begynner å tjene penger.", False),
    ("Churn-buffer (stoler planlagt tomme)", 1, INT, "Ditt valg: planlegg alltid som om én stol står tom (Daniel-effekten).", True),
    ("Megler-stoler bemannet i dag (utenom Sindre)", 1, INT, "Henrik (+Marte som assistent). Daniel slutter → telles ikke.", True),
    ("", None, None, None, False),
    ("RAMP-PROFIL FOR NYANSATT MEGLER (PLANANTAKELSE)", None, None, None, False),
    ("Produksjon måned 1–3 (andel av full stol)", 0.40, PCT, "EMPIRI (begge startet mars/apr 2025): Henrik solgte 1 963k i år 1 (2,35M-rate), Daniel 570k (0,76M-rate) — snitt ≈ full stol, men enorm spredning. 40/75/100 ligger bevisst under snittet av n=2.", True),
    ("Produksjon måned 4–6", 0.75, PCT, "Egen portefølje bygges. Median salgstid 89 dg → første oppgjør kommer ~3 mnd etter første oppdrag.", True),
    ("Produksjon måned 7–12", 1.00, PCT, "Fullt producing fra ~mnd 7. Henrik beviste at det er mulig; churn-bufferen tar høyde for en Daniel-profil.", True),
    ("", None, None, None, False),
    ("TRINNVIS KOSTBASE (PLANANTAKELSE — juster mot egne tall)", None, None, None, False),
    ("Grunnkostbase per år (dekker inntil 2 megler-stoler)", 1880000, NOK, "DEF: kostbase fullastet 2,54M (kostnadsmodell jun 2026) minus markedskost-andelen. Inkl. Marte, Philip, avskrivning 228k, kontor, systemer — dagens nivå.", True),
    ("Løpende tilleggskost per bemannet stol utover 2", 60000, NOK, "FASIT-BASERT (kostnadsbudsjett 2026): parkering ~18k + CRM/lisenser ~30k + telefon/forsikring ~12k per hode. Kontor koster INGENTING før stol nr. 6 (plass på dagens kontor).", True),
    ("Engangs rekrutterings-/onboardingkost per nyansettelse", 75000, NOK, "PLANANTAKELSE: annonsering, intervjutid, utstyr, opplæring — belastes ansettelsesåret.", True),
    ("Kontorutvidelse fra ≥6 bemannede stoler", 300000, NOK, "PLASSHOLDER — dagens kontor har plass til ~5. Sjekk leieavtalen for faktisk kostnad ved utvidelse.", True),
    ("Salgsleder/daglig-leder-kapasitet fra ≥5 stoler", 900000, NOK, "PLANANTAKELSE: ved 5+ meglere kan ikke Sindre både selge 2,3M og lede alene.", True),
    ("Ekstra backoffice/administrasjon fra ≥8 stoler", 500000, NOK, "PLANANTAKELSE: kundeservice, oppgjør, kontor.", True),
    ("Markedskost per signert oppdrag inn", 6600, NOK, "DEF: målt snitt per SIGNERT oppdrag. CFO-mål: 4 552 + 15k-tak håndheves.", True),
    ("", None, None, None, False),
    ("MEGLERKOST OG SINDRE-LØNN", None, None, None, False),
    ("Meglerkost, fullastet andel av megler-omsetning", 0.55, PCT, "DEF: meglerprovisjon (40 %) + AGA + feriepenger ≈ 55 øre per megler-omsetningskrone.", True),
    ("Grunnbeløpet G (per 1.5.2026)", 136549, NOK, "Kilde: nav.no/grunnbelopet. Oppdateres hver mai.", True),
    ("Sindres lønnstak (7,1G)", None, NOK, "DEF: 7,1G = taket for pensjonsopptjening i folketrygden — over dette lønner utbytte seg. Pensjonsgivende inntekt inkluderer feriepenger.", False),
    ("Sindres provisjonssats", 0.45, PCT, "45 % av egen omsetning ex mva (før tak).", True),
    ("Lønns-loading (AGA + feriepenger)", 1.165, '0.000', "For Sindre: AGA/OTP-påslag. 7,1G-taket antas å INKLUDERE feriepenger (12 %, ikke 10,2) → grunnlønn ≈ 865 623 + 12 % FP = 969 498. MARIUS BEKREFTER inkl/eks-tolkningen; eks-tolkning koster ~115k mer.", True),
    ("", None, None, None, False),
    ("TRAKT — kilder: kohortanalyse (Historikk) + HubSpot Pipeline A per 26.08.2026", None, None, None, False),
    ("Signerte oppdrag inn per solgt båt (PLANANTAKELSE)", 1.30, DES2, "KOHORTMÅLT på modne oppdrag (>365 dg, n=58): 72 % solgt → 58/42 = 1,38 oppdrag/salg; hvis alle 8 åpne til slutt selges: 58/50 = 1,16. 1,30 = planantakelse mellom. v2-tallet 1,15 forkastet (samtidighetsfeil, jf. rådgiver).", True),
    ("Vinnrate Pipeline A — PROXY for befaring→signering", 0.68, PCT, "PROXY, IKKE målt close rate befaring→signering! DEF: 67 vunnet / 99 avgjorte deals i Pipeline A siste 12 mnd (hele trakten, prospect→signert). Isolert befaring→signering krever stage-historikk — mangler (mål: 90 %).", True),
    ("Prospect → befaring-rate (plantall)", 0.50, PCT, "Målt per megler (CFO-analyse): Sindre 74 %, Daniel 52 %, Henrik+Marte 28 %.", True),
    ("Arbeidsuker per år", 46, INT, "Ferie/helligdager trukket fra.", True),
    ("", None, None, None, False),
    ("SCORECARD-PARAMETRE (H2 2026)", None, None, None, False),
    ("H2-2026-mål omsetning ex mva (uten Daniel)", 2900000, NOK, "Fra revidert H2-plan aug 2026.", True),
    ("H2 levert hittil ex mva (fasit, per 26.08)", 626060, NOK, "Oppgjørsliste 2026: juli 392 960 + august 233 100. Oppdater ukentlig.", True),
    ("Hele uker igjen av H2 2026", 17, INT, "ISO-uke 36–52 = 17 hele uker (i dag er uke 35 — inneværende deluke telles IKKE). Reduser med 1 hver mandag.", True),
    ("", None, None, None, False),
    ("MANGLER – MÅ MÅLES", None, None, None, False),
    ("Befaring → signering isolert (mål 90 %)", None, None, "Krever stage-historikk i Pipeline A — sett opp HubSpot-rapport. Største traktehull.", False),
    ("Presise signerings-/salgsdatoer til kohorten", None, None, "B-deal createdate er proxy for signeringsdato; closedate delvis bulk-satt. Supabase oppdrag_livslop (433 rader) kan gi presise datoer.", False),
    ("Henvendelse → befaring per kilde", None, None, "FINN / nettside / referral / FSBO. Lead source må fylles konsekvent.", False),
    ("FSBO-/outreach-aktivitet per megler per uke", None, None, "Logges ikke i dag — inn i scorecardet.", False),
    ("Faktiske trinnkostnader ved vekst", None, None, "150k/stol, 900k leder, 500k backoffice er PLANANTAKELSER — kalibrer mot tilbud/regnskap før 3/5-års bemanning låses.", False),
]
r = 4
param = {}
for label, val, fmt, src, edit in rows:
    if label == "":
        r += 1; continue
    if val is None and fmt is None and src is None:
        fs.cell(row=r, column=1, value=label).font = WHITEB
        for c in range(1, 4):
            fs.cell(row=r, column=c).fill = HDR_FILL
        r += 1; continue
    fs.cell(row=r, column=1, value=label).font = BLACK
    if val is not None:
        vc = fs.cell(row=r, column=2, value=val)
        vc.font = BLUE if edit else BLACK
        if fmt: vc.number_format = fmt
        if edit: vc.fill = YEL_FILL
    if src:
        c = fs.cell(row=r, column=3, value=src)
        c.font = GREY
        c.alignment = Alignment(wrap_text=True, vertical="top")
    param[label] = f"$B${r}"
    r += 1

g_ref = param["Grunnbeløpet G (per 1.5.2026)"]
c71 = fs[param["Sindres lønnstak (7,1G)"].replace('$','')]
c71.value = f"=7.1*{g_ref}"
c71.font = BLACKB
c71.number_format = NOK

P = lambda k: f"Forutsetninger!{param[k]}"
p_innt  = P("Inntekt per solgt båt, ex mva (MOTOR-INPUT)")
p_stol  = P("Omsetning per producing megler-stol (plantall)")
p_sindre= P("Sindre-stolens omsetning per år (plantall)")
p_buffer= P("Churn-buffer (stoler planlagt tomme)")
p_idag  = P("Megler-stoler bemannet i dag (utenom Sindre)")
p_r1    = P("Produksjon måned 1–3 (andel av full stol)")
p_r2    = P("Produksjon måned 4–6")
p_r3    = P("Produksjon måned 7–12")
p_grunn = P("Grunnkostbase per år (dekker inntil 2 megler-stoler)")
p_trinn = P("Løpende tilleggskost per bemannet stol utover 2")
p_rekr  = P("Engangs rekrutterings-/onboardingkost per nyansettelse")
p_kontor= P("Kontorutvidelse fra ≥6 bemannede stoler")
p_leder = P("Salgsleder/daglig-leder-kapasitet fra ≥5 stoler")
p_back  = P("Ekstra backoffice/administrasjon fra ≥8 stoler")
p_mk    = P("Markedskost per signert oppdrag inn")
p_mkost = P("Meglerkost, fullastet andel av megler-omsetning")
p_71g   = P("Sindres lønnstak (7,1G)")
p_sats  = P("Sindres provisjonssats")
p_load  = P("Lønns-loading (AGA + feriepenger)")
p_ratio = P("Signerte oppdrag inn per solgt båt (PLANANTAKELSE)")
p_close = P("Vinnrate Pipeline A — PROXY for befaring→signering")
p_pros  = P("Prospect → befaring-rate (plantall)")
p_uker  = P("Arbeidsuker per år")
p_h2mal = P("H2-2026-mål omsetning ex mva (uten Daniel)")
p_h2lev = P("H2 levert hittil ex mva (fasit, per 26.08)")
p_h2uker= P("Hele uker igjen av H2 2026")

# Break-even per ny stol (egne kostnader) — formel i Forutsetninger
_be = fs[param["Break-even per ny stol (egne kostnader)"].replace('$','')]
_be.value = (f"={param['Løpende tilleggskost per bemannet stol utover 2']}/"
             f"(1-{param['Meglerkost, fullastet andel av megler-omsetning']}-"
             f"{param['Markedskost per signert oppdrag inn']}*{param['Signerte oppdrag inn per solgt båt (PLANANTAKELSE)']}/"
             f"{param['Inntekt per solgt båt, ex mva (MOTOR-INPUT)']})")
_be.font = BLACKB
_be.number_format = NOK

# ================= HISTORIKK =================
hi = wb.create_sheet("Historikk", 0)
hi.sheet_view.showGridLines = False
hi.column_dimensions['A'].width = 46
for col in "BCDEFGH":
    hi.column_dimensions[col].width = 11
hi.column_dimensions['C'].width = 11
hi['A1'] = "HISTORIKK — fasit, kohort og resultatbro"
hi['A1'].font = TITLE
hi['A2'] = "Alt her er MÅLT (oppgjørslister/regnskap/HubSpot) — ingen mål eller antakelser. Charter holdt utenfor båt-tallene."
hi['A2'].font = GREY

sec(hi, 4, "FASIT SISTE 12 MND (oppgjørslister, 27.08.2025–26.08.2026, ex charter)", 8)
hist = [
    ("Båter solgt", 75, INT, ""),
    ("Omsetning ex mva (provisjon)", 4378153, NOK, "alle 75 med beløp — fasit, ikke HubSpot"),
    ("Snitt / median per båt", 58375, NOK, "median 50 400"),
    ("Snitt / median salgssum", 1260458, NOK, "median 1 065 000; eff. provisjonsgrad 5,79 % inkl mva"),
    ("Charter (egen enhet, utenfor motoren)", 170000, NOK, "1 oppdrag (AD Astra)"),
]
r = 5
for label, v, fmt, note in hist:
    hi.cell(row=r, column=1, value=label).font = BLACK
    c = hi.cell(row=r, column=2, value=v); c.number_format = fmt; c.font = BLACKB
    hi.cell(row=r, column=3, value=note).font = GREY
    r += 1

sec(hi, 11, "PER MEGLER — TRE MÅTER Å TELLE (alle fra oppgjørslistene)", 8)
hi['A12'] = "OPPDRAG INN = hvem hentet oppdraget · SOLGT AV = hvem lukket salget · KREDITERT = 50/50-splitt ved samarbeid — det lønna følger, og det stol-tallene i modellen bruker."
hi['A12'].font = GREY
hdr_row(hi, 13, ["Megler", "Kreditert 12 mnd", "Solgt av 12 mnd", "Kreditert 2025", "Solgt av 2025", "Oppdrag inn 2025"])
per = [("Henrik (+Marte)", 1838820, 2007420, 1599192, 1962912, 1156272),
       ("Sindre", 1491253, 1309453, 2083205, 1597805, 2532605),
       ("Daniel (slutter)", 882480, 953280, 532320, 570000, 494640),
       ("Jeanette (sluttet)", 165600, 108000, 642800, 726800, 674000)]
r = 14
for row_ in per:
    for i, v in enumerate(row_, start=1):
        c = hi.cell(row=r, column=i, value=v)
        c.font = BLACK
        if i > 1: c.number_format = NOK
        c.border = BOX
    r += 1
hi.cell(row=r, column=1, value="Sum").font = BLACKB
for i in range(2, 7):
    c = hi.cell(row=r, column=i, value=f"=SUM({chr(64+i)}14:{chr(64+i)}17)")
    c.number_format = NOK; c.font = BLACKB
hi['A19'] = "Sindre er ANSKAFFELSESMOTOREN (2,5M i oppdrag inn 2025), Henrik er LUKKEMOTOREN (2,0M solgt av) — ~630k av Henriks salg i 2025 var Sindres oppdrag (delt 50/50 i oppgjøret)."
hi['A19'].font = GREY
hi['A20'] = "RAMP-EMPIRI: Henrik startet mars 2025 → år 1 KREDITERT 1 599 192 (1,9M-rate, delvis ved å lukke Sindres oppdrag). Daniel startet april 2025 → år 1 kreditert 532 320 (0,71M-rate)."
hi['A20'].font = BLACK
hi['A21'] = "→ Ramp er PERSONDREVET, ikke tidsdrevet — og kan AKSELERERES ved at Sindre mater nye meglere med oppdrag, slik Henrik fikk i 2025. Snitt år 1-rate ≈ 1,3M kreditert (n=2, enorm spredning); churn-bufferen dekker Daniel-utfallet."
hi['A21'].font = GREY

sec(hi, 23, "KOHORT: SIGNERT OPPDRAG → SOLGT (HubSpot Pipeline B, 163 oppdrag siden sep 2024)", 8)
hi['A24'] = "B-deal opprettet = PROXY for signeringsdato. Closedate delvis bulk-satt (noen umulige salgstider) → indikativt."
hi['A24'].font = GREY
hdr_row(hi, 25, ["Signert kvartal", "n", "Solgt", "Tapt", "Åpne", "Solgt ≤90 dg", "Solgt ≤180 dg", "Median dager"])
coh = [("2025-Q1",11,11,0,0,4,8,106),("2025-Q2",32,20,8,4,9,16,95),("2025-Q3",25,18,0,7,6,9,189),
       ("2025-Q4",11,5,5,1,1,4,143),("2026-Q1",18,9,1,8,4,9,116),("2026-Q2",49,19,2,28,17,19,47),
       ("2026-Q3",16,2,0,14,2,2,"(datofeil)")]
r = 26
for row_ in coh:
    for i, v in enumerate(row_, start=1):
        c = hi.cell(row=r, column=i, value=v)
        c.font = BLACK
        c.alignment = Alignment(horizontal="center" if i > 1 else "left")
        c.border = BOX
    r += 1
kon = [
    ("MODNE kohorter (signert >365 dg siden, n=58)", "72 % solgt · 14 % tapt · 14 % fortsatt åpne"),
    ("→ Signerte oppdrag per salg (modne)", "58/42 = 1,38 (hvis alle 8 åpne selges: 58/50 = 1,16)"),
    ("Salgstid (85 solgte av 163 oppdrag sep-24→nå)", "median 89 dg · snitt 123 dg · 51 % ≤90 · 79 % ≤180. NB: annen kilde/periode (HubSpot, 24 mnd) enn fasitens 75 siste 12 mnd"),
]
r = 34
for a, b_ in kon:
    hi.cell(row=r, column=1, value=a).font = BLACKB
    hi.cell(row=r, column=2, value=b_).font = BLACK
    r += 1

sec(hi, 38, "PIPELINE A — OPPDRAG INN (HubSpot, siste 12 mnd per 26.08.2026)", 8)
pa = [("Nye prospects (deals opprettet)", 133), ("Signert oppdragsavtale (Vunnet)", 67),
      ("Tapt", 32), ("Fortsatt åpne", 34), ("Vinnrate av avgjorte (67/99) — PROXY", 0.68)]
r = 39
for a, v in pa:
    hi.cell(row=r, column=1, value=a).font = BLACK
    c = hi.cell(row=r, column=2, value=v); c.font = BLACKB
    if v == 0.68: c.number_format = PCT
    r += 1
hi['C43'] = "Prospect→befaring per megler (CFO-analyse): Sindre 74 % · Daniel 52 % · Henrik+Marte 28 %"
hi['C43'].font = GREY

sec(hi, 45, "RESULTATBRO 2025 — fra regnskap til modell (avstem «rest» med Marius)", 8)
bro = [
    ("Sum driftsinntekter, årsregnskap 2025", 6174978, "Endelig årsregnskap, signert 16.06.26"),
    ("Omsetning oppgjørsbasis ex mva 2025", 4857517, "Oppgjørslisten 2025"),
    ("Differanse inntektssiden", "=B46-B47", "forklares delvis under:"),
    ("  herav engangs «rydding»-inntekt (3900)", 200000, "ca-beløp"),
    ("  herav Serotonic-gjennomstrømming", 412000, "inntekt m/motsvarende kostnad, netto ~0"),
    ("  herav rest — MÅ AVSTEMMES", "=B48-B49-B50", "periodisering 3090, mva-føring, annet — Marius (RVT)"),
    ("Resultat før skatt 2025, regnskap", 736978, "løftet av underuttak Sindre + engangsposter"),
    ("Modellert fullastet resultat siste 12 mnd", "=Økonomimotor!B28", "negativt: fasit-omsetningen er under dagens break-even"),
]
r = 46
for label, v, note in bro:
    hi.cell(row=r, column=1, value=label).font = BLACKB if not label.startswith(" ") else BLACK
    c = hi.cell(row=r, column=2, value=v); c.number_format = NOK
    c.font = BLACKB if not label.startswith(" ") else BLACK
    hi.cell(row=r, column=3, value=note).font = GREY
    r += 1

# ================= ØKONOMIMOTOR =================
mo = wb.create_sheet("Økonomimotor", 1)
mo.sheet_view.showGridLines = False
for col, w in zip("ABCDE", [56, 15, 14, 14, 14]):
    mo.column_dimensions[col].width = w
mo['A1'] = "ØKONOMIMOTOR — bemanning → kapasitet → resultat, mot målet"
mo['A1'].font = TITLE
mo['A2'] = "v3: motoren regner nå BEGGE veier. Ned: planlagt bemanning (m/ramp) → kapasitet → P&L → resultat → GAP mot mål."
mo['A2'].font = GREY
mo['A3'] = "Referanse nederst: hvilken omsetning målet KREVER (med samme trinnvise kostbase)."
mo['A3'].font = GREY

hdr_row(mo, 5, ["", "Målt siste 12 mnd", "År 1 (2027)", "År 3 (2029)", "År 5 (2031)"])

def mline(ws, row, label, malt, f, fmt=NOK, bold=False, inp=False, red=False):
    ws.cell(row=row, column=1, value=label).font = BLACKB if bold else BLACK
    if malt is not None:
        c = ws.cell(row=row, column=2, value=malt)
        c.number_format = fmt; c.font = BLACKB if bold else BLACK
        c.alignment = Alignment(horizontal="right"); c.border = BOX
    for col in "CDE":
        c = ws[f"{col}{row}"]
        c.value = f(col) if callable(f) else f
        c.number_format = fmt
        c.alignment = Alignment(horizontal="right"); c.border = BOX
        if inp:
            c.font = BLUEB; c.fill = YEL_FILL
        elif red:
            c.font = RED
        else:
            c.font = BLACKB if bold else BLACK

sec(mo, 6, "INPUT", 5)
mline(mo, 7, "Resultatmål før skatt  [målt = regnskap 2025]", 736978, lambda c: {"C":1500000,"D":3000000,"E":5000000}[c], bold=True, inp=True)
mline(mo, 8, "Sindre-stolens omsetning", 1491253, f"={p_sindre}")
for col in "CDE": mo[f"{col}8"].font = GREEN

sec(mo, 9, "BEMANNINGSPLAN (PLANANTAKELSE — juster og se resultatet endre seg)", 5)
mline(mo, 10, "Rampede megler-stoler ved årets start", 1, lambda c: {"C":2,"D":6,"E":9}[c], fmt=INT, inp=True)
mline(mo, 11, "Nyansettelser Q1 (fra kvartalets start)", 0, lambda c: {"C":1,"D":1,"E":1}[c], fmt=INT, inp=True)
mline(mo, 12, "Nyansettelser Q2", 0, lambda c: {"C":1,"D":1,"E":1}[c], fmt=INT, inp=True)
mline(mo, 13, "Nyansettelser Q3", 0, lambda c: {"C":1,"D":0,"E":0}[c], fmt=INT, inp=True)
mline(mo, 14, "Nyansettelser Q4", 0, lambda c: {"C":0,"D":0,"E":0}[c], fmt=INT, inp=True)
W1 = f"((3*{p_r1}+3*{p_r2}+6*{p_r3})/12)"
W2 = f"((3*{p_r1}+3*{p_r2}+3*{p_r3})/12)"
W3 = f"((3*{p_r1}+3*{p_r2})/12)"
W4 = f"((3*{p_r1})/12)"
mline(mo, 15, "EFFEKTIVE producing megler-FTE i året (ramp-vektet)", 1,
      lambda c: f"={c}10+{c}11*{W1}+{c}12*{W2}+{c}13*{W3}+{c}14*{W4}", fmt=DES2, bold=True)
mline(mo, 16, "MEGLER-STOLER bemannet ved årets slutt", 1, lambda c: f"={c}10+SUM({c}11:{c}14)", fmt=INT, bold=True)
mline(mo, 17, "Gjennomsnittlig bemannede stoler i året", 1,
      lambda c: f"={c}10+{c}11*1+{c}12*0.75+{c}13*0.5+{c}14*0.25", fmt=DES2)
mo['A17'].value = "Gjennomsnittlig bemannede stoler i året (Q1-ansatt teller 100 %, Q2 75 %, Q3 50 %, Q4 25 %)"

sec(mo, 18, "TRINNVIS KOSTBASE (fasit-basert: 60k/stol + 75k engangs per ansettelse + terskler 5/6/8 på årets slutt)", 5)
kost = lambda c: (f"={p_grunn}+MAX(0,{c}17-2)*{p_trinn}+SUM({c}11:{c}14)*{p_rekr}"
                  f"+IF({c}16>=5,{p_leder},0)+IF({c}16>=6,{p_kontor},0)+IF({c}16>=8,{p_back},0)")
mline(mo, 19, "Kostbase i året, ekskl. markedskost", "=" + kost('B')[1:], kost, bold=True)

sec(mo, 20, "KAPASITET → RESULTAT (P&L på planlagt bemanning)", 5)
mline(mo, 21, "Kapasitets-omsetning ex mva (FTE × stol + Sindre)", 4378153, lambda c: f"={c}15*{p_stol}+{c}8", bold=True)
mline(mo, 22, "Båter solgt (omsetning ÷ inntekt per båt)", 75, lambda c: f"={c}21/{p_innt}", fmt=INT)
mline(mo, 23, "Signerte oppdrag inn (båter × 1,30 — planantakelse)", 67, lambda c: f"={c}22*{p_ratio}", fmt=INT)
komp = lambda col: f"MIN({p_sats}*{col}8,{p_71g})*{p_load}"
mline(mo, 24, "− Meglerkost inkl. AGA/feriepenger (55 % av megler-oms)", f"=-{p_mkost}*(B21-B8)", lambda c: f"=-{p_mkost}*({c}21-{c}8)")
mline(mo, 25, "− Sindre-kompensasjon (min av 45 % og 7,1G, loaded)", f"=-{komp('B')}", lambda c: f"=-{komp(c)}")
mline(mo, 26, "− Markedskost (per signert oppdrag × oppdrag inn)", f"=-{p_mk}*B23", lambda c: f"=-{p_mk}*{c}23")
mline(mo, 27, "− Kostbase (trinnvis, rad 19)", "=-B19", lambda c: f"=-{c}19")
mline(mo, 28, "RESULTAT med planlagt bemanning", "=B21+SUM(B24:B27)", lambda c: f"={c}21+SUM({c}24:{c}27)", bold=True)
mline(mo, 29, "GAP mot resultatmål (negativt = mangler)", None, lambda c: f"={c}28-{c}7", bold=True, red=True)
mline(mo, 30, "Implisert nettomargin (informativ)", "=B28/B21", lambda c: f"={c}28/{c}21", fmt=PCT)

# --- Kvartalsmål 2027 (rampen synlig) ---
sec(mo, 32, "KVARTALSMÅL 2027 (regnet av bemanningsplanen for år 1 — rampen synlig)", 5)
for i, h in enumerate(["", "Q1 2027", "Q2 2027", "Q3 2027", "Q4 2027"], start=1):
    c = mo.cell(row=33, column=i, value=h)
    c.font = WHITEB; c.fill = HDR_FILL; c.alignment = Alignment(horizontal="center")
qfte = {
    'B': f"=C10+C11*{p_r1}",
    'C': f"=C10+C11*{p_r2}+C12*{p_r1}",
    'D': f"=C10+C11*{p_r3}+C12*{p_r2}+C13*{p_r1}",
    'E': f"=C10+C11*{p_r3}+C12*{p_r3}+C13*{p_r2}+C14*{p_r1}",
}
qrows = [
    (34, "Producing FTE i kvartalet", lambda col: qfte[col], DES2),
    (35, "Omsetningsmål ex mva (FTE × stol/4 + Sindre/4)", lambda col: f"=({col}34*{p_stol}+{p_sindre})/4", NOK),
    (36, "Båter solgt", lambda col: f"={col}35/{p_innt}", DES1),
    (37, "Signerte oppdrag inn", lambda col: f"={col}36*{p_ratio}", DES1),
]
for rq, label, f, fmt in qrows:
    mo.cell(row=rq, column=1, value=label).font = BLACK
    for col in "BCDE":
        c = mo[f"{col}{rq}"]
        c.value = f(col); c.number_format = fmt
        c.alignment = Alignment(horizontal="right"); c.border = BOX; c.font = BLACK
mo['A38'] = "Kontroll: snittet av de fire kvartals-FTE-ene = årets FTE i rad 15. Summen av kvartalsomsetningen = rad 21 for år 1."
mo['A38'].font = GREY

# --- Behov for målet: SELVKONSISTENT kostbase (tre regimer) ---
sec(mo, 40, "BEHOV FOR MÅLET — selvkonsistent kostbase (flere stoler → høyere kostbase → mer omsetning …)", 5)
mo['A41'] = "Kostbasen avhenger av antall stoler, som avhenger av omsetningen. Fire scenarioer — modellen velger det som er konsistent med sitt eget stol-antall. (Steady-state: engangs rekrutteringskost holdes utenfor.)"
mo['A41'].font = GREY
mkrate = f"({p_mk}*{p_ratio}/{p_innt})"
bidragS = lambda c: f"({c}8-{komp(c)}-{mkrate}*{c}8)"
marg2 = f"(1-{p_mkost}-{mkrate}-{p_trinn}/{p_stol})"
base = lambda c: f"{c}7+{p_grunn}-2*{p_trinn}-{bidragS(c)}"
mline(mo, 42, "Scenario A (≤4 stoler): nødvendig megler-oms", None, lambda c: f"=({base(c)})/{marg2}")
mline(mo, 43, "   → producing FTE-behov A", None, lambda c: f"={c}42/{p_stol}", fmt=DES1)
mline(mo, 44, "Scenario B (5 stoler, + salgsleder): megler-oms", None, lambda c: f"=({base(c)}+{p_leder})/{marg2}")
mline(mo, 45, "   → producing FTE-behov B", None, lambda c: f"={c}44/{p_stol}", fmt=DES1)
mline(mo, 46, "Scenario C (6–7 stoler, + leder + kontor): megler-oms", None, lambda c: f"=({base(c)}+{p_leder}+{p_kontor})/{marg2}")
mline(mo, 47, "   → producing FTE-behov C", None, lambda c: f"={c}46/{p_stol}", fmt=DES1)
mline(mo, 48, "Scenario D (≥8 stoler, + leder + kontor + backoffice): megler-oms", None, lambda c: f"=({base(c)}+{p_leder}+{p_kontor}+{p_back})/{marg2}")
mline(mo, 49, "   → producing FTE-behov D", None, lambda c: f"={c}48/{p_stol}", fmt=DES1)
mline(mo, 50, "ENDELIG nødvendig megler-omsetning (konsistent scenario)", None,
      lambda c: (f"=IF(ROUNDUP({c}43,0)<=4,{c}42,IF(ROUNDUP({c}45,0)<=5,{c}44,"
                 f"IF(ROUNDUP({c}47,0)<=7,{c}46,{c}48)))"), bold=True)
mline(mo, 51, "ENDELIG nødvendig total omsetning", None, lambda c: f"={c}50+{c}8", bold=True)
mline(mo, 52, "ENDELIG producing FTE-behov (kapasitet, IKKE personer)", None, lambda c: f"={c}50/{p_stol}", fmt=DES1, bold=True)
mline(mo, 53, "Bemannede meglere for målet, steady-state (rundet opp + buffer)", None, lambda c: f"=ROUNDUP({c}52,0)+{p_buffer}", fmt=INT, bold=True)
mline(mo, 54, "Omsetningsgap (kapasitet − behov)", None, lambda c: f"={c}21-{c}51", red=True)
mo['A55'] = "FTE ≠ personer: i et INNFASINGSÅR yter nyansatte 40–100 % (rampen), så samme FTE krever flere bemannede — sammenlign rad 15 (FTE) mot rad 16 (bemannede) i planen. Scenario-tersklene (5/6/8) gjelder BEMANNEDE."
mo['A55'].font = GREY

mo['A57'] = "Buffer-stolen har ingen kostnad i modellen (planlagt tom). Vinnraten 68 % brukes kun i aktivitetsnedbrytningen og er PROXY."
mo['A57'].font = GREY
mo['A58'] = "Charter er holdt helt utenfor. Målt-kolonnen = fasit-omsetning m/dagens kostnivå og 7,1G — regnskapet 2025 viste +737k, se broen i Historikk."
mo['A58'].font = GREY

# ================= 1-3-5 PLAN =================
pl = wb.create_sheet("1-3-5 Plan", 2)
pl.sheet_view.showGridLines = False
for col, w in zip("ABCDE", [54, 15, 14, 14, 14]):
    pl.column_dimensions[col].width = w
pl['A1'] = "HOUSE OF YACHTS — 1/3/5-ÅRSPLAN"
pl['A1'].font = TITLE
pl['A2'] = "North Star: resultat før skatt (etter Sindre-lønn kappet på 7,1G). Mål og bemanning settes i Økonomimotor."
pl['A2'].font = GREY
pl['A3'] = "Planen handler om stoler, ikke navn. Stol = rampet megler; Sindre egen stol; buffer = planlagt tom."
pl['A3'].font = GREY

hdr_row(pl, 5, ["", "Målt siste 12 mnd", "År 1 (2027)", "År 3 (2029)", "År 5 (2031)"])

def pline(row, label, malt, f, fmt=NOK, bold=False, green=False, red=False):
    pl.cell(row=row, column=1, value=label).font = BLACKB if bold else BLACK
    vals = [("B", malt)] + [(c, f(c) if callable(f) else f) for c in "CDE"]
    for col, v in vals:
        c = pl[f"{col}{row}"]
        if v is not None: c.value = v
        c.number_format = fmt
        c.alignment = Alignment(horizontal="right"); c.border = BOX
        c.font = RED if (red and col != "B") else (GREEN if green else (BLACKB if bold else BLACK))

sec(pl, 6, "1. NORTH STAR (fra Økonomimotor)", 5)
pline(7, "Resultatmål før skatt", "=Økonomimotor!B7", lambda c: f"=Økonomimotor!{c}7", bold=True, green=True)
pline(8, "Omsetning målet krever (behov)", "=Økonomimotor!B21", lambda c: f"=Økonomimotor!{c}51", bold=True, green=True)
pline(9, "Kapasitet med planlagt bemanning", None, lambda c: f"=Økonomimotor!{c}21", green=True)
pline(10, "Resultat med planlagt bemanning / GAP mot mål", "=Økonomimotor!B28", lambda c: f"=Økonomimotor!{c}29", red=True)

sec(pl, 12, "2. FRA OMSETNING TIL BÅTER (behov)", 5)
pline(13, "Inntekt per solgt båt, ex mva (fasit)", f"={p_innt}", f"={p_innt}", green=True)
pline(14, "Båter som må selges per år", 75, lambda c: f"={c}8/{p_innt}", fmt=INT, bold=True)
pline(15, "Båter per måned", "=B14/12", lambda c: f"={c}14/12", fmt=DES1)

sec(pl, 17, "3. FRA BÅTER TIL STOLER", 5)
pline(18, "Producing megler-FTE målet krever", None, lambda c: f"=Økonomimotor!{c}52", fmt=DES1, bold=True)
pline(19, "Planlagt producing FTE (bemanningsplan m/ramp)", 1, lambda c: f"=Økonomimotor!{c}15", fmt=DES2, green=True)
pline(20, "Megler-stoler å bemanne for målet (rundet opp + buffer)", None, lambda c: f"=Økonomimotor!{c}53", fmt=INT, bold=True)
pline(21, "Planlagt bemannet ved årets slutt", f"={p_idag}", lambda c: f"=Økonomimotor!{c}16", fmt=INT, green=True)
pline(22, "REKRUTTERINGSGAP mot målet (stoler)", None, lambda c: f"={c}20-{c}21", fmt=INT, bold=True, red=True)

sec(pl, 24, "4. FRA STOLER TIL UKENTLIGE AKTIVITETER (behov; 68 % er PROXY)", 5)
pline(25, "Signerte oppdrag inn per år (båter × 1,30 planantakelse)", 67, lambda c: f"={c}14*{p_ratio}", fmt=INT)
pline(26, "Signerte oppdrag per uke", f"=B25/{p_uker}", lambda c: f"={c}25/{p_uker}", fmt=DES1)
pline(27, "Befaringer per år (÷ 68 % PROXY-vinnrate)", f"=B25/{p_close}", lambda c: f"={c}25/{p_close}", fmt=INT)
pline(28, "Befaringer per uke (teamet)", f"=B27/{p_uker}", lambda c: f"={c}27/{p_uker}", fmt=DES1, bold=True)
pline(29, "Kvalifiserte prospects per år (÷ 50 %)", 133, lambda c: f"={c}27/{p_pros}", fmt=INT)
pline(30, "Nye prospects per uke (teamet)", f"=B29/{p_uker}", lambda c: f"={c}29/{p_uker}", fmt=DES1, bold=True)
pline(31, "Befaringer per uke PER planlagt FTE (inkl. Sindre)", "=B28/(B19+1)", lambda c: f"={c}28/({c}19+1)", fmt=DES1)

pl['A33'] = "Når en megler slutter: rør ikke målene. Oppdater bemanningsplanen i Økonomimotor + «bemannet i dag» i Forutsetninger."
pl['A34'] = "Rekrutteringsgapet og resultat-gapet oppdaterer seg selv — det er de to tallene ukemøtet skal styre på."
pl['A33'].font = GREY; pl['A34'].font = GREY

# ================= SPAKER =================
sp = wb.create_sheet("Spaker", 3)
sp.sheet_view.showGridLines = False
for col, w in zip("ABCDE", [56, 15, 14, 14, 14]):
    sp.column_dimensions[col].width = w
sp['A1'] = "SPAKER — samme bemanningsplan, bedre driftsøkonomi"
sp['A1'].font = TITLE
sp['A2'] = "Scenario: provisjonsdisiplin ≥6 %/45k + premium-miks (snittbåt mot 1,6M), markedskost-tak, sterkere stoler (1,8M)."
sp['A2'].font = GREY

sp['A4'] = "Scenario-parametre (blå = juster):"
sp['A4'].font = BLACKB
sp_rows = [
    ("Inntekt per båt ex mva (1,6M snittbåt × 6 % ÷ 1,25)", 76800, NOK),
    ("Markedskost per signert oppdrag (CFO-mål)", 4552, NOK),
    ("Omsetning per producing megler-stol (produksjonsmål)", 1800000, NOK),
]
r = 5; spp = {}
for label, val, fmt in sp_rows:
    sp.cell(row=r, column=1, value=label).font = BLACK
    c = sp.cell(row=r, column=2, value=val)
    c.font = BLUE; c.fill = YEL_FILL; c.number_format = fmt
    spp[label] = f"$B${r}"; r += 1
s_innt = spp["Inntekt per båt ex mva (1,6M snittbåt × 6 % ÷ 1,25)"]
s_mk   = spp["Markedskost per signert oppdrag (CFO-mål)"]
s_stol = spp["Omsetning per producing megler-stol (produksjonsmål)"]
s_mkrate = f"({s_mk}*{p_ratio}/{s_innt})"

hdr_row(sp, 9, ["", "", "År 1 (2027)", "År 3 (2029)", "År 5 (2031)"])
def sline(row, label, sub, f, fmt=NOK, bold=False, green=False):
    sp.cell(row=row, column=1, value=label).font = BLACKB if bold else BLACK
    sp.cell(row=row, column=2, value=sub).font = GREY
    for c in "CDE":
        cc = sp[f"{c}{row}"]
        cc.value = f(c) if callable(f) else f
        cc.number_format = fmt
        cc.font = GREEN if green else (BLACKB if bold else BLACK)
        cc.alignment = Alignment(horizontal="right"); cc.border = BOX

M = "Økonomimotor!"
kompM = lambda c: f"MIN({p_sats}*{M}{c}8,{p_71g})*{p_load}"
sline(10, "Resultatmål (fra Økonomimotor)", "", lambda c: f"={M}{c}7", bold=True, green=True)
sline(11, "Kapasitets-omsetning m/spakene (samme FTE, 1,8M-stoler)", "", lambda c: f"={M}{c}15*{s_stol}+{M}{c}8", bold=True)
sline(12, "− Meglerkost 55 % av megler-oms", "", lambda c: f"=-{p_mkost}*({c}11-{M}{c}8)")
sline(13, "− Sindre-kompensasjon (7,1G, loaded)", "", lambda c: f"=-{kompM(c)}")
sline(14, "− Markedskost (oms ÷ 76 800 × 1,30 × 4 552)", "(færre båter per krone enn baseline!)", lambda c: f"=-{s_mk}*({c}11/{s_innt}*{p_ratio})")
sline(15, "− Kostbase (samme trinnkost som motoren, rad 19)", "", lambda c: f"=-{M}{c}19")
sline(16, "RESULTAT m/spakene på planlagt bemanning", "", lambda c: f"={c}11+SUM({c}12:{c}15)", bold=True)
sline(17, "KONTROLL: linjene minus resultat (skal være 0)", "", lambda c: f"=({c}11+{c}12+{c}13+{c}14+{c}15)-{c}16")
sline(18, "Resultat baseline (Økonomimotor)", "", lambda c: f"={M}{c}28", green=True)
sline(19, "Spak-effekt på resultatet", "", lambda c: f"={c}16-{c}18", bold=True)

sp['A21'] = "BEHOV FOR MÅLET M/SPAKENE — selvkonsistent, samme metode som motoren. NB: FTE = produksjonskapasitet, IKKE personer."
sp['A21'].font = BLACKB
s_bidrag = lambda c: f"({M}{c}8-{kompM(c)}-{s_mkrate}*{M}{c}8)"
s_marg2 = f"(1-{p_mkost}-{s_mkrate}-{p_trinn}/{s_stol})"
s_base = lambda c: f"{M}{c}7+{p_grunn}-2*{p_trinn}-{s_bidrag(c)}"
sline(22, "Scenario A (≤4 bemannede): nødvendig megler-oms", "", lambda c: f"=({s_base(c)})/{s_marg2}")
sline(23, "   → producing FTE-behov A", "", lambda c: f"={c}22/{s_stol}", fmt=DES1)
sline(24, "Scenario B (5 bemannede, +leder): megler-oms", "", lambda c: f"=({s_base(c)}+{p_leder})/{s_marg2}")
sline(25, "   → producing FTE-behov B", "", lambda c: f"={c}24/{s_stol}", fmt=DES1)
sline(26, "Scenario C (6–7, +leder+kontor): megler-oms", "", lambda c: f"=({s_base(c)}+{p_leder}+{p_kontor})/{s_marg2}")
sline(27, "   → producing FTE-behov C", "", lambda c: f"={c}26/{s_stol}", fmt=DES1)
sline(28, "Scenario D (≥8, +leder+kontor+backoffice): megler-oms", "", lambda c: f"=({s_base(c)}+{p_leder}+{p_kontor}+{p_back})/{s_marg2}")
sline(29, "   → producing FTE-behov D", "", lambda c: f"={c}28/{s_stol}", fmt=DES1)
sline(30, "ENDELIG nødvendig total omsetning m/spakene", "(konsistent scenario)",
      lambda c: (f"=IF(ROUNDUP({c}23,0)<=4,{c}22,IF(ROUNDUP({c}25,0)<=5,{c}24,"
                 f"IF(ROUNDUP({c}27,0)<=7,{c}26,{c}28)))+{M}{c}8"), bold=True)
sline(31, "ENDELIG producing FTE-behov m/spakene", "", lambda c: f"=({c}30-{M}{c}8)/{s_stol}", fmt=DES1, bold=True)
sline(32, "Bemannede meglere, steady-state (rundet opp)", "(rampede — i INNFASINGSÅR trengs flere pga ramp)", lambda c: f"=ROUNDUP({c}31,0)", fmt=INT, bold=True)
sline(33, "Producing FTE-behov baseline (Økonomimotor)", "", lambda c: f"={M}{c}52", fmt=DES1, green=True)

sp['A36'] = "DE FIRE SPAKENE (CFO-analysen jul 2026) — verdt å hente FØR flere stoler rekrutteres:"
sp['A36'].font = BLACKB
levers = [
    "A. Provisjonsdisiplin: 13 av 38 H1-salg under 6 %/45k = ~266k tapt provisjon. Rabatt krever Sindres godkjenning. ~200k+/år.",
    "B. Marte-tripwire (18. okt): Henrik må vise 1,9M+ årstakt og bedre befaring-rate. Svinger resultatet 500–700k. Status aug: behold.",
    "C. Markedskost-tak: 15k-tak håndheves; frys markedsføring over taket til pris justeres. Mål 4 552/oppdrag (målt 6 600).",
    "D. Sindres 7,1G-uttak: alt Sindre omsetter over ~2,15M koster ikke mer lønn — hans marginale omsetning er firmaets mest lønnsomme.",
    "E. (Ny) Premium-miks: fasit-snittet er 58 375/båt (median 50 400). Hver 10 000 kr høyere inntekt/båt ≈ 15–20 % færre båter for samme mål.",
]
r = 37
for t in levers:
    sp.cell(row=r, column=1, value=t).font = BLACK
    r += 1

# ================= WEEKLY SCORECARD =================
sc = wb.create_sheet("Weekly Scorecard")
sc.sheet_view.showGridLines = False
sc.column_dimensions['A'].width = 32
for i, w in zip(range(2, 10), [14, 12, 13, 11, 14, 13, 30, 8]):
    sc.column_dimensions[get_column_letter(i)].width = w
sc['A1'] = "WEEKLY SCORECARD — koblet til motoren (fyll inn hver fredag)"
sc['A1'].font = TITLE
sc['A2'] = "STYR PÅ ÉN LINJE: provisjon ex mva (hovedmålet). Leading-kolonnene forklarer NESTE måneds provisjon (salgstid ~89 dg). «H2-rest» = (mål − levert)/uker igjen — oppdater ukentlig."
sc['A2'].font = GREY
sc['A3'] = "Befaring-målet bruker 68 % PROXY-vinnrate. Rekrutteringsstatus er fast punkt i ukemøtet."
sc['A3'].font = GREY

hdr_row(sc, 5, ["Uke", "Nye prospects", "Befaringer", "Signerte oppdrag", "Båter solgt", "Provisjon ex mva", "Publisert ≤7 dg", "Actions neste uke", "R/G/G"])

salg_uke = f"(({p_h2mal}-{p_h2lev})/{p_innt}/{p_h2uker})"
typ = ["", "LEADING", "LEADING", "LEADING", "LAGGING", "★ HOVEDMÅL", "KONTROLL", "", ""]
for i, t in enumerate(typ, start=1):
    c = sc.cell(row=5, column=i)
for i, t in enumerate(typ[1:], start=2):
    c = sc.cell(row=6, column=i, value=t)
    c.font = GREY; c.alignment = Alignment(horizontal="center")
sc.cell(row=6, column=1, value="Type").font = GREY
sc.cell(row=7, column=1, value="MÅL: H2-rest (per KALENDERUKE, 17 igjen)").font = BLUEB
h2targets = [f"={salg_uke}*{p_ratio}/{p_close}/{p_pros}", f"={salg_uke}*{p_ratio}/{p_close}",
             f"={salg_uke}*{p_ratio}", f"={salg_uke}", f"=({p_h2mal}-{p_h2lev})/{p_h2uker}", 1, "", ""]
for i, t in enumerate(h2targets, start=2):
    c = sc.cell(row=7, column=i, value=t)
    c.font = BLUEB; c.fill = YEL_FILL
    c.alignment = Alignment(horizontal="center")
    c.number_format = NOK if i == 6 else (PCT if i == 7 else DES1)

sc.cell(row=8, column=1, value="Info: År 1-behov 2027 (per ARBEIDSUKE av 46 — IKKE sammenlignbar med H2-linjen)").font = GREY
y1 = [f"='1-3-5 Plan'!C30", f"='1-3-5 Plan'!C28", f"='1-3-5 Plan'!C26", f"='1-3-5 Plan'!C14/{p_uker}",
      f"='1-3-5 Plan'!C8/{p_uker}", 1, "", ""]
for i, t in enumerate(y1, start=2):
    c = sc.cell(row=8, column=i, value=t)
    c.font = GREY
    c.alignment = Alignment(horizontal="center")
    c.number_format = NOK if i == 6 else (PCT if i == 7 else DES1)

for wk in range(36, 53):
    rr = wk - 26
    sc.cell(row=rr, column=1, value=str(wk)).font = BLACK
    for col in range(1, 10):
        sc.cell(row=rr, column=col).border = BOX
for row in (6, 7, 8):
    for col in range(1, 10):
        sc.cell(row=row, column=col).border = BOX

sc['A29'] = "Fast ukemøte (30–45 min): 1) radene mot H2-rest-målet, 2) rød/gul/grønn, 3) 1–3 actions, 4) rekrutteringsstatus."
sc['A29'].font = GREY
sc['A30'] = "Definisjoner: Nye prospects = deals opprettet i Pipeline A. Befaringer = holdte. Signerte = Vunnet i A. Provisjon = oppgjørsliste ex mva."
sc['A29'].font = GREY
sc['A30'].font = GREY


# ================= LIKVIDITET =================
# Månedlig kontantstrøm jan 2027–des 2028. Antar globals fra hovedskriptet:
# wb, font-objekter, fills, Alignment, get_column_letter, tallformater, og p_* (Forutsetninger-refs).
from openpyxl.utils import get_column_letter as _gcl
import os as _os, json as _json, urllib.request as _rq

def _po_env():
    url = _os.environ.get('SUPABASE_URL'); key = _os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if url and key: return url, key
    try: here = _os.path.dirname(_os.path.abspath(__file__))
    except NameError: here = _os.getcwd()
    for cand in [_os.path.join(here, '..', 'befaring-app', '.env'),
                 _os.path.join(here, 'hoy-portal', 'befaring-app', '.env'),
                 _os.path.join(here, 'befaring-app', '.env')]:
        if _os.path.exists(cand):
            env = {}
            for line in open(cand, encoding='utf-8'):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1); env[k.strip()] = v.strip()
            u = env.get('SUPABASE_URL'); k = env.get('SUPABASE_SERVICE_ROLE_KEY') or env.get('SUPABASE_SERVICE_KEY')
            if u and k: return u, k
    return None, None

def _po_snapshot():
    url, key = _po_env()
    if not url or not key: return None
    try:
        req = _rq.Request(url.rstrip('/') + '/rest/v1/po_liquidity_snapshot?select=*&order=snapshot_date.desc&limit=1',
                          headers={'apikey': key, 'Authorization': 'Bearer ' + key})
        with _rq.urlopen(req, timeout=15) as resp:
            data = _json.loads(resp.read().decode())
        return data[0] if data else None
    except Exception as e:
        print('[PO] snapshot-henting feilet:', e); return None

PO = _po_snapshot()
print('[PO] snapshot:', ('hentet ' + str(PO.get('snapshot_date'))) if PO else 'ikke tilgjengelig — bruker plassholdere')

lq = wb.create_sheet("Likviditet", 4)
lq.sheet_view.showGridLines = False
NM = 24
def MC(m): return m + 1
def ML(m): return _gcl(MC(m))
SUM27, SUM28 = 26, 27
S27L, S28L = _gcl(SUM27), _gcl(SUM28)

lq.column_dimensions['A'].width = 46
for m in range(1, NM+1):
    lq.column_dimensions[ML(m)].width = 9.5
lq.column_dimensions[S27L].width = 12
lq.column_dimensions[S28L].width = 12
lq.freeze_panes = "B6"

_mn = ['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des']
def mlabel(m):
    yr = 2027 if m <= 12 else 2028
    return f"{_mn[(m-1)%12]} {yr%100:02d}"
def midx(m): return (m-1) % 12 + 1

def secbar(r, t):
    c = lq.cell(r, 1, t); c.font = WHITEB
    for cc in range(1, SUM28+1): lq.cell(r, cc).fill = HDR_FILL
def subbar(r, t):
    c = lq.cell(r, 1, t); c.font = BLACKB
    for cc in range(1, SUM28+1): lq.cell(r, cc).fill = SEC_FILL
def grey(r, t):
    c = lq.cell(r, 1, t); c.font = GREY
    c.alignment = Alignment(wrap_text=True, vertical="top")
def inp(r, label, val, fmt=NOK, note=None):
    lq.cell(r, 1, label).font = BLACK
    c = lq.cell(r, 2, val); c.font = BLUE; c.fill = YEL_FILL
    if fmt: c.number_format = fmt
    if note:
        n = lq.cell(r, 3, note); n.font = GREY
        n.alignment = Alignment(wrap_text=True, vertical="top")
    return f"$B${r}"
def mrow(r, label, fn, fmt=NOK, bold=False, green=False, red=False, addsum=True):
    lab = lq.cell(r, 1, label)
    lab.font = BLACKB if bold else (RED if red else (GREEN if green else BLACK))
    fnt = BLACKB if bold else (RED if red else BLACK)
    for m in range(1, NM+1):
        cc = lq.cell(r, MC(m), fn(m)); cc.number_format = fmt; cc.font = fnt
    if addsum:
        a = lq.cell(r, SUM27, f"=SUM({ML(1)}{r}:{ML(12)}{r})"); a.number_format = fmt; a.font = BLACKB
        b = lq.cell(r, SUM28, f"=SUM({ML(13)}{r}:{ML(24)}{r})"); b.number_format = fmt; b.font = BLACKB

lq['A1'] = "LIKVIDITET — månedlig kontantstrøm jan 2027 – des 2028"
lq['A1'].font = TITLE
lq['A2'] = ("Samme motor som resten av boka (Forutsetninger). GUL = ditt valg. "
            "Ferske åpningstall per 28.08.2026. Alt merket ANSLAG/PLASSHOLDER kan justeres fritt.")
lq['A2'].font = GREY

# ---- KPI-stripe (formler settes til slutt) ----
r = 3
subbar(r, "NØKKELTALL (regnes av tabellen under)"); r += 1
lq.cell(r,1,"Laveste kontantsaldo i perioden").font = BLACK; kpi_low = r; r += 1
lq.cell(r,1,"— inntreffer i måned").font = BLACK; kpi_lowm = r; r += 1
lq.cell(r,1,"Margin mot minimumsbuffer på lavpunktet").font = BLACK; kpi_marg = r; r += 1
lq.cell(r,1,"Antall måneder under bufferen").font = BLACK; kpi_under = r; r += 1
lq.cell(r,1,"Laveste saldo + kassekreditt (bunn før overtrekk)").font = BLACK; kpi_kasse = r; r += 1
lq.cell(r,1,"Kontantsaldo ved utgangen (des 2028)").font = BLACK; kpi_end = r; r += 1
r += 1

# ---- PO-panel: ferske tall fra PowerOffice (live ved hver bygging) ----
_po_dt = PO.get('snapshot_date') if PO else None
secbar(r, "FERSKE TALL FRA POWEROFFICE" + (f"  (hentet {_po_dt} — oppdateres nattlig)" if PO else "  — IKKE HENTET (plassholdere brukes; kjør sync)")); r += 1
if PO:
    def _pnum(k):
        v = PO.get(k); return 0 if v is None else v
    bank_po = _pnum('bank_total')
    mva_po = _pnum('mva_posisjon')
    rr_m = _pnum('runrate_months') or 12
    driftskost_aar = (_pnum('runrate_6000') + _pnum('runrate_7000')) / rr_m * 12
    _polines = [
        ("Bank — PowerOffice-hovedbok (alle 19xx)", bank_po, GREEN,
         "AVSTEMMING: sammenlign med reell banksaldo i A. Stort avvik = uposterte bilag (hovedboka henger etter)."),
        ("Kundefordringer (hovedbok 15xx)", _pnum('kundefordringer'), GREEN,
         "Utestående kundefordringer. Åpne poster (reell AR): " + f"{int(_pnum('kundefordringer_openitems')):,}".replace(',', ' ')),
        ("Leverandørgjeld (24xx)", _pnum('leverandorgjeld'), GREEN, "Negativt = gjeld."),
        ("Utgående mva-gjeld (27xx)", mva_po, GREEN,
         "Negativt = skyldig mva. Betales ved neste termin (i praksis i Q4 2026 — del av bro sep–des)."),
        ("Skyldig skattetrekk (26xx)", _pnum('skattetrekk'), GREEN, "Bundet på skattetrekkskonto."),
        ("Betalbar skatt (25xx)", _pnum('betalbar_skatt'), GREEN, None),
        ("Driftskost annualisert (6xxx+7xxx, u/lønn)", driftskost_aar, GREEN,
         f"Fra {int(rr_m)} mnd posteringer × 12. Lønn (5xxx) = {int(_pnum('runrate_5000_lonn')):,}".replace(',', ' ') + " i vinduet (inkl. megler+Marte+Philip — må splittes før kostbase-kalibrering)."),
    ]
    for lbl, val, fnt, note in _polines:
        lq.cell(r,1,lbl).font = BLACK
        c = lq.cell(r,2, round(val)); c.number_format = NOK; c.font = fnt
        if note:
            n = lq.cell(r,3, note); n.font = GREY; n.alignment = Alignment(wrap_text=True, vertical="top")
        r += 1
    grey(r, "Grønne tall hentes automatisk fra PowerOffice hver gang boka bygges. De er FERSK POSISJON i dag (28.08) — "
            "modellen starter jan 2027, så bruk dem til å sette broen sep–des 2026 og overheng, ikke som direkte januartall.")
    r += 1
else:
    grey(r, "Fant ikke Supabase-nøkkel (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) i miljø eller ../befaring-app/.env. "
            "Kjør byggeskriptet fra ~/hoy-portal/HoY Internportal/, så hentes tallene automatisk.")
    r += 1
r += 1

# ---- A. Åpningsposisjon ----
secbar(r, "A. ÅPNINGSPOSISJON OG STYRINGSVALG"); r += 1
# Reell banksaldo = hovedbok 1920 (live fra PO) + fast avstemmingsdifferanse
_hb1920 = round(PO.get('bank_drift')) if (PO and PO.get('bank_drift') is not None) else -290763
lq.cell(r,1,"Hovedbok 1920 — bank (live fra PowerOffice)").font = BLACK
_hbc = lq.cell(r,2, _hb1920); _hbc.number_format = NOK; _hbc.font = GREEN
lq.cell(r,3, "Bokført banksaldo (henger etter reell bank med differansen under).").font = GREY
_hb_cell = f"$B${r}"; r += 1
a_avstem = inp(r, "+ Avstemmingsdifferanse (kontoutskrift − hovedbok 1920)", 1360037, NOK,
    "Fra PO bankavstemming 14.09.2026: 1 069 274 − (−290 763) = 1 360 037. Frossen historisk differanse (avstemmingen viser «Sum bevegelser 0»). Oppdater fra GO-rapporten ved behov."); r += 1
a_bank = f"$B${r}"; lq.cell(r,1,"= Reell banksaldo (kontoutskrift)").font = BLACKB
lq.cell(r,2, f"={_hb_cell}+{a_avstem}").number_format = NOK; lq.cell(r,2).font = BLACKB
lq.cell(r,3, "= hovedbok 1920 + differanse ≈ «Saldo kontoutskrift» i GO. Oppdateres live når 1920 synkes. UTEN kassekreditt (se under).").font = GREY
r += 1
_skt = abs(PO.get('skattetrekk') or 0) if PO else 0
a_bound = inp(r, "— herav bundet skattetrekk (utilgjengelig)", _skt, NOK, ("Auto fra PowerOffice (konto 26xx)." if PO else "Sindre 28.08: 0 bundet.")); r += 1
a_disp = f"$B${r}"; lq.cell(r,1,"Disponibel saldo i dag").font=BLACK
lq.cell(r,2, f"={a_bank}-{a_bound}").number_format=NOK; lq.cell(r,2).font=BLACKB; r += 1
a_bro = inp(r, "Netto driftskontantstrøm sep–des 2026 (bro til nyttår)", 0, NOK,
            "PLASSHOLDER. Netto inn−ut sep–des 2026 EKSKL. provisjon som først innbetales i 2027 (ligger i «overheng» under)."); r += 1
a_open = f"$B${r}"; lq.cell(r,1,"= ÅPNINGSSALDO 1. jan 2027").font=BLACKB
lq.cell(r,2, f"={a_disp}+{a_bro}").number_format=NOK; lq.cell(r,2).font=BLACKB; r += 1
a_buf = inp(r, "Minimumsbuffer (ønsket bunnivå på konto)", 500000, NOK,
            "Ditt valg. Modellen flagger måneder under dette."); r += 1
a_kasse = inp(r, "Tilgjengelig kassekreditt (overtrekksramme)", 200000, NOK,
            "Ekstra likviditet på toppen — kontoutskrift-saldoen er UTEN denne. Reell bunn før overtrekk = −kassekreditt."); r += 1
a_scen = inp(r, "Cash-lag scenario (1=Base median ~14d · 2=Plan P75 ~32d · 3=Stress P90 ~61d)", 1, INT,
             "DOKUMENTERT deal-for-deal (solgt→faktura, n=92, se deal-for-deal-oppgjor.csv): median 14d, P75 32d, P90 61d, maks 116. Andel betalt innen 7/14/30/60d = 23/51/75/89 %. FOR ANSETTELSESBESLUTNINGER: bruk Plan (P75=2). NB (rådgiver): fakturadato brukes som OPERATIV cash-proxy fordi provisjonen normalt er tilgjengelig ved oppgjør — dette må avstemmes mot FAKTISK bankdato. Bokført betalt ligger i flere tilfeller 50–100 d etter faktura (bevis bokføringsetterslep, ikke at cash var tilgjengelig samme dag). Hent bankdato for de store oppgjørene."); r += 1
a_seas = inp(r, "Sesongprofil på salg (1=empirisk · 0=flatt 1/12)", 1, INT,
             "1 = fordel salget som FAKTISK målt (mai–jul tungt, vinter tynt). 0 = jevnt."); r += 1
a_mklead = inp(r, "Markedsføring betales N mnd FØR salget", 3, INT,
               "Annonsering/foto betales når oppdraget signeres, ~89 dg (3 mnd) før salg."); r += 1
a_brokerlag = inp(r, "Meglerutbetaling N mnd etter salg", 0, INT,
                  "0 = megler får oppgjør samme måned som salget (konservativt)."); r += 1
a_vat = inp(r, "Mva-sats (utgående/inngående)", 0.25, PCT, "Standard 25 %."); r += 1
a_vatshare = inp(r, "Mva-belagt andel av kostbasen", 0.35, PCT,
                 "PLANANTAKELSE: andel av kostbasen (ekskl. lønn) med inngående mva."); r += 1
r += 1

# ---- B. Betalingsprofil ----
secbar(r, "B. BETALINGSPROFIL — andel av en salgsmåneds provisjon innbetalt m/forsinkelse"); r += 1
for i,h in enumerate(["Profil","salgsmnd","+1 mnd","+2 mnd","+3 mnd","+4 mnd","snitt (dg)"]):
    cc = lq.cell(r, 1+i, h); cc.font = WHITEB; cc.fill = HDR_FILL
    cc.alignment = Alignment(horizontal="center", wrap_text=True)
r += 1
prof = {
    "1 Base — faktisk median (~14d)": [0.54,0.30,0.10,0.03,0.03],
    "2 Plan — P75 (~32d)":            [0.30,0.40,0.20,0.07,0.03],
    "3 Stress — P90 (~61d)":          [0.10,0.25,0.40,0.20,0.05],
}
prof_rows = []
for name,vals in prof.items():
    lq.cell(r,1,name).font = BLACK
    for k,v in enumerate(vals):
        cc = lq.cell(r, 2+k, v); cc.number_format = PCT
        cc.font = BLUE if name.startswith("2") else BLACK
    sd = lq.cell(r,7, f"=({_gcl(3)}{r}*1+{_gcl(4)}{r}*2+{_gcl(5)}{r}*3+{_gcl(6)}{r}*4)*30.4")
    sd.number_format='0'; sd.font=GREY
    prof_rows.append(r); r += 1
lq.cell(r,1,"AKTIV PROFIL (valgt av scenario over)").font = BLACKB
for k in range(5):
    col = _gcl(2+k)
    cc = lq.cell(r, 2+k, f"=CHOOSE({a_scen},{col}{prof_rows[0]},{col}{prof_rows[1]},{col}{prof_rows[2]})")
    cc.number_format = PCT; cc.font = BLACKB
r_akt = r
lq.cell(r,7, f"=SUM({_gcl(2)}{r}:{_gcl(6)}{r})").number_format = PCT
lq.cell(r,7).font = GREY
r += 1
lq.cell(r,1,"Kontroll: aktiv profil = 100 %").font = GREY
lq.cell(r,2, f"=SUM({_gcl(2)}{r_akt}:{_gcl(6)}{r_akt})").number_format = PCT
lq.cell(r,2).font = GREY
r += 2

# ---- C. Sesongindeks ----
secbar(r, "C. SESONGINDEKS — månedsandel av årets provisjon (FAKTISK målt, oppgjør 2025+2026)"); r += 1
# månedsheader
lq.cell(r,1,"").font = GREY
for i,mn in enumerate(_mn):
    hc = lq.cell(r, 2+i, mn); hc.font = GREY; hc.alignment = Alignment(horizontal="center")
r += 1
seas = [0.030,0.0524,0.0874,0.0554,0.1728,0.2095,0.1457,0.0554,0.0816,0.0340,0.0447,0.0311]
lq.cell(r,1,"Andel av årsprovisjon per måned").font = BLACK
r_seas = r
for i in range(12):
    cc = lq.cell(r, 2+i, seas[i]); cc.number_format = PCT; cc.font = BLUE; cc.fill = YEL_FILL
r += 1
lq.cell(r,1,"Kontroll: summerer til 100 %").font = GREY
lq.cell(r,2, f"=SUM({_gcl(2)}{r_seas}:{_gcl(13)}{r_seas})").number_format = PCT
lq.cell(r,2).font = GREY
lq.cell(r,4,"jan≈0 i rådata (lite utvalg) → 3 % gulv + renormalisert. Mai–jul ≈ 53 % av året.").font = GREY
r += 2
def seas_ref(m): return "$" + _gcl(1+midx(m)) + f"${r_seas}"

# ---- D. Bemanning ----
secbar(r, "D. BEMANNING → PRODUKSJONSKAPASITET (samme ramp som motoren)"); r += 1
grey(r, "Oppstartsmåned per stol (GUL, i «start»-kolonnen ytterst). 1 = jan 2027 … 24 = des 2028. "
        "Negativt = allerede rampet. Tom = ledig. Ramp mnd 1–3=40 %, 4–6=75 %, 7+=100 % (Forutsetninger).")
r += 1
slots = [
    ("Megler-stol 1 (Henrik — rampet)", -6),
    ("Megler-stol 2 (rampet ved 2027-start)", -6),
    ("Megler-stol 3 (nyansatt 2027 Q1)", 1),
    ("Megler-stol 4 (nyansatt 2027 Q2)", 4),
    ("Megler-stol 5 (nyansatt 2027 Q3)", 7),
    ("Megler-stol 6 (nyansatt 2028)", 13),
    ("Megler-stol 7 (ledig)", None),
    ("Megler-stol 8 (ledig)", None),
]
hdrrow = r
lq.cell(r,1,"Stol \\ måned →").font = BLACKB
for m in range(1, NM+1):
    hc = lq.cell(r, MC(m), mlabel(m)); hc.font = WHITEB; hc.fill = HDR_FILL
    hc.alignment = Alignment(horizontal="center")
hs = lq.cell(r, SUM27, "start"); hs.font = WHITEB; hs.fill = HDR_FILL
r += 1
r1, r2, r3 = p_r1, p_r2, p_r3
factor_rows = []
for name, start in slots:
    lq.cell(r,1,name).font = BLACK
    sc = lq.cell(r, SUM27, start); sc.font = BLUE; sc.fill = YEL_FILL; sc.number_format = INT
    sref = f"${S27L}${r}"
    for m in range(1, NM+1):
        f = (f'=IF({sref}="",0,IF({m}<{sref},0,'
             f'IF({m}-{sref}<3,{r1},IF({m}-{sref}<6,{r2},{r3}))))')
        cc = lq.cell(r, MC(m), f); cc.number_format = DES2; cc.font = BLACK
    factor_rows.append(r); r += 1
start_range = f"${S27L}${factor_rows[0]}:${S27L}${factor_rows[-1]}"

mrow(r, "Producing megler-FTE (sum stoler)",
     lambda m: "=" + "+".join(f"{ML(m)}{fr}" for fr in factor_rows),
     fmt=DES2, bold=True, addsum=False)
r_fte = r
lq.cell(r,SUM27, f"=AVERAGE({ML(1)}{r}:{ML(12)}{r})").number_format=DES2; lq.cell(r,SUM27).font=BLACKB
lq.cell(r,SUM28, f"=AVERAGE({ML(13)}{r}:{ML(24)}{r})").number_format=DES2; lq.cell(r,SUM28).font=BLACKB
r += 1
mrow(r, "Bemannede stoler v/månedsslutt (u/Sindre)",
     lambda m: f'=SUMPRODUCT(({start_range}<>"")*({start_range}<={m}))', fmt=INT, addsum=False)
r_bem = r
lq.cell(r,SUM27, f"={ML(12)}{r}").number_format=INT; lq.cell(r,SUM27).font=BLACKB
lq.cell(r,SUM28, f"={ML(24)}{r}").number_format=INT; lq.cell(r,SUM28).font=BLACKB
r += 2

# ---- E. Omsetning bokført ----
secbar(r, "E. OMSETNING BOKFØRT (i salgsmåneden) — ex mva"); r += 1
def seasf(m): return f'IF({a_seas}=1,{seas_ref(m)}*12,1)'
mrow(r, "Megler-omsetning bokført", lambda m: f"={ML(m)}{r_fte}*{p_stol}/12*{seasf(m)}"); r_megbook = r; r += 1
mrow(r, "Sindre-omsetning bokført", lambda m: f"={p_sindre}/12*{seasf(m)}"); r_sinbook = r; r += 1
mrow(r, "Sum provisjon bokført (ex mva)", lambda m: f"={ML(m)}{r_megbook}+{ML(m)}{r_sinbook}", bold=True); r_totbook = r; r += 1
mrow(r, "Båter solgt (informativ)", lambda m: f"={ML(m)}{r_totbook}/{p_innt}", fmt=DES2); r += 1
grey(r, "Overheng: provisjon fra båter solgt okt–des 2026 som innbetales i 2027 (ANSLAG). "
        "Uten dette blir jan–mar 2027 kunstig tørt (salg tidlig i 2027 betales ~89 dg senere).")
r += 1
lq.cell(r,1,"Bokført provisjon okt / nov / des 2026 (ANSLAG)").font = BLACK
for cidx,val in [(2,170000),(3,225000),(4,155000)]:
    cc = lq.cell(r, cidx, val); cc.font=BLUE; cc.fill=YEL_FILL; cc.number_format=NOK
lq.cell(r,5,"← okt / nov / des 2026").font = GREY
ov_cells = {0: f"$D${r}", -1: f"$C${r}", -2: f"$B${r}"}
r += 2

# ---- F. Innbetaling ----
secbar(r, "F. INNBETALING (fra kunder, inkl. mva) = bokført provisjon × 1,25 × betalingsprofil"); r += 1
def cashin(m):
    vm = f"(1+{a_vat})"
    terms = []
    for k in range(5):
        pk = f"${_gcl(2+k)}${r_akt}"
        s = m - k
        if s >= 1: terms.append(f"{ML(s)}{r_totbook}*{vm}*{pk}")
        elif s in ov_cells: terms.append(f"{ov_cells[s]}*{vm}*{pk}")
    return "=" + "+".join(terms)
mrow(r, "Innbetalt fra kunder (provisjon inkl. mva)", cashin, bold=True, green=True); r_cashin = r; r += 1
grey(r, "Kunden betaler provisjon + 25 % mva. HoY holder mva-en til terminoppgjøret (rad under i G). "
        "Ex mva-provisjonen er «Sum provisjon bokført» i blokk E.")
r += 2

# ---- G. Utbetalinger ----
secbar(r, "G. UTBETALINGER"); r += 1
mrow(r, "Meglerutbetaling (55 % av megler-oms)",
     lambda m: f"=IF({m}-{a_brokerlag}>=1,INDEX({ML(1)}{r_megbook}:{ML(24)}{r_megbook},1,{m}-{a_brokerlag}),0)*{p_mkost}")
r_broker = r; r += 1
sindre_comp = f"MIN({p_sats}*{p_sindre},{p_71g})*{p_load}"
mrow(r, "Sindre-lønn (7,1G, loaded)", lambda m: f"={sindre_comp}/12"); r_sinpay = r; r += 1
# Kostbase per år (trinnvis) i Z/AA, /12 per måned
lq.cell(r,1,"Kostbase (trinnvis) per måned").font = BLACK
r_kb = r
kb27_f = (f"={p_grunn}+{p_trinn}*MAX(0,{S27L}{r_bem}-2)"
          f"+IF({S27L}{r_bem}>=5,{p_leder},0)+IF({S27L}{r_bem}>=6,{p_kontor},0)+IF({S27L}{r_bem}>=8,{p_back},0)")
kb28_f = (f"={p_grunn}+{p_trinn}*MAX(0,{S28L}{r_bem}-2)"
          f"+IF({S28L}{r_bem}>=5,{p_leder},0)+IF({S28L}{r_bem}>=6,{p_kontor},0)+IF({S28L}{r_bem}>=8,{p_back},0)")
lq.cell(r,SUM27, kb27_f).number_format=NOK; lq.cell(r,SUM27).font=BLACKB
lq.cell(r,SUM28, kb28_f).number_format=NOK; lq.cell(r,SUM28).font=BLACKB
for m in range(1,NM+1):
    cc = lq.cell(r,MC(m), f"=IF({m}<=12,${S27L}${r_kb},${S28L}${r_kb})/12")
    cc.number_format=NOK; cc.font=BLACK
r += 1
mrow(r, "Onboarding nyansatt (engang)",
     lambda m: f"=SUMPRODUCT(({start_range}={m})*1)*{p_rekr}"); r_onb = r; r += 1
mrow(r, "Markedskost (per signert oppdrag)",
     lambda m: f"=INDEX({ML(1)}{r_totbook}:{ML(24)}{r_totbook},1,MIN(24,{m}+{a_mklead}))/{p_innt}*{p_ratio}*{p_mk}")
r_mkt = r; r += 1
mrow(r, "  (memo) Netto mva påløpt (utg. på salg − inng. på kost)",
     lambda m: f"={a_vat}*{ML(m)}{r_totbook}-{a_vat}*({ML(m)}{r_mkt}+{a_vatshare}*{ML(m)}{r_kb})", green=True)
r_vat = r; r += 1
settle = {4:(1,2),6:(3,4),8:(5,6),10:(7,8),12:(9,10),14:(11,12),
          16:(13,14),18:(15,16),20:(17,18),22:(19,20),24:(21,22)}
def vatpay(m):
    if m in settle:
        a,b = settle[m]; return f"={ML(a)}{r_vat}+{ML(b)}{r_vat}"
    return 0
mrow(r, "Mva-oppgjør (annenhver måned)", vatpay); r_vatpay = r; r += 1
tax26 = inp(r, "Restskatt 2026 (betales 15/2 + 15/4 2027)", 0, NOK,
            "PLASSHOLDER. Skatt 2025 (179k) er betalt. Forskuddsskatt 2026 forfaller feb+apr 2027."); r += 1
lq.cell(r,1,"Resultat-proxy 2027 (ex mva, for skatt 2028)").font = BLACK
r_res27 = r
lq.cell(r,SUM27, f"={S27L}{r_totbook}-{S27L}{r_broker}-{S27L}{r_sinpay}-{S27L}{r_mkt}-{S27L}{r_kb}").number_format=NOK
lq.cell(r,SUM27).font=BLACKB
r += 1
lq.cell(r,1,"Selskapsskatt 2027 (22 % av positivt resultat)").font = BLACK
lq.cell(r,2, f"=0.22*MAX(0,{S27L}{r_res27})").number_format=NOK; lq.cell(r,2).font=BLACKB
tax27_cell = f"$B${r}"; r += 1
def taxpay(m):
    parts = []
    if m in (2,4): parts.append(f"{tax26}/2")
    if m in (14,16): parts.append(f"{tax27_cell}/2")
    return "=" + "+".join(parts) if parts else 0
mrow(r, "Selskapsskatt (forskudd feb/apr)", taxpay); r_tax = r; r += 1

subbar(r, "Kjente engangsposter — beløp (GUL) og måned 1–24 (GUL)"); r += 1
eng = [
    ("Besluttet utbytte (rest)", 850000, 9,
     "850k besluttet, 0 utbetalt (Sindre 28.08). Timing valgfri — H2-oppgjør anbefalt. Mnd 9 = sep 2027."),
    ("Motfakturering Oslo Båt / krympeplast (netto)", 125000, 11,
     "Sindre: ~100–150k motfaktureres. Netto anslag 125k. Juster."),
    ("Underleverandør", 50000, 10, "Sindre: ~50k."),
    ("(ledig)", None, None, None),
    ("(ledig)", None, None, None),
]
eng_first = r
for label, belop, mnd, note in eng:
    lq.cell(r,1,label).font = BLACK
    bc = lq.cell(r, 2, belop); bc.font=BLUE; bc.fill=YEL_FILL; bc.number_format=NOK
    mc = lq.cell(r, 3, mnd); mc.font=BLUE; mc.fill=YEL_FILL; mc.number_format=INT
    if note:
        nn = lq.cell(r,4,note); nn.font=GREY; nn.alignment=Alignment(wrap_text=True,vertical="top")
    r += 1
eng_last = r-1
eng_belop = f"$B${eng_first}:$B${eng_last}"
eng_mnd = f"$C${eng_first}:$C${eng_last}"
mrow(r, "Sum engangsposter",
     lambda m: f'=SUMPRODUCT(({eng_mnd}={m})*N({eng_belop}))', bold=True); r_eng = r; r += 2

# ---- H. Kontantstrøm & saldo ----
secbar(r, "H. NETTO KONTANTSTRØM OG SALDO"); r += 1
mrow(r, "SUM INNBETALINGER", lambda m: f"={ML(m)}{r_cashin}", bold=True, green=True); r_in = r; r += 1
out_comps = None
def sumout(m):
    return "=" + "+".join(f"{ML(m)}{cr}" for cr in [r_broker,r_sinpay,r_kb,r_onb,r_mkt,r_vatpay,r_tax,r_eng])
mrow(r, "SUM UTBETALINGER", sumout, bold=True, red=True); r_out = r; r += 1
mrow(r, "NETTO KONTANTSTRØM", lambda m: f"={ML(m)}{r_in}-{ML(m)}{r_out}", bold=True); r_net = r; r += 1
lq.cell(r,1,"Inngående saldo").font = BLACK
r_ib = r; r += 1
lq.cell(r,1,"UTGÅENDE SALDO (kontantbeholdning)").font = BLACKB
r_ub = r
for m in range(1,NM+1):
    cc = lq.cell(r, MC(m), f"={ML(m)}{r_ib}+{ML(m)}{r_net}"); cc.number_format=NOK; cc.font=BLACKB
lq.cell(r,SUM28, f"={ML(24)}{r}").number_format=NOK; lq.cell(r,SUM28).font=BLACKB
r += 1
# fyll IB nå som r_ub kjent
for m in range(1,NM+1):
    f = f"={a_open}" if m==1 else f"={ML(m-1)}{r_ub}"
    cc = lq.cell(r_ib, MC(m), f); cc.number_format=NOK; cc.font=BLACK
mrow(r, "Margin mot minimumsbuffer", lambda m: f"={ML(m)}{r_ub}-{a_buf}", addsum=False); r += 2
ub_rng = f"{ML(1)}{r_ub}:{ML(24)}{r_ub}"

lq.cell(r,1,"Kontroll: UB des 2028 − (åpning + sum netto)").font = GREY
lq.cell(r,2, f"={ML(24)}{r_ub}-({a_open}+SUM({ML(1)}{r_net}:{ML(24)}{r_net}))").number_format=NOK
lq.cell(r,2).font = GREY
lq.cell(r,3,"skal være 0").font = GREY
r += 2

# ---- Forklaring ----
secbar(r, "SLIK LESER DU ARKET"); r += 1
for t in [
 "Motoren er den samme som ellers i boka: bemanning (D) → kapasitet → omsetning bokført (E). Det nye er TIMING — når pengene faktisk kommer inn (F) og går ut (G), måned for måned.",
 "LAVESTE KONTANTSALDO (øverst) er poenget: det dypeste punktet på UTGÅENDE SALDO-raden. Faller den under bufferen, lyser margin-raden negativt — da trengs tiltak FØR den måneden (tregere ansettelse, utsatt utbytte, kassekreditt).",
 "CASH-LAG: provisjonen tas ved OPPGJØR (senest 3 dg etter overtakelse). Fakturadato brukes som operativ cash-proxy (median 14d fra salg). Konservativt: bruk Plan (P75, 32d). Salgstid 89 dg (signert→solgt) er noe HELT ANNET — ikke bland dem.",
 "PRØV SPAKENE: cash-lag scenario 1/2/3 (Base/Plan/Stress); flytt utbyttemåneden; utsett en ansettelse (endre oppstartsmåned i D). Alt regner seg om.",
 "PLASSHOLDERE å fylle når kjent: bro sep–des 2026, overheng okt–des 2026, restskatt 2026, mva-andel av kostbase, engangsposter, og faktisk bankdato i deal-for-deal-registeret. Alt er gult.",
]:
    grey(r, t); lq.row_dimensions[r].height = max(15, 13*(len(t)//118+1)); r += 1
r += 1
secbar(r, "ANSETTELSESGATE Q1 2027 — ansett kun hvis ALLE fire er oppfylt innen 15.12.2026 (rådgiver)"); r += 1
for t in [
 "1. Utbyttet (850k) er FORMELT utsatt.",
 "2. Faktisk bankdato er avstemt for alle tilgjengelige oppgjør (deal-for-deal-registeret) — særlig de store.",
 "3. Plan-scenarioet (P75) viser minst 500k kontantbuffer ETTER ansettelsen — ELLER styret godkjenner eksplisitt 300k som midlertidig gulv.",
 "4. Kandidaten har signert, og forventet startdato gjør at rampen faktisk passer inn i modellen.",
 "Sekvensering, ikke bremsing: bevis ÉN stol først, så skaler. Full ramp krever definert finansiering 1,3–2,6M (Base→Stress) + margin — ikke før.",
 "BUFFERREGEL (din beslutning): 500k som normalregel, 300k kun som styregodkjent unntak. Sett verdien i «Minimumsbuffer» (blokk A). Hold regelen fast — ikke juster risikoen hver gang dere får lyst til å vokse.",
]:
    grey(r, t); lq.row_dimensions[r].height = max(15, 13*(len(t)//118+1)); r += 1

# ---- KPI-formler ----
lq.cell(kpi_low,2, f"=MIN({ub_rng})").number_format=NOK; lq.cell(kpi_low,2).font=RED
lq.cell(kpi_lowm,2, f"=INDEX({ML(1)}{hdrrow}:{ML(24)}{hdrrow},1,MATCH(MIN({ub_rng}),{ub_rng},0))").font=BLACKB
lq.cell(kpi_marg,2, f"=MIN({ub_rng})-{a_buf}").number_format=NOK; lq.cell(kpi_marg,2).font=BLACKB
lq.cell(kpi_under,2, f'=COUNTIF({ub_rng},"<"&{a_buf})').number_format=INT; lq.cell(kpi_under,2).font=BLACKB
lq.cell(kpi_kasse,2, f"=MIN({ub_rng})+{a_kasse}").number_format=NOK; lq.cell(kpi_kasse,2).font=RED
lq.cell(kpi_end,2, f"={ML(24)}{r_ub}").number_format=NOK; lq.cell(kpi_end,2).font=BLACKB

print("Likviditet bygget: FTE=%d bem=%d totbook=%d cashin=%d IB=%d UB=%d" % (r_fte,r_bem,r_totbook,r_cashin,r_ib,r_ub))


# ================= LES MEG (først i boka) =================
lm = wb.create_sheet("LES MEG", 0)
lm.sheet_view.showGridLines = False
lm.column_dimensions['A'].width = 118
lm['A1'] = "LES MEG — hele modellen forklart i klartekst"
lm['A1'].font = TITLE
tekst = [
    ("", None),
    ("HVA MODELLEN GJØR, I ÉN SETNING", "h"),
    ("Den oversetter resultatmålet ditt (1,5M → 3M → 5M før skatt) til: hvor mange båter som må selges, hvor mange meglere det krever, hva de koster, og hva dere derfor må gjøre hver uke. Charter holdes helt utenfor.", None),
    ("", None),
    ("FARGEKODENE", "h"),
    ("GUL celle med blå skrift = et VALG du kan endre — alt annet regner seg om automatisk.", None),
    ("Svart skrift = utregnet av modellen. Grønn skrift = hentet fra et annet ark. Rød = et gap/avvik du skal styre på.", None),
    ("", None),
    ("DE FEM TALLENE SOM STYRER ALT (alle i Forutsetninger)", "h"),
    ("1. INNTEKT PER SOLGT BÅT: 58 375 kr ex mva. Målt av oppgjørslistene dine: 4 378 153 kr provisjon delt på 75 solgte båter siste 12 mnd. Vil du ha 1 million mer i omsetning, må dere selge ca. 17 båter mer — eller øke dette tallet (dyrere båter / 6 %-disiplin).", None),
    ("2. OMSETNING PER MEGLER-STOL: 1,5M per år for en ferdig opplært megler. Tellemåten er KREDITERT omsetning (50/50-splitt når én henter og en annen selger — det lønna følger): Henrik 1,84M, Daniel 0,88M siste 12 mnd. 1,5M er plantallet ditt.", None),
    ("3. MEGLERKOST: 55 øre av hver megler-krone går til megleren (40 % provisjon + arbeidsgiveravgift + feriepenger). Firmaet beholder 45 øre FØR andre kostnader.", None),
    ("4. KOSTBASE: 1,88M i året dekker dagens drift (Marte, Philip, kontor, systemer, avskrivning). Vokser dere, vokser den TRINNVIS (fasit-basert fra kostnadsbudsjettet): +60k per megler utover 2 (parkering/lisenser/telefon), +75k engangs per nyansettelse, +900k salgsleder ved 5, +300k kontorutvidelse ved 6 (plassholder — sjekk leieavtalen), +500k backoffice ved 8.", None),
    ("5. DIN EGEN LØNN: kappet på 7,1G = 969 498 kr — pensjonsopptjeningstaket; over dette lønner utbytte seg. Antas å inkludere feriepenger (12 %) → grunnlønn ≈ 865 623 (Marius bekrefter). Alt du selger utover ca. 2,15M koster ikke firmaet mer lønn — din marginale omsetning er den mest lønnsomme i selskapet.", None),
    ("", None),
    ("SLIK REGNES ETT ÅR UT — 2027 MED TALL (følg med i Økonomimotor-arket)", "h"),
    ("STEG 1 — Hvem selger? Bemanningsplanen sier: 2 ferdige meglere ved nyttår + 3 nyansettelser (Q1, Q2, Q3). En nyansatt yter 40 % første kvartal, 75 % neste, så 100 % — empirien (Henrik nesten full fart i år 1, Daniel to år) sier profilen er persondrevet; dette er litt under snittet av de to. Regnet om blir det 3,61 «hele» meglere i snitt gjennom året (rad 15).", None),
    ("STEG 2 — Hva selger de? 3,61 meglere × 1,5M + deg selv (2,3M) = 7,72M omsetning (rad 21). Delt på 58 375 = ca. 132 båter (rad 22). Ganger 1,30 = ca. 172 oppdrag som må signeres, for erfaringen viser at ikke alle signerte selges (rad 23).", None),
    ("STEG 3 — Hva koster det? Meglerne: 55 % av deres 5,42M = 2,98M. Din lønn: 1,13M (7,1G + avgifter). Markedsføring: 6 600 kr × 172 oppdrag = 1,13M. Kostbase: 1,88M + 135k trinnkost + 225k rekruttering (3 ansettelser) + salgsleder 900k = 3,14M.", None),
    ("STEG 4 — Resultat: 7,72M − 2,98M − 1,13M − 1,13M − 3,14M = MINUS 666 000 (rad 28). Gapet mot målet på +1,5M er altså 2,2M (rad 29). DET er tallet som forteller at 2027-målet ikke nås med denne planen og dagens økonomi.", None),
    ("", None),
    ("HVA 2027-PLANEN FAKTISK ER (les dette høyt)", "h"),
    ("2027-planen er IKKE en plan for å nå 1,5M. Baseline gir −666k; spakene løfter ~944k til +278k — dere mangler fortsatt ca. 1,22M mot resultatmålet. 2027-planen er en plan for å: (1) absorbere Daniel-effekten, (2) bygge opp kapasitet, (3) BEVISE at spakene fungerer, (4) avslutte året med positivt resultat. Det er helt greit — men ikke forveksle «økonomisk vanntett» med «strategisk ferdig».", None),
    ("Spak-scenarioet gir +278k i 2027 under planlagt ramp. Resultatmålet på 1,5M krever høyere produksjon enn dagens innfasingsplan, eller bedre økonomi per båt enn scenarioforutsetningene. (Merk: 3,7 producing FTE er et STEADY-STATE-behov; i innfasingsåret leverer dere 3,61 FTE, og derfor blir resultatet lavere enn 1,5M — ikke bland de to.)", None),
    ("Neste beslutning er derfor ikke «skal vi vokse?», men «har vi nok cash til å finansiere rampen, og hvilke spaker må bevises før neste ansettelse?». Svaret ligger nå i Likviditet-arket — se laveste kontantsaldo under rampen.", None),
    ("", None),
    ("HVORFOR STÅR DET SÅ STORE TALL UNDER «BEHOV»?", "h"),
    ("Behov-delen svarer på motsatt spørsmål: hva MÅTTE omsetningen vært for å nå målet? Her ligger felle nr. 1 som rådgiveren fant: flere meglere → høyere kostbase → enda mer omsetning trengs → enda flere meglere. Modellen løser det nå ved å regne tre scenarioer (uten leder / med leder / med leder+backoffice) og velge det som henger sammen med sitt eget antall stoler. Svaret for 2027: ca. 18M omsetning og 10,5 producing FTE ≈ 11 bemannede meglere (12 med buffer). NB: FTE er produksjonskapasitet, ikke personer — i et innfasingsår trengs flere bemannede enn FTE fordi nyansatte yter 40–100 %. Uansett: veien til målet er IKKE antall hoder, men bedre økonomi per båt (se Spaker).", None),
    ("", None),
    ("SPAKER-ARKET — DEN REALISTISKE VEIEN", "h"),
    ("Samme bemanningsplan, men med: 6 %-provisjon håndhevet + dyrere båter i snitt (76 800/båt), markedskost ned til 4 552, og stoler som leverer 1,8M. Da blir resultatet ca. +0,3M i 2027, +1,8M i 2029 og +3,7M i 2031 — uten én ekstra ansettelse utover planen. Konklusjon: spakene er verdt mer enn nye stoler, og de bør trekkes FØR dere rekrutterer bredt.", None),
    ("", None),
    ("HVA ER FAKTA, HVA ER ANTAKELSER, HVA ER PROXY?", "h"),
    ("FAKTA (fasit): 58 375/båt, 75 båter, per-megler-tall, salgstid 89 dg, kohorten. Kilde: oppgjørslistene + HubSpot, definert per rad i Forutsetninger.", None),
    ("PLANANTAKELSE (gule celler — dine valg): 1,30 oppdrag/salg (målt 1,38 på modne), stol = 1,5M, ramp-profilen, alle trinnkostene, 2,3M til deg selv.", None),
    ("PROXY (midlertidig tall til det er målt): 68 % «befaring→signering» er egentlig vinnraten i hele Pipeline A. 50 % prospect→befaring er et plantall. Begge byttes ut når de er målt separat — de står på Mangler-listen.", None),
    ("", None),
    ("SLIK FINNER DU FEIL SELV (kontrollpunktene)", "h"),
    ("1. Økonomimotor rad 38: snittet av kvartals-FTE-ene skal være lik årets FTE (rad 15), og kvartalsomsetningene skal summere til rad 21.", None),
    ("2. P&L-linjene (rad 21 og 24–27) skal alltid summere nøyaktig til resultatet i rad 28 — det er hele regnestykket, ingenting er skjult.", None),
    ("3. Historikk-arket: fasit-tallene skal stemme mot oppgjørslistene dine, og resultatbroen mot årsregnskapet (rest på 705k skal avstemmes med Marius).", None),
    ("4. Endrer du en gul celle og et tall IKKE beveger seg som du forventer — da har enten du eller modellen misforstått noe. Si fra.", None),
    ("", None),
    ("HVA SOM STYRES HVOR", "h"),
    ("Ukentlig drift: Weekly Scorecard (H2-rest-målet: 126 330 kr/uke). Kvartal: kvartalsmålene i Økonomimotor. Året/strategien: resultat-gapet og rekrutteringsgapet i 1-3-5 Plan. Rådgivers vurdering: H2-delen er klar til bruk; 2027–2031 er retningsgivende til trinnkostene er kalibrert og proxyene målt.", None),
]
r = 3
for t, kind in tekst:
    if t == "":
        r += 1; continue
    c = lm.cell(row=r, column=1, value=t)
    if kind == "h":
        c.font = BLACKB
        lm.cell(row=r, column=1).fill = SEC_FILL
    else:
        c.font = BLACK
        c.alignment = Alignment(wrap_text=True, vertical="top")
        lm.row_dimensions[r].height = max(15, 14 * (len(t) // 115 + 1))
    r += 1

import os as _o
_out=_o.path.join(_o.path.dirname(_o.path.abspath(__file__)),"HoY-1-3-5-arsplan.xlsx")
wb.save(_out)
print("saved v11 ->",_out)
