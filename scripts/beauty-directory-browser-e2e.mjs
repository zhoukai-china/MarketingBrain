import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const root = process.env.BY52_ROOT;
assert.ok(root && path.basename(root).startsWith('by52-directory-'), 'owned synthetic root required');
assert.equal(await readFile(path.join(root, '.beauty-industry-acceptance'), 'utf8').then(v=>v.includes('acceptance')), true);
for (const line of (await readFile(path.join(root,'.env.acceptance'),'utf8')).split(/\r?\n/)) {
  const i=line.indexOf('='); if(i>0)process.env[line.slice(0,i).replace(/^\uFEFF/,'')]=line.slice(i+1);
}
assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:55434\/beauty_industry_acceptance_20260821/);
process.env.NODE_ENV='test';
const { prisma } = await import('../packages/db/src/index.ts');
const { createSessionToken } = await import('../apps/api/src/services/auth-token.ts');
const web='http://127.0.0.1:5176', api='http://127.0.0.1:3016', query=`?apiBase=${encodeURIComponent(api)}`;
const out=path.join(root,'reports',`${process.env.BY52_PHASE??'probe'}-${Date.now()}`);await mkdir(out,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const failures=[],events=[],errors=[],requests=[];let chrome,socket,interceptionMode='normal',heldRequest;const pending=new Map();let seq=0;
const closingSessions=new Set();
function respond(method,params,s){void send(method,params,s).catch(error=>{if(!closingSessions.has(s))failures.push('interception:'+error.message);});}
const check=(condition,label)=>{if(!condition)failures.push(label);};
const request=async(token,p)=>{const res=await fetch(api+p,{headers:{Authorization:`Bearer ${token}`}});return{status:res.status,body:await res.json()};};
async function seed(kind){
  const id=`by52-${kind}-${randomUUID()}`,uid=id+'-user';
  const brand=kind==='lanqi'||kind==='expired'?'lanqi':kind==='other'?'other-brand':'default';
  await prisma.tenant.create({data:{id,name:`Synthetic ${kind}`,type:'local_business',profile:{create:{data:{beautyIndustryBrand:{brandCode:brand}}}},creditAccount:{create:{balance:157}}}});
  await prisma.user.create({data:{id:uid,nickname:'Synthetic directory user'}});
  await prisma.membership.create({data:{tenantId:id,userId:uid,role:'owner'}});
  if(kind!=='none'){
    const expiresAt=kind==='expired'?new Date(0):null;
    await prisma.tenantProductEntitlement.create({data:{tenantId:id,productCode:'beauty-industry',source:'by52-fixture',expiresAt}});
    await prisma.tenantAgentEntitlement.create({data:{tenantId:id,agentId:'agent_beauty_acquisition',source:'by52-fixture'}});
  }
  if(kind==='legacy')await prisma.tenantProductEntitlement.create({data:{tenantId:id,productCode:'lanqi',source:'by52-fixture'}});
  return {id,uid,kind,token:createSessionToken({tenantId:id,userId:uid,ttlSeconds:600})};
}
function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout '+method));},15000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(s,expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},s);if(r.exceptionDetails)throw new Error('Browser evaluation failed');return r.result.value;}
async function until(s,expr){for(let i=0;i<80;i++){if(await evaluate(s,expr))return;await sleep(150);}throw new Error('DOM timeout '+expr.slice(0,90));}
async function shot(s,name){const r=await send('Page.captureScreenshot',{format:'png'},s);await writeFile(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
try{
  const ready=await fetch(api+'/ready').then(r=>r.json());assert.equal(ready.ok,true);assert.equal(ready.checks.database.ok,true);
  const identities=[];for(const kind of ['default','lanqi','other','none','expired','legacy'])identities.push(await seed(kind));
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${path.join(out,'chrome-profile')}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  await writeFile(path.join(out,'browser-runtime.json'),JSON.stringify({pid:chrome.pid,executable:'C:/Program Files/Google/Chrome/Application/chrome.exe',cwd:process.cwd(),profile:path.join(out,'chrome-profile'),state:'started'}));
  const ws=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('Chrome start timeout')),15000);chrome.stderr.on('data',d=>{text+=d;const m=text.match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  socket=new WebSocket(ws);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}
    if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type))errors.push({type:m.params.type});
    if(m.method==='Network.requestWillBeSent'){const u=new URL(m.params.request.url);requests.push({host:u.hostname,path:u.pathname,method:m.params.request.method});}
    if(m.method==='Fetch.requestPaused'){const u=new URL(m.params.request.url);if(!['127.0.0.1','localhost'].includes(u.hostname)){respond('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'},m.sessionId);}else if(u.pathname==='/agents/me'&&interceptionMode==='hold'){heldRequest={id:m.params.requestId,s:m.sessionId};}else if(u.pathname==='/agents/me'&&interceptionMode==='error'){respond('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:503,responseHeaders:[{name:'Access-Control-Allow-Origin',value:web},{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'fixture_unavailable'})).toString('base64')},m.sessionId);}else respond('Fetch.continueRequest',{requestId:m.params.requestId},m.sessionId);}
  });
  const rounds=Number(process.env.BY52_ROUNDS??1);
  for(let round=1;round<=rounds;round++)for(const width of [1440,390])for(const actor of identities){
    const catalog=await request(actor.token,'/agents/me');const legacy=await request(actor.token,'/lanqi/store-profile');
    check(catalog.status===200,`${actor.kind}:catalog-http`);check(legacy.status===(actor.kind==='legacy'?200:403),`${actor.kind}:legacy-boundary`);
    const {browserContextId}=await send('Target.createBrowserContext');const{targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});const{sessionId:s}=await send('Target.attachToTarget',{targetId,flatten:true});
    for(const d of ['Page','Runtime','Network'])await send(d+'.enable',{},s);
    await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},s);
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===390},s);
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('store_os_token',${JSON.stringify(actor.token)});`},s);
    await send('Page.navigate',{url:web+'/agents/beauty-industry'+query},s);
    await until(s,`!!document.querySelector('.beautyIndustryBackToAi')`);
    await evaluate(s,`document.querySelector('.beautyIndustryBackToAi').click()`);
    await until(s,`location.pathname==='/my-ai' && !!document.querySelector('.myAiPage') && !document.body.innerText.includes('正在加载已开通的智能体')`);
    const dom=await evaluate(s,`({text:document.querySelector('.myAiPage').innerText,extra:!!document.querySelector('.lanqiAgentEntry'),cards:[...document.querySelectorAll('.agentProductCard h2')].map(e=>e.textContent),balance:document.querySelector('.creditPill')?.textContent,overflow:document.documentElement.scrollWidth-innerWidth,api:new URLSearchParams(location.search).get('apiBase')})`);
    check(!dom.extra,`${actor.kind}:${width}:hardcoded-legacy-card`);
    const privateEntry=await evaluate(s,`document.querySelector('[data-owned-product="lanqi"]')?.innerText??''`);
    check(Boolean(privateEntry)===(actor.kind==='legacy'),`${actor.kind}:${width}:product-entry`);
    check(dom.api===api,`${actor.kind}:apiBase`);check(dom.overflow<=0,`${actor.kind}:${width}:overflow`);
    if(actor.kind==='lanqi')check(dom.cards.some(t=>t.includes('兰琪')),`lanqi:${width}:configured-brand-missing`);
    if(['default','other','none','expired'].includes(actor.kind))check(!dom.text.includes('兰琪'),`${actor.kind}:${width}:foreign-brand-text`);
    if(['none','expired'].includes(actor.kind))check(dom.cards.length===0,`${actor.kind}:not-owned`);
    events.push({round,width,kind:actor.kind,catalog:{status:catalog.status,slugs:catalog.body.agents?.map(a=>a.slug)},legacyStatus:legacy.status,dom});
    if(round===1&&['default','lanqi','legacy'].includes(actor.kind))await shot(s,`${actor.kind}-${width}`);
    if(actor.kind==='lanqi'){
      await evaluate(s,`document.querySelector('.agentProductCard button').click()`);
      await until(s,`location.pathname==='/agents/beauty-industry' && document.querySelector('.beautyIndustryTopProduct strong')?.textContent.includes('兰琪')`);
      await evaluate(s,`document.querySelector('.beautyIndustryBackToAi').click()`);
      await until(s,`location.pathname==='/my-ai' && !!document.querySelector('.agentProductCard')`);
    }
    if(actor.kind==='legacy'){
      check(await evaluate(s,`document.querySelector('[data-owned-product="lanqi"]').classList.contains('agentProductCard')`),'legacy-directory-card-theme');
      if(round===1){await evaluate(s,`document.querySelector('[data-owned-product="lanqi"]').scrollIntoView({block:'center'})`);await shot(s,`legacy-readable-${width}`);}
      await evaluate(s,`document.querySelector('[data-owned-product="lanqi"] button').click()`);
      await until(s,`location.pathname==='/lanqi/store-profile'`);
      await evaluate(s,`history.back()`);await until(s,`location.pathname==='/my-ai' && !!document.querySelector('[data-owned-product="lanqi"]')`);
    }
    await send('Page.reload',{},s);await until(s,`!!document.querySelector('.myAiPage') && !document.body.innerText.includes('正在加载已开通的智能体')`);
    check((await evaluate(s,`!!document.querySelector('.lanqiAgentEntry')`))===dom.extra,`${actor.kind}:refresh`);
    if(actor.kind==='default'){
      interceptionMode='hold';heldRequest=undefined;await send('Page.reload',{},s);
      await until(s,`document.body.innerText.includes('正在加载已开通的智能体')`);
      check(await evaluate(s,`!document.body.innerText.includes('兰琪')&&document.querySelector('.creditPill').textContent.includes('—')`),`loading:${width}`);
      for(let i=0;i<40&&!heldRequest;i++)await sleep(100);assert.ok(heldRequest,'held catalog request');interceptionMode='normal';await send('Fetch.continueRequest',{requestId:heldRequest.id},heldRequest.s);
      await until(s,`!document.body.innerText.includes('正在加载已开通的智能体')`);
      interceptionMode='error';await send('Page.reload',{},s);await until(s,`!!document.querySelector('.agentError')`);
      check(await evaluate(s,`!document.body.innerText.includes('兰琪')&&document.querySelector('.creditPill').textContent.includes('—')&&document.querySelectorAll('.agentProductCard').length===0`),`error:${width}`);
      interceptionMode='normal';await send('Page.reload',{},s);await until(s,`document.querySelectorAll('.agentProductCard').length>0`);
      // Browser history retains the authorized apiBase; no generation action is used.
      await send('Page.navigate',{url:web+'/agents/beauty-industry'+query},s);await until(s,`!!document.querySelector('.beautyIndustryBackToAi')`);
      await evaluate(s,`history.back()`);await until(s,`location.pathname==='/my-ai'&&!!document.querySelector('.myAiPage')`);
      check(await evaluate(s,`new URLSearchParams(location.search).get('apiBase')===${JSON.stringify(api)}`),'back-apiBase');
    }
    closingSessions.add(s);await send('Target.disposeBrowserContext',{browserContextId});
  }
  check(await prisma.creditTransaction.count()===0,'ledger-mutation');check(await prisma.agentRun.count()===0,'agent-run');
  const a=identities[0],b=identities[1];const spoof=await fetch(api+'/agents/me?brandCode=lanqi',{headers:{Authorization:`Bearer ${a.token}`,'x-sitong-tenant-id':b.id,'x-sitong-user-id':b.uid}}).then(r=>r.json());
  check(spoof.agents[0]?.name==='美业智能体'&&!spoof.productEntries?.length,'client-brand-or-identity-override');
  await prisma.membership.updateMany({where:{tenantId:b.id},data:{isActive:false}});check((await request(b.token,'/agents/me')).status===401,'revoked-membership');
  check((await fetch(api+'/agents/catalog').then(r=>r.json())).agents.length>1,'public-catalog-unchanged');
  check(requests.every(r=>['127.0.0.1','localhost'].includes(r.host)),'external-attempt');check(requests.every(r=>r.method==='GET'||r.method==='OPTIONS'),'business-mutation');
  check(errors.length===0,'console-warning-error');
}finally{
  if(socket?.readyState===1){await send('Browser.close').catch(()=>{});socket.close();}if(chrome)await new Promise(r=>{if(chrome.exitCode!==null)r();else{chrome.once('exit',r);setTimeout(r,4000);}});
  if(chrome)await writeFile(path.join(out,'browser-runtime.json'),JSON.stringify({pid:chrome.pid,profile:path.join(out,'chrome-profile'),state:chrome.exitCode!==null?'stopped':'verify_required'}));
  if(chrome?.exitCode!==null&&chrome){const profile=path.resolve(out,'chrome-profile');assert.equal(path.dirname(profile),path.resolve(out));await rm(profile,{recursive:true,force:true});}
  await prisma.$disconnect();await writeFile(path.join(out,'evidence.json'),JSON.stringify({failures,events,errors,requests,providerCalls:0,costYuan:0},null,2));
}
console.log(JSON.stringify({out,failures,consoleEvents:errors.length,providerCalls:0}));assert.equal(failures.length,0,'directory user journey failed');
