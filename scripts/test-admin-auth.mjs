// Production-mode localhost auth verification, with ephemeral generated credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
const key=randomBytes(32).toString('hex');
await fs.mkdir('.data',{recursive:true});
const db=await fs.mkdtemp(path.resolve('.data/auth-review-'));
const env={...process.env,ADMIN_KEY:key,PGLITE_DIR:db,NEXT_TELEMETRY_DISABLED:'1',RULESET:'test',JUDGE_SHADOW:'off'};
for(const name of ['ANTHROPIC_API_KEY','OPENAI_API_KEY','TYPESAFE_API_KEY','DATABASE_URL','LOCAL_LLM_URL','LOCAL_JUDGE_URL'])delete env[name];
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3124'],{env,stdio:'ignore'});
const base='http://127.0.0.1:3124';
const result={startedAt:new Date().toISOString(),checks:[],environment:'local production build; generated credential not recorded; local disposable database'};
const req=(p,options={})=>fetch(base+p,{...options,signal:AbortSignal.timeout(20000)});
try {
 let ready=false;for(let i=0;i<50;i++){try{if((await req('/')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 for(const p of ['/api/admin','/api/admin?export=feedback&rules=all&char=all'])assert.equal((await req(p)).status,401);
 result.checks.push('Dashboard and feedback export reject unauthenticated production requests');
 const bad=await req('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:'incorrect-test-credential'})});assert.equal(bad.status,401);result.checks.push('Wrong administrator credential rejected');
 const login=await req('/api/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:key})});assert.equal(login.status,200);
 const cookie=login.headers.get('set-cookie');assert.ok(cookie?.includes('HttpOnly'));assert.ok(cookie?.includes('Secure'));const admin=cookie.split(';')[0];
 result.checks.push('Correct ephemeral credential creates HttpOnly Secure cookie');
 const x=await req('/api/admin?export=feedback&rules=all&char=all',{headers:{cookie:admin}});assert.equal(x.status,200);const data=await x.json();assert.equal(data.schemaVersion,'haruhi-feedback-1');assert.ok(!JSON.stringify(data).includes(key));result.checks.push('Authenticated feedback export works and does not disclose administrator credential');
 assert.equal((await req('/api/survey?c=jaeheon')).status,401);result.checks.push('Survey endpoint requires character user session in production mode');
 result.status='passed';
} catch(e){result.status='failed';result.error=String(e.message);process.exitCode=1;}
finally {child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await fs.rm(db,{recursive:true,force:true});result.finishedAt=new Date().toISOString();const out=process.env.TEST_OUTPUT||'.data/auth-result.json';await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
