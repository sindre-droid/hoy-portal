// ── prospekt-translate-prompt.js ─────────────────────────────────────────────
// Faste ordbøker + system-prompt for oversettelse av prospekter.
//
// Prinsipp (Sindre 29. sep 2026):
//   • Norsk er alltid sannhetskilden. Engelsk er en avledet, godkjennbar kopi.
//   • Alt som er FAST (spec-labels, kategorinavn, egenerklæringens spørsmål,
//     Ja/Nei) oversettes deterministisk her — aldri av modellen.
//   • Bare fritekst (salgstekst, utstyrsrader, service, selgers kommentarer,
//     bildetekster, fritekstsider) går gjennom Claude, med streng prompt.
//   • Egenerklæringen vises på engelsk som "unofficial translation" — det
//     norske signerte Oneflow-dokumentet gjelder. Teksten for det ligger i
//     prospekt/i18n.js (visning), ikke her.
// ─────────────────────────────────────────────────────────────────────────────

// ── Specs (buildSpecs i prospekt.js) ─────────────────────────────────────────
const SPEC_LABELS = {
  'Merke':        'Make',
  'Modell':       'Model',
  'Årsmodell':    'Model year',
  'Lengde':       'Length',
  'Bredde':       'Beam',
  'Motor':        'Engine',
  'Motortype':    'Drive type',
  'Effekt':       'Power',
  'Maks fart':    'Max speed',
  'Drivstoff':    'Fuel',
  'Materiale':    'Hull material',
  'Farge':        'Colour',
  'Timer':        'Engine hours',
  'CE-kategori':  'CE category',
  'MVA':          'VAT',
  'Beliggenhet':  'Location',
  // Manuelt lagt til av megler — vanlige varianter
  'Vekt':         'Displacement',
  'Dypgang':      'Draft',
  'Drivstofftank': 'Fuel tank',
  'Vanntank':     'Water tank',
  'Septiktank':   'Holding tank',
  'Generator':    'Generator',
  'Skrogtype':    'Hull type',
  'Byggeår':      'Year built',
};

// Kjente enum-verdier (HubSpot-dropdowns + type_motor)
const SPEC_VALUES = {
  'Bensin':        'Petrol',
  'Diesel':        'Diesel',
  'Elektrisitet':  'Electric',
  'Annet':         'Other',
  'Glassfiber':    'GRP (fibreglass)',
  'Aluminium':     'Aluminium',
  'Plast':         'Plastic',
  'Tre':           'Wood',
  'Innenbords':    'Inboard',
  'Utenbords':     'Outboard',
  'Drev':          'Sterndrive',
  'Strak aksling': 'Shaft drive',
  'IPS (volvo)':   'Volvo IPS',
  'Zeus pod (cummins/mercruiser)': 'Zeus pod (Cummins/Mercruiser)',
  'Ja':            'Yes',
  'Nei':           'No',
};

// Enhets-/prefikstransformasjoner på spec-verdier (tall beholdes uendret)
function translateSpecValue(value) {
  if (value === null || value === undefined) return value;
  let v = String(value);
  if (SPEC_VALUES[v.trim()]) return SPEC_VALUES[v.trim()];
  v = v.replace(/(\d)\s*fot\b/g, '$1 ft')
       .replace(/\bknop\b/g, 'knots')
       .replace(/(\d)\s*hk\b/g, '$1 hp')
       .replace(/\bca\.\s*/g, 'approx. ');
  return v;
}

const CAPACITY_LABELS = {
  'Kahytter':      'Cabins',
  'Soveplasser':   'Berths',
  'Bad/WC':        'Heads',
  'Drivstofftank': 'Fuel tank',
  'Vanntank':      'Water tank',
  'Septiktank':    'Holding tank',
  'Køyer':         'Berths',
};

