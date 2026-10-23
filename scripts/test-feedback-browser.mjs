// Local, synthetic-data browser regression. Never point this script at a deployed site.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:3123';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname), 'Local test target only');
const out = process.env.TEST_OUTPUT || '.data/browser-review';
await fs.mkdir(out,{recursive:true});
const gateSource = process.env.DESIGN_GATE_SOURCE ? await fs.readFile(process.env.DESIGN_GATE_SOURCE,'utf8') : '';
const measure = gateSource.match(/MEASURE_JS = r"""([\s\S]*?)"""/)?.[1];
const result = { startedAt:new Date().toISOString(), mode:'mock-local-only', checks:[], layout:[], errors:[] };
const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
let current;
const pass = (s) => {result.checks.push(s);console.log('PASS '+s);};
async function session(char,nickname) {
 const context=await browser.newContext({viewport:{width:390,height:900}});
 // Fonts/analytics must not reach external services during local verification.
 await context.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)?route.continue():route.abort();});
 const page=await context.newPage();page.setDefaultTimeout(15000);current=page;
 await page.goto(base+'/?c='+char);await page.getByRole('textbox').fill(nickname);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'시작하기',exact:true}).click();
 await page.locator('.vn-input').waitFor();
 return {context,page,char,nickname};
}
async function shot(page,name,fullPage=false) {
 await page.evaluate(async()=>{const e=document.querySelector('.vn-stage');if(!e)return;const matches=[...getComputedStyle(e).backgroundImage.matchAll(/url\(["']?([^"')]+)/g)];await Promise.all(matches.map(async m=>{const img=new Image();img.src=m[1];await img.decode();}));});
 await page.screenshot({path:path.join(out,name+'.png'),fullPage,timeout:15000});
}
async function layouts(page,name) {
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:900});
  await page.waitForTimeout(150);
  if(measure){const hits=await page.evaluate('('+measure+')(60)');assert.ok(Array.isArray(hits),'Design measurement must return an array');result.layout.push({page:name,width,hits});}
  await shot(page,name+'-'+width,true);
 }
 await page.setViewportSize({width:390,height:900});
}
async function sayApi(s) {
 const response=await s.context.request.post(base+'/api/chat?c='+s.char,{data:{text:'검증 대화입니다'}});
 assert.equal(response.status(),200);
 const events=(await response.text()).trim().split('\n').map(x=>JSON.parse(x));
 assert.ok(events.some(e=>e.t==='meta'));assert.ok(!events.some(e=>e.t==='error'));
}
async function sayUi(s) {
 await s.page.locator('#msg').fill('검증 대화입니다');
 const done=s.page.waitForResponse(r=>r.url().includes('/api/chat?')&&r.request().method()==='POST');
 await s.page.getByRole('button',{name:'보내기',exact:true}).click();await done;
 await s.page.locator('.vn-flag').waitFor();
}
async function answer(page,manual=false) {
 const card=page.locator('.survey-card');await card.scrollIntoViewIfNeeded();
 await card.locator('input[name$="-q1"][value="5"]').check();
 await card.locator('input[name$="-q2"][value="yes"]').check();
 await card.locator('textarea').fill('설문 동작 검증용 소감입니다.');
 if(manual) await card.locator('input[name$="-q4"][value="0"]').check();
 await card.getByRole('button',{name:'소감 보내기',exact:true}).click();
 await page.locator('.survey-card').waitFor({state:'detached'});
}
try {
 const anon=await browser.newContext();
 assert.equal((await anon.request.get(base+'/api/survey?c=haruhi')).status(),401);
 assert.equal((await anon.request.post(base+'/api/survey?c=haruhi',{data:{action:'open',trigger:'manual'}})).status(),401);
 await anon.close();pass('Survey API requires a user session');
 for(const char of ['haruhi','jaeheon']) {
  const s=await session(char,'배경검증');
  for(const width of [390,1440]){await s.page.setViewportSize({width,height:900});await shot(s.page,'after-'+char+'-'+width);}
  const bg=await s.page.locator('.vn-stage').evaluate(e=>getComputedStyle(e).backgroundImage);assert.ok(bg.includes('/'+char+'/bg-'));
  await s.context.close();
 }
 pass('Both character backgrounds render at 390 and 1440');
 const s=await session('jaeheon','검증'+Date.now().toString(36));const page=s.page;current=page;
 for(let i=0;i<9;i++)await sayApi(s);
 await page.reload();await page.locator('.vn-input').waitFor();assert.equal(await page.locator('.survey-card').count(),0);pass('No automatic survey after nine turns');
 await sayUi(s);await page.locator('.survey-card').waitFor();
 await page.getByRole('link',{name:'짧은 테스트 소감 남기기 ↓'}).click();
 await layouts(page,'turn10-survey');
 await page.locator('.survey-card').getByRole('button',{name:'건너뛰기',exact:true}).click();
 await page.locator('.survey-card').waitFor({state:'detached'});await page.reload();await page.locator('.vn-input').waitFor();
 assert.equal(await page.locator('.survey-card').count(),0);pass('Tenth-turn card can be skipped and remains closed after refresh');
 await sayUi(s);assert.equal(await page.locator('.survey-card').count(),0);
 for(let i=11;i<49;i++)await sayApi(s);
 await page.reload();await page.locator('.vn-input').waitFor();await sayUi(s);
 await page.getByText('오늘 대화는 어땠나요?',{exact:true}).waitFor();await page.locator('.survey-card').scrollIntoViewIfNeeded();
 await layouts(page,'day-end-survey');await answer(page);pass('Fiftieth-turn day-end survey submits independently');
 await page.goto(base+'/memory?c=jaeheon');await page.getByRole('button',{name:'테스트 소감 남기기',exact:true}).click();
 await page.locator('.survey-card').waitFor();await layouts(page,'memory-survey');await answer(page,true);pass('Memory-note manual survey accepts recommendation score zero');
 const exportResponse=await s.context.request.get(base+'/api/admin?export=feedback&rules=test-1&char=jaeheon');assert.equal(exportResponse.status(),200);
 const exported=await exportResponse.json();
 const own=exported.surveys.filter(x=>x.nickname===s.nickname);
 assert.equal(own.length,2);assert.ok(own.some(x=>x.trigger==='manual'&&x.q4===0));assert.ok(own.some(x=>x.trigger==='day_end'));
 function checkKeys(v){if(Array.isArray(v))return v.forEach(checkKeys);if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){assert.ok(!['user_id','userId','cookie','adminKey','ADMIN_KEY'].includes(k),k);checkKeys(x);}}
 checkKeys(exported);pass('Filtered feedback export contains submitted surveys and no internal identity keys');
 await fs.writeFile(path.join(out,'synthetic-feedback-export.json'),JSON.stringify(exported,null,2));
 const admin=await s.context.newPage();await admin.goto(base+'/admin');await admin.getByText('친구 피드백',{exact:true}).waitFor();await layouts(admin,'admin-feedback');
 await page.goto(base+'/chat?c=jaeheon');await page.getByRole('button',{name:'기록',exact:true}).click();await page.getByRole('dialog',{name:'대화 기록'}).waitFor();pass('Existing conversation history remains accessible');
 await page.getByRole('dialog',{name:'대화 기록'}).getByRole('button',{name:'닫기',exact:true}).click();
 const removed=await s.context.request.delete(base+'/api/session?c=jaeheon');assert.equal(removed.status(),200);
 const afterDelete=await (await s.context.request.get(base+'/api/admin?export=feedback&rules=all&char=all')).json();
 assert.ok(!afterDelete.surveys.some(x=>x.nickname===s.nickname));assert.ok(!afterDelete.presentations.some(x=>x.nickname===s.nickname));
 assert.equal((await s.context.request.get(base+'/api/survey?c=jaeheon')).status(),401);pass('Delete-my-record removes surveys and impressions and ends survey access');
 await s.context.close();
 result.status='passed';
} catch(e) {
 result.status='failed';result.errors.push(String(e.stack||e));console.error(e.message);
 if(current)await shot(current,'failure',true).catch(()=>{});process.exitCode=1;
} finally {
 result.finishedAt=new Date().toISOString();
 result.layoutBlocks=result.layout.flatMap(x=>x.hits.filter(h=>h.level==='막음').map(h=>({page:x.page,width:x.width,...h})));
 if(result.layoutBlocks.length){result.status='failed';process.exitCode=1;}
 await fs.writeFile(path.join(out,'BROWSER-RESULT.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({status:result.status,checks:result.checks.length,layoutBlocks:result.layoutBlocks.length}));await browser.close();
}
