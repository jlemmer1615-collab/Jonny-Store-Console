import { createClient } from '@supabase/supabase-js';
import { defaults, type Store } from './types';
const url=import.meta.env.VITE_SUPABASE_URL, key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Catch accidentally supplied privileged keys before they are used by the browser.
function publicKey(value:string) {
  if(value.startsWith('sb_secret_')) throw new Error('Use a Supabase publishable key, never a secret key.');
  if(value.startsWith('eyJ')) { try { const role=JSON.parse(atob(value.split('.')[1].replaceAll('-','+').replaceAll('_','/'))).role; if(role!=='anon') throw new Error('Use a public anon key only.'); } catch { throw new Error('Invalid frontend key. Use a publishable key.'); } }
  return value;
}
export const supabase=url&&key&&!url.includes('YOUR_PROJECT')?createClient(url,publicKey(key)):null;
export async function call(action:string,args:Record<string,unknown>={}) {
  if(!supabase) throw new Error('Connect Supabase first.');
  const {data,error}=await supabase.functions.invoke('console-api',{body:{action,...args}});
  if(error) {
    let detail='The server could not complete the request. Check your connection and deployment.';
    try { detail=(await error.context.json()).error??detail; } catch { /* no response body */ }
    throw new Error(detail);
  }
  return data;
}
export async function loadStore():Promise<Store> {
  if(!supabase) throw new Error('Supabase is not configured.');
  const {data:{user},error}=await supabase.auth.getUser();
  if(error||!user) throw new Error('Sign in to continue.');
  const access=await supabase.rpc('is_console_operator');
  if(access.error||!access.data) throw new Error('This account is not the store operator. Add its user UUID to console_operators.');
  async function rows(table:string,sort:string) {
    const all:unknown[]=[];
    for(let offset=0;offset<50000;offset+=1000) {
      const r=await supabase!.from(table).select('*').eq('owner_id',user!.id).order(sort).order(table==='traffic_daily'?'listing_id':sort).range(offset,offset+999);
      if(r.error) throw new Error(`Could not load ${table}. Check migrations and access rules.`);
      all.push(...r.data); if(r.data.length<1000) return all;
    }
    throw new Error('Dataset exceeds this console’s 50,000-row limit. Narrow or archive data.');
  }
  const [listings,products,offers,orders,traffic,actions,runs,config]=await Promise.all([
    rows('listings','id'),rows('products','id'),rows('buyer_offers','id'),rows('orders','id'),rows('traffic_daily','day'),rows('action_queue','id'),rows('automation_runs','id'),rows('store_settings','owner_id')
  ]);
  return {listings,products,offers,orders,traffic,actions,runs,settings:config[0]??defaults} as Store;
}
