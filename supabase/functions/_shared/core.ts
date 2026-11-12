import { createClient } from '@supabase/supabase-js';

export class AppError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function env(key: string) { const value = Deno.env.get(key); if (!value) throw new AppError(`Missing server configuration: ${key}`, 503); return value; }
export function admin() { return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }); }
export type DB = ReturnType<typeof admin>;
export function checked<T>(r: {data: T; error: unknown}): T { if (r.error) throw new AppError('Database operation failed. Check migrations and configuration.', 500); return r.data; }
export async function allRows(db:DB,owner:string,table:string,columns='*'):Promise<any[]> {
  const rows:any[]=[];
  for(let start=0;start<10000;start+=1000) {
    const page=checked(await db.from(table).select(columns).eq('owner_id',owner).order('id').range(start,start+999))??[];
    rows.push(...page);if(page.length<1000)return rows;
  }
  throw new AppError('The backend row limit was reached. Use bulk feeds for larger stores.',409);
}
export async function recoverInterrupted(db:DB,owner:string) {
  checked(await db.from('action_queue').update({status:'needs_review',error:'Execution was interrupted. Check eBay before creating another action.',updated_at:new Date().toISOString()})
    .eq('owner_id',owner).eq('status','running').lt('updated_at',new Date(Date.now()-10*60000).toISOString()));
}
export function cors(req: Request) {
  const origin = req.headers.get('origin');
  const allowed = env('APP_URL');
  return { 'Access-Control-Allow-Origin': origin === new URL(allowed).origin ? origin : new URL(allowed).origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
export function json(req: Request, body: unknown, status=200) { return new Response(JSON.stringify(body), {status, headers: {...cors(req), 'Content-Type':'application/json', 'Cache-Control':'no-store'}}); }
export function failure(req: Request, e: unknown) { return json(req,{error:e instanceof AppError ? e.message : 'The request failed. Review connection settings and retry.'},e instanceof AppError ? e.status : 500); }
export async function operator(req: Request, db: DB) {
  const token = req.headers.get('authorization')?.replace(/^Bearer /i,'');
  if (!token) throw new AppError('Sign in to continue.',401);
  const {data,error}=await db.auth.getUser(token);
  if (error || !data.user) throw new AppError('Your session has expired. Sign in again.',401);
  const row = checked(await db.from('console_operators').select('user_id').eq('user_id',data.user.id).maybeSingle());
  if (!row) throw new AppError('This account is not the store operator.',403);
  return data.user.id;
}
export async function settings(db: DB, owner: string) {
  checked(await db.from('store_settings').upsert({owner_id:owner},{onConflict:'owner_id',ignoreDuplicates:true}));
  return checked(await db.from('store_settings').select('*').eq('owner_id',owner).single());
}
export async function audit(db: DB, owner: string, job: string, status: string, detail: string) {
  checked(await db.from('automation_runs').insert({owner_id:owner,job,status,detail}));
}
export const asArray = <T>(v: T | T[] | undefined | null): T[] => v == null ? [] : Array.isArray(v) ? v : [v];
export function number(value: unknown, min=0, max=1000000) { if (typeof value!=='number' || !Number.isFinite(value) || value<min || value>max) throw new AppError(`Enter a number between ${min} and ${max}.`); return value; }
export function text(value: unknown, max=200, required=true): string { if (typeof value!=='string' || value.length>max || (required && !value.trim())) throw new AppError('A required text field is missing or too long.'); return value.trim(); }
export function https(value: unknown) { const s=text(value,2000,false); if(!s) return ''; try { if(new URL(s).protocol==='https:') return s; } catch { /* validation below */ } throw new AppError('Links must use HTTPS.'); }
export function xml(value: unknown) { return String(value).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!)); }
export async function hash(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join(''); }
export function safeEqual(a:string,b:string) { const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b); let diff=x.length^y.length; for(let i=0;i<Math.max(x.length,y.length);i++) diff|=(x[i]??0)^(y[i]??0); return diff===0; }
