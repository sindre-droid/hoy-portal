// ── dashboard-state.js ───────────────────────────────────────────────────────
// Ett felles datalag for HoY-kommandosentralen: samler North Star, motor, spaker,
// KPI-scorecard og likviditet til ÉN JSON, materialisert nattlig i Supabase
// (dashboard_state) og lest av portal-cockpit + delbart styre-snapshot.
//
// Kilder: Supabase (settlements, brokers, budgets_company, po_liquidity_snapshot),
// HubSpot (Pipeline A «Seller Acquisition» + B «Listing/Sale»), PowerOffice (resultat YTD).
// Hver kilde i egen try/catch med ok-flagg + kvalitetsnote → degraderer pent.
//
// Actions (admin): GET ?action=get (siste lagrede state) · POST ?action=rebuild
// ─────────────────────────────────────────────────────────────────────────────
const core = require('./poweroffice-sync.js');
const { supabase, po, setSyncState } = core;

const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization' };
function parseJwt(t){try{const b=t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(Buffer.from(b,'base64').toString('utf8'));}catch{return null;}}
function verifyAdmin(e){const a=(e.headers.authorization||'').replace(/^Bearer\s+/i,'');if(!a)return{ok:false,status:401,error:'Ikke autentisert'};const j=parseJwt(a);if(!j)return{ok:false,status:401,error:'Ugyldig token'};if(!((j.app_metadata?.roles)||[]).includes('admin'))return{ok:false,status:403,error:'Kun admin'};return{ok:true,email:j.email};}

// ── Verifisert likviditetsmodell (JS-port av Likviditet-arket, diff 0 vs Excel) ──
const LM = {
  INNT:58375,STOL:1500000,SINDRE:2300000,MKOST:0.55,VAT:0.25,G71:969498,LOAD:1.165,SATS:0.45,
  GRUNN:1880000,TRINN:60000,REKR:75000,KONTOR:300000,LEDER:900000,BACK:500000,MK:6600,RATIO:1.30,VATSHARE:0.35,
  r1:0.40,r2:0.75,r3:1.00,
  seas:[0.030,0.0524,0.0874,0.0554,0.1728,0.2095,0.1457,0.0554,0.0816,0.0340,0.0447,0.0311],
  profiles:{1:[0.54,0.30,0.10,0.03,0.03],2:[0.30,0.40,0.20,0.07,0.03],3:[0.10,0.25,0.40,0.20,0.05]},
  overheng:{0:155000,'-1':225000,'-2':170000},mklead:3,
  AVSTEM:1360037, KASSE:200000, BUFFER:500000,
};
const SETTLE={4:[1,2],6:[3,4],8:[5,6],10:[7,8],12:[9,10],14:[11,12],16:[13,14],18:[15,16],20:[17,18],22:[19,20],24:[21,22]};
const MNS=['jan','feb','mar','apr','mai','jun','jul','aug','sep','okt','nov','des'];
function _fac(s,m){if(s===''||s==null)return 0;if(m<s)return 0;const g=m-s;return g<3?LM.r1:(g<6?LM.r2:LM.r3);}
function liq(inp){
  const P=LM.profiles[inp.scen],sf=m=>LM.seas[(m-1)%12]*12,tot=[],meg=[],brk=[],mkt=[],kbm=[],ci=[];
  const bem=m=>inp.hires.filter(s=>s!==''&&s!=null&&s<=m).length;
  const kbY=e=>LM.GRUNN+LM.TRINN*Math.max(0,e-2)+(e>=5?LM.LEDER:0)+(e>=6?LM.KONTOR:0)+(e>=8?LM.BACK:0);
  const kb27=kbY(bem(12)),kb28=kbY(bem(24)),sc=Math.min(LM.SATS*LM.SINDRE,LM.G71)*LM.LOAD/12;
  for(let m=1;m<=24;m++){const f=inp.hires.reduce((a,s)=>a+_fac(s,m),0);meg[m]=f*LM.STOL/12*sf(m);tot[m]=meg[m]+LM.SINDRE/12*sf(m);kbm[m]=(m<=12?kb27:kb28)/12;}
  const bAt=j=>j>=1?tot[j]:(LM.overheng[j]!==undefined?LM.overheng[j]:0);
  for(let m=1;m<=24;m++){let c=0;for(let k=0;k<5;k++)c+=bAt(m-k)*(1+LM.VAT)*P[k];ci[m]=c;brk[m]=meg[m]*LM.MKOST;mkt[m]=tot[Math.min(24,m+LM.mklead)]/LM.INNT*LM.RATIO*LM.MK;}
  let sB=0,sBr=0,sM=0;for(let m=1;m<=12;m++){sB+=tot[m];sBr+=brk[m];sM+=mkt[m];}
  const skatt27=0.22*Math.max(0,sB-sBr-12*sc-sM-kb27);
  const vat=[];for(let m=1;m<=24;m++)vat[m]=LM.VAT*tot[m]-LM.VAT*(mkt[m]+LM.VATSHARE*kbm[m]);
  const eng=inp.engangs,eAt=m=>eng.reduce((a,e)=>a+((e.maaned===m&&e.belop)?e.belop:0),0),onb=m=>inp.hires.filter(s=>s===m).length*LM.REKR;
  let ib=inp.opening,lo=Infinity,loM=0;const UB=[];
  for(let m=1;m<=24;m++){let mv=0;if(SETTLE[m])mv=vat[SETTLE[m][0]]+vat[SETTLE[m][1]];let tx=0;if(m===14||m===16)tx+=skatt27/2;
    ib=ib+ci[m]-(brk[m]+sc+kbm[m]+onb(m)+mkt[m]+mv+tx+eAt(m));UB[m]=ib;if(ib<lo){lo=ib;loM=m;}}
  return{laveste:Math.round(lo),lavesteLabel:MNS[(loM-1)%12]+' '+(27+(loM>12?1:0)),slutt:Math.round(UB[24]),UB:UB.slice(1).map(Math.round)};
}

