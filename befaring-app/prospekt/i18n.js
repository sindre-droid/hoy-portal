// ── prospekt/i18n.js ─────────────────────────────────────────────────────────
// Faste UI-tekster i prospektvisningen (public.html + render.html).
// Språk velges med ?lang=en i URL-en; alt annet er norsk.
// Innholdet (salgstekst, utstyr, service, egenerklæring) oversettes server-side
// (prospekt-translate.js) — her ligger bare rammeverket rundt.
// ─────────────────────────────────────────────────────────────────────────────
(function () {
  const params = new URLSearchParams(window.location.search);
  const lang = (params.get('lang') || 'no').toLowerCase() === 'en' ? 'en' : 'no';

  const STRINGS = {
    no: {
      htmlLang: 'no',
      loading: 'Henter prospektet…',
      errTitle: 'Prospektet er ikke tilgjengelig',
      errBody: 'Dette prospektet finnes ikke eller er ikke publisert ennå.',
      errContact: 'Kontakt oss på',
      errContactTail: 'for spørsmål.',
      errMissingId: 'Mangler prospekt-ID i URL',
      downloadPdf: 'Last ned PDF',
      titleSuffix: 'House of Yachts',

      // Sidelabels
      lblCover: 'Forside', lblOverview: 'Oversikt', lblGallery: 'Bildegalleri', lblEquipment: 'Utstyrsliste',
      lblService: 'Servicehistorikk', lblServiceCont: 'Servicehistorikk (forts.)',
      lblDeclaration: 'Egenerklæring', lblDeclarationCont: 'Egenerklæring (forts.)',
      lblFreetext: 'Fritekst', lblContact: 'Kontakt',

      // Forside / co-brand
      cobrandWith: 'i samarbeid med',
      metaYear: 'Modellår', metaHours: 'Timer', metaLength: 'Lengde', metaPrice: 'Pris',
      salesDoc: 'Salgsoppgave',
      priceSuffix: ',-',
      viewingAndContact: 'Visning og kontakt',
      bookViewingHtml: 'Bestill <em>privat visning</em>',
      brokerRole: 'Båtmegler', brokerRoleShort: 'Megler',
      office: 'Kontor',

      // Oversikt
      askingPrice: 'Prisantydning',
      specifications: 'Spesifikasjoner',
      capacities: 'Kapasiteter',

      // Galleri
      galleryTitle: 'Bildegalleri',

      // Utstyr
      equipmentTitle: 'Utstyr og spesifikasjoner',
      equipmentSubtitle: 'Komplett oversikt over utstyr og tilbeh&oslash;r',
      cont: '(forts.)',

      // Service
      svcCondition: 'Tilstandsoppsummering', svcHistory: 'Servicehistorikk',
      svcUpgrades: 'Nylige oppgraderinger', svcNotes: 'Anmerkninger',
      serviceTitle: 'Servicehistorikk',
      serviceSubtitle: 'Dokumentert vedlikehold og tilstand',
      serviceContinued: 'Servicehistorikk, fortsettelse',
      continuesNext: 'Fortsetter neste side',
      serviceDisclaimer: '',

      // Egenerklæring
      declEyebrow: 'Dokumentasjon',
      declTitle: 'Selgers egenerklæring',
      declLede: 'Utfylt og signert av eier. Opplysningene gis i god tro og etter beste evne.',
      declContinued: 'Selgers egenerklæring, fortsettelse',
      declMetaTitle: 'Opplysninger oppgitt av selger',
      declOtherNotes: 'Andre merknader',
      declNotice: 'Egenerklæringen er signert digitalt av selger via Oneflow. Originaldokumentet er tilgjengelig ved forespørsel til ansvarlig megler. Opplysningene erstatter ikke en uavhengig tilstandsvurdering.',
      declTranslationBanner: '',
      declOriginalPrefix: 'Original:',
      metaMake: 'Merke', metaModelYear: 'Årsmodell', metaBought: 'Kjøpt år', metaHin: 'HIN / CIN-nr.',
      metaEngineNo: 'Motornummer', metaRegNo: 'Registreringsnr.', metaListingNo: 'Oppdragsnr.',

      // Kontakt
      interested: 'Interessert?',
      contactLede: 'Ta kontakt for visning eller ytterligere informasjon om dette fart&oslash;yet. Vi er tilgjengelige for sp&oslash;rsm&aring;l og arrangerer gjerne en uforpliktende befaring.',
      aboutTitle: 'Om House of Yachts',
      aboutText: 'House of Yachts er et b&aring;tmeglerfirma i Oslofjord-regionen som spesialiserer seg p&aring; kj&oslash;p og salg av brukte fritidsb&aring;ter i premium-segmentet. Vi tilbyr full-service megling med profesjonell fotografering, markedsf&oslash;ring, visninger og trygg oppgj&oslash;rsh&aring;ndtering.',
      ctaDefault: 'Besøk oss for visning',
      footerDisclaimer: '',
    },

    en: {
      htmlLang: 'en',
      loading: 'Loading prospectus…',
      errTitle: 'This prospectus is not available',
      errBody: 'This prospectus does not exist, is not published yet, or is not available in English.',
      errContact: 'Contact us at',
      errContactTail: 'with any questions.',
      errMissingId: 'Missing prospectus ID in URL',
      downloadPdf: 'Download PDF',
      titleSuffix: 'House of Yachts',

      lblCover: 'Cover', lblOverview: 'Overview', lblGallery: 'Gallery', lblEquipment: 'Equipment',
      lblService: 'Service history', lblServiceCont: 'Service history (cont.)',
      lblDeclaration: "Seller's declaration", lblDeclarationCont: "Seller's declaration (cont.)",
      lblFreetext: 'Text', lblContact: 'Contact',

      cobrandWith: 'in partnership with',
      metaYear: 'Model year', metaHours: 'Hours', metaLength: 'Length', metaPrice: 'Price',
      salesDoc: 'Prospectus',
      priceSuffix: '',
      viewingAndContact: 'Viewing and contact',
      bookViewingHtml: 'Book a <em>private viewing</em>',
      brokerRole: 'Yacht broker', brokerRoleShort: 'Broker',
      office: 'Office',

      askingPrice: 'Asking price',
      specifications: 'Specifications',
      capacities: 'Capacities',

      galleryTitle: 'Gallery',

      equipmentTitle: 'Equipment and specifications',
      equipmentSubtitle: 'Complete overview of equipment and accessories',
      cont: '(cont.)',

      svcCondition: 'Condition summary', svcHistory: 'Service history',
      svcUpgrades: 'Recent upgrades', svcNotes: 'Notes',
      serviceTitle: 'Service history',
      serviceSubtitle: 'Documented maintenance and condition',
      serviceContinued: 'Service history, continued',
      continuesNext: 'Continues on next page',
      serviceDisclaimer: 'Compiled from documentation supplied by the seller and translated from Norwegian. Not independently verified by House of Yachts. Original invoices and service records are available on request.',

      declEyebrow: 'Documentation',
      declTitle: "Seller's declaration",
      declLede: 'Completed and signed by the owner. Information is given in good faith and to the best of their knowledge.',
      declContinued: "Seller's declaration, continued",
      declMetaTitle: 'Details provided by the seller',
      declOtherNotes: 'Other remarks',
      declNotice: "The seller's declaration was signed digitally by the seller via Oneflow, in Norwegian. This English version is an unofficial translation provided for information only; the signed Norwegian original prevails and is available on request from the responsible broker. The declaration does not replace an independent condition survey.",
      declTranslationBanner: 'Unofficial translation — the signed Norwegian original prevails.',
      declOriginalPrefix: 'Original (Norwegian):',
      metaMake: 'Make', metaModelYear: 'Model year', metaBought: 'Year purchased', metaHin: 'HIN / CIN no.',
      metaEngineNo: 'Engine no.', metaRegNo: 'Registration no.', metaListingNo: 'Listing no.',

      interested: 'Interested?',
      contactLede: 'Get in touch for a viewing or further information about this vessel. We are happy to answer questions and arrange a no-obligation inspection.',
      aboutTitle: 'About House of Yachts',
      aboutText: 'House of Yachts is a yacht brokerage in the Oslofjord region of Norway, specialising in the sale of premium used leisure boats. We offer full-service brokerage with professional photography, marketing, viewings and secure handling of the transaction.',
      ctaDefault: 'Visit us for a viewing',
      footerDisclaimer: 'This prospectus is an English translation of the Norwegian original. All information is provided by the seller and has not been independently verified by House of Yachts. Prices are in NOK. In case of discrepancy, the Norwegian version prevails.',
    },
  };

  window.PROSPEKT_LANG = lang;
  window.PROSPEKT_T = STRINGS[lang];
  window.t = (key) => (STRINGS[lang][key] !== undefined ? STRINGS[lang][key] : (STRINGS.no[key] ?? key));
  document.documentElement.setAttribute('lang', STRINGS[lang].htmlLang);
})();
