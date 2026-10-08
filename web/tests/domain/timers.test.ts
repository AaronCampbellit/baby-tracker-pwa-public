import {test} from 'node:test';
import assert from 'node:assert/strict';
import {duration,elapsed,sleepForDay,exportCSV,type Activity} from '../../src/domain/store.ts';
test('elapsed derives from instants after suspension',()=>{assert.equal(duration(elapsed(1000,3662000)),'01:01:01')});
test('overnight sleep splits by local day without mutating source',()=>{const day=new Date(2026,8,16);const a:Activity={id:'1',childId:'c',kind:'Sleep',start:+new Date(2026,8,15,23),end:+new Date(2026,8,16,2),detail:'',notes:'',author:'A'};assert.equal(sleepForDay([a],day),2*3600000);assert.equal(sleepForDay([{...a,deleted:true}],day),0)});
test('CSV quotes embedded quotes and neutralizes formula cells',()=>{const a:Activity={id:'1',childId:'c',kind:'Feed',start:0,detail:'a,"b"',notes:'=SUM(1,2)',author:'A'};const csv=exportCSV([a]);assert.ok(csv.includes('"a,""b"""'));assert.ok(csv.includes('"\'=SUM(1,2)"'))});