// ── Utstyrskategorier (EQUIP_CATEGORIES_* i prospekt.js) ─────────────────────
const EQUIP_CATEGORY_NAMES = {
  'Navigasjon og elektronikk': 'Navigation & electronics',
  'Motor og teknisk':          'Engine & technical',
  'Dekk og eksteriør':         'Deck & exterior',
  'Interiør og komfort':       'Interior & comfort',
  'Sikkerhet':                 'Safety',
  'Rigg og seil':              'Rig & sails',
};

// ── Egenerklæring (DECL_SECTIONS_SPEC i prospekt.js) ─────────────────────────
const DECL_SECTION_TITLES = {
  'Båt':             'Boat',
  'Motor & Teknisk': 'Engine & technical',
};

const DECL_QUESTIONS = {
  'Ble båten kjøpt ny?':                               'Was the boat bought new?',
  'Har båten vært utleid eller yrkesbrukt?':           'Has the boat been chartered or used commercially?',
  'Har båten vært skadet/reparert?':                   'Has the boat been damaged or repaired?',
  'Har båten grunnstøtt?':                             'Has the boat run aground?',
  'Er båten omlakkert/malt?':                          'Has the boat been repainted?',
  'Er båten selvbygget/selvinnredet?':                 'Is the boat home-built or home-fitted?',
  'Har båten feil/svakheter/lekkasjer i skrog?':       'Any faults, weaknesses or leaks in the hull?',
  'Har båten feil/svakheter/lekkasjer i overbygg?':    'Any faults, weaknesses or leaks in the superstructure?',
  'Har båten hatt råteskader/fuktskader?':             'Has the boat had rot or moisture damage?',
  'Har båten blærer i gelcoat under vannlinjen?':      'Any gelcoat blisters (osmosis) below the waterline?',
  'Har båten skader/sår under vannlinjen?':            'Any damage below the waterline?',
  'Har motor/båt vært under vann?':                    'Has the engine or boat been submerged?',
  'Har båten feil på skroggjennomføringer?':           'Any faults with through-hull fittings?',
  'Er båten CE-merket?':                               'Is the boat CE marked?',
  'Er båten registrert i skipsregisteret?':            'Is the boat registered in the Norwegian Ship Register (NOR)?',
  'Er båten registrert i småbåtregisteret?':           'Is the boat registered in the Norwegian Small Craft Register?',
  'Er det lån på båten?':                              'Is there a loan or lien on the boat?',
  'Er båten Securemark-merket?':                       'Is the boat Securemark marked?',
  'Har båten feil på motor?':                          'Any faults with the engine?',
  'Har båten feil på dynamo eller batterier?':         'Any faults with the alternator or batteries?',
  'Har båten feil på drev/aksling/propell?':           'Any faults with the drive, shaft or propeller?',
  'Har motoren unormalt oljeforbruk?':                 'Does the engine have abnormal oil consumption?',
  'Har båten lekkasjer i vannsystemer/septik?':        'Any leaks in the water systems or holding tank?',
  'Har båten feil på elektrisk anlegg?':               'Any faults with the electrical system?',
  'Har båten lekkasjer på drivstoffsystem?':           'Any leaks in the fuel system?',
  'Har båten feil på lensepumper/ventiler?':           'Any faults with bilge pumps or seacocks?',
  'Har båten problemer med tæring?':                   'Any corrosion problems?',
  'Siste service på motor, dato/timer?':               'Last engine service, date/hours?',
  'Driftstimer motor?':                                'Engine hours?',
  'Driftstimer generator?':                            'Generator hours?',
};

const DECL_ANSWERS = { 'Ja': 'Yes', 'Nei': 'No', 'Vet ikke': "Don't know", 'Ukjent': 'Unknown' };

