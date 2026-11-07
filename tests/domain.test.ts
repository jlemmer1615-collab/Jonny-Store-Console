import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedSource, ebayDay, estimatedProfit, freshSnapshot, offerIsActive, targetPrice, trafficForListing } from '../supabase/functions/_shared/rules.ts';
import { parseCSV } from '../src/csv.ts';

test('price floor meets margin after percentage and fixed fees, rounded upward',()=>{
  const price=targetPrice({cost:12,shipping_cost:3,fee_percent:13.6,fixed_fee:.4,min_margin:20});
  assert.ok(estimatedProfit(price,12,3,13.6,.4)/price>=.20-1e-10);
  assert.throws(()=>targetPrice({cost:1,shipping_cost:1,fee_percent:60,fixed_fee:0,min_margin:40}));
});
test('traffic dates use eBay Pacific time across UTC midnight',()=>{
  const now=Date.parse('2026-11-07T01:00:00Z');
  assert.equal(ebayDay(0,now),'2026-11-06');assert.equal(ebayDay(-1,now),'2026-11-05');
});
test('research and Amazon retail purchases are blocked; ownership and established wholesale are eligible',()=>{
  assert.equal(allowedSource({supplier:'Amazon',sourcing_model:'research',supplier_agreement:true}),false);
  assert.equal(allowedSource({supplier:'Amazon',sourcing_model:'wholesale',supplier_agreement:true}),false);
  assert.equal(allowedSource({supplier:'Amazon',sourcing_model:'owned',supplier_agreement:false}),true);
  assert.equal(allowedSource({supplier:'AliExpress',sourcing_model:'wholesale',supplier_agreement:false}),false);
  assert.equal(allowedSource({supplier:'AliExpress',sourcing_model:'wholesale',supplier_agreement:true}),true);
});
test('inventory verification fails closed for expired, future or invalid snapshots',()=>{
  const now=Date.now();
  assert.equal(freshSnapshot(new Date(now-5*3600000).toISOString(),now),true);
  assert.equal(freshSnapshot(new Date(now-7*3600000).toISOString(),now),false);
  assert.equal(freshSnapshot(new Date(now+1000).toISOString(),now),false);
  assert.equal(freshSnapshot('not a date',now),false);assert.equal(freshSnapshot(null,now),false);
});
test('expired offers are excluded and listing snapshots do not accumulate across sync days',()=>{
  assert.equal(offerIsActive({status:'Active',expires_at:new Date(Date.now()-100).toISOString()}),false);
  assert.equal(trafficForListing([{listing_id:'1',day:'2026-11-01',views:100},{listing_id:'1',day:'2026-11-02',views:110},{listing_id:'__store__',day:'2026-11-02',views:800}],'1'),110);
  assert.equal(trafficForListing([],'1'),null);
});
test('CSV handles commas, escaped quotes, multiline values and BOM, and rejects malformed input',()=>{
  assert.deepEqual(parseCSV('\uFEFFsku,title\r\nABC,"A, B"\r\nDEF,"A ""quote""\nline"'),[{sku:'ABC',title:'A, B'},{sku:'DEF',title:'A "quote"\nline'}]);
  assert.throws(()=>parseCSV('sku,title\nABC,"unclosed'));
  assert.throws(()=>parseCSV('sku,sku\nA,B'));
  assert.throws(()=>parseCSV('sku,title\nABC'));
});
