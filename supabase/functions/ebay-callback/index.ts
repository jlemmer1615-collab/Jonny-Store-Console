import { admin, checked, env, hash } from '../_shared/core.ts';
import { environment, tokenGrant } from '../_shared/ebay.ts';

Deno.serve(async req=>{
  const destination=new URL(env('APP_URL'));
  try {
    if(req.method!=='GET') throw new Error('Method not allowed');
    const url=new URL(req.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
    if(!state||!code||state.length>200||code.length>5000) throw new Error('Invalid callback');
    const db=admin();
    // Consume the state atomically. Replay and expired callbacks cannot exchange tokens.
    const row=checked(await db.from('oauth_states').delete().eq('state_hash',await hash(state)).gt('expires_at',new Date().toISOString()).select().maybeSingle());
    if(!row) throw new Error('Invalid state');
    const allowed=checked(await db.from('console_operators').select('user_id').eq('user_id',row.owner_id).maybeSingle());
    if(!allowed) throw new Error('Invalid operator');
    const token=await tokenGrant(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env('EBAY_RUNAME')}));
    if(!token.refresh_token || !token.access_token) throw new Error('Missing tokens');
    checked(await db.from('ebay_credentials').upsert({owner_id:row.owner_id,refresh_token:token.refresh_token,access_token:token.access_token,
      expires_at:new Date(Date.now()+token.expires_in*1000).toISOString(),environment:environment()}));
    destination.searchParams.set('ebay','connected');
  } catch { destination.searchParams.set('ebay','failed'); }
  return new Response(null,{status:303,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
});