async function hubspotSearch(pipelineId, extraFilters, after){
  const tok=process.env.HUBSPOT_TOKEN; if(!tok) throw new Error('HUBSPOT_TOKEN mangler');
  const body={filterGroups:[{filters:[{propertyName:'pipeline',operator:'EQ',value:pipelineId},...(extraFilters||[])]}],properties:['dealstage','createdate','amount'],limit:100,after};
  const r=await fetch('https://api.hubapi.com/crm/v3/objects/deals/search',{method:'POST',
    headers:{Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error('HubSpot '+r.status+' '+(await r.text()).slice(0,120));
  return r.json();
}
async function hubspotFunnel(pipelineId){
  let after,total=0,byStage={},created30=0,created7=0;
  const now=Date.now(),d30=now-30*864e5,d7=now-7*864e5;
  for(let i=0;i<12;i++){
    const j=await hubspotSearch(pipelineId,[],after);
    for(const d of (j.results||[])){total++;const st=d.properties.dealstage||'?';byStage[st]=(byStage[st]||0)+1;
      const c=Date.parse(d.properties.createdate||'');if(c>=d30)created30++;if(c>=d7)created7++;}
    if(j.paging?.next?.after) after=j.paging.next.after; else break;
  }
  return{total,byStage,created30,created7};
}

async function buildDashboardState(sb){
  const now=new Date(),year=now.getFullYear(),monthsElapsed=now.getMonth()+1;
  const state={meta:{built_at:now.toISOString(),year,sources:{}},
    north_star:{}, motor:{}, spaker:{}, kpi_scorecard:{}, likviditet:{}};

  // ---- Plan-konstanter (motor + North Star-mål) ----
  state.north_star.targets={resultat_for_skatt:{2027:1500000,2029:3000000,2031:5000000},
    kilde:'1-3-5-plan (LES MEG / Økonomimotor)'};
  state.motor={inntekt_per_bat:LM.INNT,stol_rate:LM.STOL,sindre_rate:LM.SINDRE,meglerkost_pct:LM.MKOST,
    kostbase_grunn:LM.GRUNN,ramp:[LM.r1,LM.r2,LM.r3],
    kapasitet_resultat:{'2':-666000,'5':87000,'8':1270000},note:'bemanning 2→5→8 stoler'};

  // ---- Settlements → kreditert/salg (inneværende år) ----
  try{
    const {data:settl}=await sb.from('settlements').select('sold_date,sale_amount,commission,revenue_ex_vat,sold_by,commission_pct,lifecycle_status');
    const y=(settl||[]).filter(x=>(x.sold_date||'').startsWith(String(year)));
    const rev=y.reduce((a,x)=>a+(x.revenue_ex_vat||0),0);
    const sales=y.map(x=>x.sale_amount).filter(Boolean);
    const perb={}; for(const x of y){const k=(x.sold_by||'ukjent');perb[k]=(perb[k]||0)+(x.revenue_ex_vat||0);}
    // effektiv provisjonsgrad + disiplin (commission inkl mva / salgssum)
    const disc=y.filter(x=>x.sale_amount&&x.commission);
    const under6=disc.filter(x=>(x.commission/x.sale_amount)<0.06).length;
    state.north_star.revenue_ytd_kreditert=Math.round(rev);
    state.north_star.salg_ytd=y.length;
    state.north_star.per_broker=Object.fromEntries(Object.entries(perb).map(([k,v])=>[k,Math.round(v)]));
    state.spaker.premium_miks={snittbat_ytd:sales.length?Math.round(sales.reduce((a,b)=>a+b,0)/sales.length):null,mal:1600000};
    state.spaker.provisjonsdisiplin={salg_under_6pct:under6,av_totalt:disc.length,
      andel:disc.length?Math.round(100*under6/disc.length):null,note:'effektiv grad = provisjon/salgssum'};
    state.meta.sources.settlements={ok:true,rows:y.length};
  }catch(e){state.meta.sources.settlements={ok:false,error:e.message};}

  // ---- Budsjett (mål per måned) — NB kan være før Daniel-revisjon ----
  try{
    const {data:bud}=await sb.from('budgets_company').select('period_year,period_month,target_revenue_nok,target_sales_count,target_mandates_in');
    const by=(bud||[]).filter(r=>r.period_year===year);
    state.north_star.revenue_ytd_mal=Math.round(by.filter(r=>r.period_month<=monthsElapsed).reduce((a,r)=>a+(r.target_revenue_nok||0),0));
    state.north_star.revenue_helar_mal=Math.round(by.reduce((a,r)=>a+(r.target_revenue_nok||0),0));
    if(state.north_star.revenue_ytd_kreditert!=null&&state.north_star.revenue_ytd_mal)
      state.north_star.revenue_ytd_pct=Math.round(100*state.north_star.revenue_ytd_kreditert/state.north_star.revenue_ytd_mal);
    state.meta.sources.budsjett={ok:true,note:'budgets_company — kontroller at det er revidert budsjett'};
  }catch(e){state.meta.sources.budsjett={ok:false,error:e.message};}

  // ---- Likviditet fra snapshot + verifisert modell ----
  try{
    const {data:sn}=await sb.from('po_liquidity_snapshot').select('*').order('snapshot_date',{ascending:false}).limit(1);
    const s=sn&&sn[0]?sn[0]:null;
    const bank1920=s?(s.bank_drift||0):-290763;
    const opening=Math.round(bank1920+LM.AVSTEM);
    // beslutte-scenario: 0 nye ansettelser, utbytte utsatt (dagens beslutning)
    const hires=[-6,-6],eng=[{belop:0,maaned:9},{belop:125000,maaned:11},{belop:50000,maaned:10}];
    const scen={};for(const k of [1,2,3]){const r=liq({scen:k,hires,engangs:eng,opening});scen[['','base','plan','stress'][k]]={laveste:r.laveste,label:r.lavesteLabel,slutt:r.slutt};}
    state.likviditet={snapshot_date:s?s.snapshot_date:null,
      reell_bank:opening,hovedbok_1920:Math.round(bank1920),avstemmingsdiff:LM.AVSTEM,
      kundefordringer:s?Math.round(s.kundefordringer_openitems||s.kundefordringer||0):null,
      leverandorgjeld:s?Math.round(s.leverandorgjeld||0):null,mva_posisjon:s?Math.round(s.mva_posisjon||0):null,
      kassekreditt:LM.KASSE,buffer:LM.BUFFER,
      scenarioer:scen, plan_UB:liq({scen:2,hires,engangs:eng,opening}).UB,
      gate:{buffer:LM.BUFFER,laveste_plan:scen.plan.laveste,
        status:scen.plan.laveste>=LM.BUFFER?'GRØNT (tall)':(scen.plan.laveste>=0?'GULT':'RØDT'),
        mangler:Math.max(0,LM.BUFFER-scen.plan.laveste)}};
    state.spaker.cash_lag={median_d:14,p75_d:32,p90_d:61,kilde:'deal-for-deal n=92'};
    state.meta.sources.likviditet={ok:true,snapshot:s?s.snapshot_date:'ingen'};
  }catch(e){state.meta.sources.likviditet={ok:false,error:e.message};}

  // ---- KPI-scorecard: solgt fra settlements + HubSpot-funnel ----
  try{
    const {data:settl}=await sb.from('settlements').select('sold_date,revenue_ex_vat');
    const now2=Date.now(),d30=now2-30*864e5;
    const y=(settl||[]).filter(x=>(x.sold_date||'').startsWith(String(year)));
    const s30=y.filter(x=>Date.parse(x.sold_date)>=d30);
    state.kpi_scorecard.solgt={ytd_antall:y.length,siste_30d:s30.length,
      provisjon_ytd:Math.round(y.reduce((a,x)=>a+(x.revenue_ex_vat||0),0))};
  }catch(e){state.meta.sources.kpi_solgt={ok:false,error:e.message};}
  try{
    const A=await hubspotFunnel('3205247197'); // Pipeline A Seller Acquisition
    state.kpi_scorecard.pipeline_a={aktive:A.total,opprettet_30d:A.created30,opprettet_7d:A.created7,
      per_stage:A.byStage,
      stage_ref:{valuation:'4400020704 (befaring-proxy)',agreement_signed:'4400020706 (signert)'}};
    state.meta.sources.hubspot_a={ok:true,rows:A.total};
  }catch(e){state.meta.sources.hubspot_a={ok:false,error:e.message,note:'PROXY-KPI — raffineres i Trinn 2 (stage-historikk)'};}

  // ---- Resultat YTD fra PowerOffice TrialBalance (resultatkonti 3-8) ----
  try{
    const from=year+'-01-01',to=now.toISOString().slice(0,10);
    const r=await po(`/TrialBalance?date=${to}&hideAccountsWithZeroBalance=true`);
    if(r.ok&&Array.isArray(r.data)){
      let res=0;for(const row of r.data){const no=parseInt(row.AccountNo||row.AccountCode,10);const bal=row.Balance||row.ClosingBalance||0;if(no>=3000&&no<9000)res+=bal;}
      state.north_star.resultat_ytd=Math.round(-res); // inntekt kredit(neg) → snu fortegn
      state.meta.sources.resultat={ok:true,note:'−sum(konto 3000–8999) fra TrialBalance; verifiser mot GO'};
    } else {state.meta.sources.resultat={ok:false,error:'TrialBalance '+r.status};}
  }catch(e){state.meta.sources.resultat={ok:false,error:e.message};}

  // lagre
  const row={id:1,state,built_at:now.toISOString()};
  const {error}=await sb.from('dashboard_state').upsert(row,{onConflict:'id'});
  if(error) return {ok:false,step:'upsert',error:error.message,state};
  try{await setSyncState(sb,'dashboard_state',{rows_synced_total:1,last_error:null});}catch{}
  return {ok:true,state};
}

exports.handler=async(event)=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  const auth=verifyAdmin(event);
  if(!auth.ok)return{statusCode:auth.status,headers:{...CORS,'Content-Type':'application/json'},body:JSON.stringify({error:auth.error})};
  const sb=supabase(),action=(event.queryStringParameters||{}).action||'get';
  const respond=(ok,p)=>({statusCode:ok?200:502,headers:{...CORS,'Content-Type':'application/json'},body:JSON.stringify(p,null,2)});
  if(action==='get'){const {data}=await sb.from('dashboard_state').select('*').eq('id',1).maybeSingle();return respond(true,{state:data?data.state:null,built_at:data?data.built_at:null});}
  if(action==='rebuild'){const r=await buildDashboardState(sb);return respond(r.ok,r);}
  return respond(false,{error:'Ukjent action: '+action});
};
module.exports.buildDashboardState=buildDashboardState;