// ── System-prompt for fritekst ───────────────────────────────────────────────
const SYSTEM_PROMPT = `YOU ARE:
A translator for House of Yachts, a Norwegian yacht brokerage. You translate
sales-prospectus text from Norwegian (bokmål) to British English for
international buyers of premium used boats.

════════════════════════════════════════════════════════════════
ABSOLUTE RULES — READ FIRST
════════════════════════════════════════════════════════════════

1. Translate ONLY. Never add, remove, soften, strengthen or "improve" a fact.
   If the Norwegian says a hull has been repaired, the English says so with the
   same weight. If something is vague in Norwegian, keep it equally vague.
2. Numbers, dates, hours, prices, years, model names, brand names, part
   numbers and proper nouns are copied EXACTLY. "2 490 000" stays "2 490 000".
   "kr" stays "kr". "NOK" stays "NOK". Never convert currency or units.
3. Preserve structure character-for-character where it carries meaning:
   • Line breaks (\\n) stay where they are — one Norwegian line = one English line.
   • Service-history lines have the form "MM.YYYY — Vendor: description (kr 12 345)".
     Keep the date, the em-dash, the vendor name, the colon and the "(kr …)"
     cost marker exactly. Translate only the description.
   • HTML: keep every tag, attribute and entity untouched. Translate only the
     text between tags. Do not reflow, wrap or reformat the HTML.
4. Keep the register: understated, professional, brokerage tone. No marketing
   superlatives that are not in the source. No exclamation marks unless present.
5. If a segment is already English or is a pure name/number, return it unchanged.
6. Never explain, comment or apologise. Output is data, not prose.

════════════════════════════════════════════════════════════════
BOAT TERMINOLOGY (use these)
════════════════════════════════════════════════════════════════

bunnsmurt → antifouled · bunnstoff → antifouling · polert → polished
drev → sterndrive · aksling → shaft · hekkaggregat → sterndrive
baugpropell → bow thruster · hekkpropell → stern thruster
kalesje → canopy · sprayhood → sprayhood · bimini → bimini
badeplattform → bathing platform · badestige → boarding ladder
landstrøm → shore power · lader → battery charger · inverter → inverter
varmer (Webasto/Eberspächer) → diesel heater · varmtvannsbereder → water heater
septik / septiktank → holding tank · lensepumpe → bilge pump · sjøvannsinntak → seacock
skroggjennomføring → through-hull fitting · gelcoat → gelcoat · osmose → osmosis
ekkolodd → fishfinder/echo sounder · kartplotter → chartplotter · AIS → AIS
impeller → impeller · registerreim → timing belt · dynamo → alternator
driftstimer → engine hours · timer → hours · knop → knots · hk → hp · fot → ft
kahytt → cabin · soveplasser → berths · bad/WC → heads · salong → saloon
styrhus → wheelhouse · flybridge → flybridge · cockpit → cockpit · dørk → sole
fortøyning → mooring lines · fender → fenders · anker(vinsj) → anchor (windlass)
vinterlagring → winter storage · opplag → laid up ashore · båtplass → berth
tilstandsrapport → condition survey · befaring → inspection/viewing
visning → viewing · prisantydning → asking price · oppdrag → listing
egenerklæring → seller's declaration · selger → seller · kjøper → buyer
mva → VAT · fradragsberettiget mva → VAT deductible · ikke fradragsberettiget → VAT not deductible (VAT paid)
mva-fritt / uten mva → ex. VAT

Use British spelling (colour, harbour, metres) except in brand/model names.

════════════════════════════════════════════════════════════════
INPUT / OUTPUT FORMAT (CRITICAL)
════════════════════════════════════════════════════════════════

You receive a JSON object: { "<key>": "<Norwegian text>", ... }.
Keys are opaque identifiers. Do not interpret, rename, reorder or drop them.

Respond with ONLY a JSON object with EXACTLY the same keys and the English
text as values. No markdown fences, no commentary, nothing before or after
the JSON. Every key in the input MUST appear in the output.`;

module.exports = {
  SYSTEM_PROMPT,
  SPEC_LABELS,
  SPEC_VALUES,
  translateSpecValue,
  CAPACITY_LABELS,
  EQUIP_CATEGORY_NAMES,
  DECL_SECTION_TITLES,
  DECL_QUESTIONS,
  DECL_ANSWERS,
};
