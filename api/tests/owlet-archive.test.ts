import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, migrate } from "../src/db.ts";
import { collectOwlet, encryptTokens, pollDueOwlet, downloadOwletLogs, trustedOwletFileURL } from "../src/owlet.ts";
import { owletHistory } from "../src/owlet-history.ts";

test("Owlet archives unchanged responses, failures, file bytes and metadata; history and exports stay household scoped", { skip: process.env.OWLET_ARCHIVE_TEST !== "1" }, async () => {
  const originalFetch = globalThis.fetch;
  const family = randomUUID(), child = randomUUID(), user = randomUUID(), id = randomUUID();
  process.env.OWLET_TOKEN_KEY = Buffer.alloc(32,7).toString("base64");
  Object.assign(process.env, { OWLET_FIREBASE_API_KEY: "fixture-firebase", OWLET_AYLA_APP_ID: "fixture-app", OWLET_AYLA_APP_SECRET: "fixture-secret", OWLET_ANDROID_PACKAGE: "test.fixture", OWLET_ANDROID_CERT: "fixture-cert" });
  try {
    await migrate();
    await pool.query("INSERT INTO families(id,name) VALUES($1,'Archive test')",[family]);
    await pool.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test')",[user,`${user}@example.test`]);
    await pool.query("INSERT INTO children(id,family_id,name,birth_date) VALUES($1,$2,'Test child','2026-01-01')",[child,family]);
    const connection = { id, family_id: family, child_id: child, device_serial: "TESTSOCK", encrypted_tokens: encryptTokens({ access:"fixture",refresh:"fixture",expiresAt:Date.now()+3600000 }) };
    await pool.query("INSERT INTO owlet_connections(id,family_id,child_id,connected_by,account_email,device_serial,device_name,encrypted_tokens) VALUES($1,$2,$3,$4,'fixture@example.test','TESTSOCK','Test',$5)",[id,family,child,user,connection.encrypted_tokens]);
    const stamp = new Date(Date.now()-1000).toISOString();
    const source = "https://ads-field-1a2039d9.aylanetworks.com/apiv1/devices/fixture/properties/VITALS_LOG_FILE/datapoints/fixture.json";
    let flag = 0;
    globalThis.fetch = async (input) => {
      const url=String(input);
      if (url===source) return Response.json({ datapoint:{ file:"https://fixture.s3.amazonaws.com/log.bin" } });
      if (url.includes("fixture.s3.amazonaws.com")) return new Response(Buffer.from([1,2,3,4]),{headers:{"content-type":"application/octet-stream"}});
      if (url.endsWith("properties.json")) return Response.json([
        { property:{name:"REAL_TIME_VITALS",value:JSON.stringify({hr:120,ox:98,bat:75,mv:0,ss:1,sc:1,chg:0}),data_updated_at:stamp,base_type:"string"} },
        { property:{name:"SOCK_OFF",value:flag,data_updated_at:new Date().toISOString()} },
        { property:{name:"VITALS_LOG_FILE",value:source} },
      ]);
      return Response.json({datapoint:{value:1}});
    };
    await collectOwlet(connection); flag=1; await collectOwlet(connection);
    const counts=await pool.query("SELECT (SELECT count(*) FROM owlet_polls WHERE family_id=$1)::int AS polls,(SELECT count(*) FROM owlet_readings WHERE family_id=$1)::int AS readings",[family]);
    assert.equal(counts.rows[0].polls,2); assert.equal(counts.rows[0].readings,1);
    const raw=await pool.query("SELECT raw_properties FROM owlet_polls WHERE family_id=$1 ORDER BY id",[family]);
    assert.equal(raw.rows[0].raw_properties[0].property.base_type,"string");
    assert.equal(raw.rows[1].raw_properties[1].property.value,1);
    await downloadOwletLogs();
    const file=await pool.query("SELECT content,sha256,metadata FROM owlet_log_files WHERE family_id=$1",[family]);
    assert.deepEqual(file.rows[0].content,Buffer.from([1,2,3,4])); assert.equal(file.rows[0].sha256.length,64);
    assert.equal(file.rows[0].metadata.archive_format,"unknown-binary-or-text");
    assert.equal(trustedOwletFileURL("https://ads-owlnova.aylanetworks.com/apiv1/devices/fixture.json",true).hostname,"ads-owlnova.aylanetworks.com");
    assert.throws(()=>trustedOwletFileURL("https://ads-owlnova.aylanetworks.com.evil.test/apiv1/file",true));
    assert.equal(trustedOwletFileURL("https://proxy-owlnova-d.aylanetworks.com/file").hostname,"proxy-owlnova-d.aylanetworks.com");
    assert.throws(()=>trustedOwletFileURL("https://proxy-owlnova-d.aylanetworks.com/file",true));
    assert.throws(()=>trustedOwletFileURL("https://127.0.0.1/private"));
    assert.throws(()=>trustedOwletFileURL("https://s3.amazonaws.com.evil.test/file"));
    globalThis.fetch = async () => new Response("",{status:429,headers:{"retry-after":"120"}});
    await pool.query("UPDATE owlet_connections SET next_poll_at=now()+interval '1 day' WHERE device_serial='TESTSOCK' AND id<>$1",[id]);
    await pool.query("UPDATE owlet_connections SET next_poll_at=now() WHERE id=$1",[id]);
    await pollDueOwlet();
    const backed=await pool.query("SELECT failure_count,extract(epoch from next_poll_at-now()) AS delay FROM owlet_connections WHERE id=$1",[id]);
    assert.equal(backed.rows[0].failure_count,1); assert.ok(Number(backed.rows[0].delay)>115);
    const failed=await pool.query("SELECT status,http_status FROM owlet_polls WHERE family_id=$1 ORDER BY id DESC LIMIT 1",[family]);
    assert.equal(failed.rows[0].http_status,429); assert.equal(failed.rows[0].status,"error");
    async function get(path:string, household=family) {
      let result="";
      const res={destroyed:false,writeHead(){},write(chunk:string){ result+=chunk;return true; },end(chunk?:string|Buffer){if(chunk) result+=chunk.toString();}};
      await owletHistory({method:"GET"} as any,res as any,new URL(`http://localhost/api/owlet/${path}${path.includes("?") ? "&" : "?"}child=${child}`),household);
      return result;
    }
    const history=JSON.parse(await get("history")); assert.equal(history.readings.length,1); assert.equal(history.archive.polls,"3"); assert.equal(history.archive.errors,"1");
    // Short ranges use individual rows rather than SQL averages. PostgreSQL
    // numeric columns must still reach graph consumers as JSON numbers.
    const short=JSON.parse(await get(`history?from=${new Date(Date.parse(stamp)-600000).toISOString()}&to=${new Date(Date.parse(stamp)+1000).toISOString()}`));
    assert.equal(short.bucketSeconds,5);
    for(const key of ["oxygen_percent","oxygen_min","oxygen_max"]) assert.equal(short.readings[0][key],98,key);
    assert.equal(short.readings[0].battery_percent,75);
    assert.equal(JSON.parse(await get("history",randomUUID())).readings.length,0);
    const exported=(await get("export?dataset=polls&format=jsonl")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(JSON.parse(await get(`poll?id=${exported[0].id}`)).raw_properties[0].property.base_type,"string");
    await assert.rejects(()=>get(`poll?id=${exported[0].id}`,randomUUID()));
    assert.equal(exported.length,3); assert.equal(exported[0].raw_properties[0].property.base_type,"string");
    assert.equal((await get("export?dataset=readings&format=csv")).split("\r\n").length,3);
    await pool.query("INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at,heart_rate,oxygen_percent) VALUES($1,$2,'TESTSOCK',$3,200,90),($1,$2,'TESTSOCK',$4,115,98)",[family,child,new Date(Date.parse(stamp)+2000),new Date(Date.parse(stamp)+600000)]);
    const wider=JSON.parse(await get(`history?from=${new Date(Date.parse(stamp)-1000).toISOString()}&to=${new Date(Date.parse(stamp)+700000).toISOString()}`));
    assert.equal(Math.max(...wider.readings.map((r:any)=>r.heart_max)),200);
    assert.equal(Math.min(...wider.readings.map((r:any)=>r.oxygen_min)),90);
    assert.equal(wider.gaps.length,1);
    await pool.query(`INSERT INTO owlet_readings(family_id,child_id,device_serial,measured_at,oxygen_percent,battery_percent)
      VALUES($1,$2,'TESTSOCK',$3,100,85.5),($1,$2,'TESTSOCK',$4,99.5,NULL),
      ($1,$2,'TESTSOCK',$5,0,0),($1,$2,'TESTSOCK',$6,NULL,NULL)`,
      [family,child,...[10000,15000,20000,25000].map(ms=>new Date(Date.parse(stamp)+ms))]);
    const individual=JSON.parse(await get(`history?from=${new Date(Date.parse(stamp)-1000).toISOString()}&to=${new Date(Date.parse(stamp)+700000).toISOString()}`));
    assert.deepEqual(individual.readings.map((r:any)=>r.oxygen_percent),[98,90,100,99.5,null,null,98]);
    assert.equal(individual.readings[2].battery_percent,85.5);
    assert.equal(individual.readings[3].battery_percent,null);
    const summary=JSON.parse(await get(`history?from=${new Date(Date.parse(stamp)-7200000).toISOString()}&to=${new Date(Date.parse(stamp)+700000).toISOString()}`));
    assert.equal(summary.bucketSeconds,30);
    for(const row of [...individual.readings,...summary.readings]){
      for(const key of ["oxygen_percent","oxygen_min","oxygen_max","battery_percent"]){
        assert.ok(row[key]===null || typeof row[key]==="number",`${key} must be numeric or missing`);
      }
    }
    assert.equal(Math.max(...summary.readings.map((r:any)=>r.oxygen_max)),100);
    assert.equal(Math.min(...summary.readings.filter((r:any)=>r.oxygen_min!==null).map((r:any)=>r.oxygen_min)),90);
  } finally { globalThis.fetch=originalFetch; await pool.end(); }
});
