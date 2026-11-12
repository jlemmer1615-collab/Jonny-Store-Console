import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration isolates operator data, blocks client writes and tokens, and claims jobs/actions atomically',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('11111111-1111-1111-1111-111111111111'),('22222222-2222-2222-2222-222222222222');`);
    await db.exec(await readFile(new URL('../supabase/migrations/202611070001_console.sql',import.meta.url),'utf8'));
    const owner='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222';
    await db.exec(`insert into public.console_operators values('${owner}');
      insert into public.listings(owner_id,ebay_id,title,price) values('${owner}','123','Private listing',25);
      insert into public.ebay_credentials values('${owner}','secret-refresh','secret-access',now(),'sandbox');
      insert into public.action_queue(owner_id,kind,target_id,summary,payload,idempotency_key,status) values('${owner}','price','1','Change price','{}','test','approved');`);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${owner}';`);
    assert.equal((await db.query('select * from listings')).rows.length,1);
    await assert.rejects(db.query('select * from ebay_credentials'));
    await assert.rejects(db.query('select * from oauth_states'));
    await assert.rejects(db.query('update action_queue set status=\'completed\''));
    await assert.rejects(db.query(`insert into console_operators values('${other}')`));
    await assert.rejects(db.query(`select claim_console_job('${owner}')`));
    await db.exec(`set request.jwt.claim.sub='${other}';`);
    assert.equal((await db.query('select * from listings')).rows.length,0);
    assert.equal((await db.query('select is_console_operator() as allowed')).rows[0].allowed,false);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from listings'));
    await db.exec('reset role; set role service_role;');
    assert.equal((await db.query(`select claim_console_job('${owner}') as claimed`)).rows[0].claimed,true);
    assert.equal((await db.query(`select claim_console_job('${owner}') as claimed`)).rows[0].claimed,false);
    const claim=()=>db.query(`update action_queue set status='running' where status='approved' returning id`);
    assert.equal((await claim()).rows.length,1);assert.equal((await claim()).rows.length,0);
    await assert.rejects(db.query(`insert into action_queue(owner_id,kind,target_id,summary,payload,idempotency_key) values('${owner}','price','1','duplicate','{}','test-2')`));
  } finally { await db.close(); }
});
