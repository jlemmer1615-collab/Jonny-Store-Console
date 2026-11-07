import { XMLParser } from 'fast-xml-parser';
import { AppError, asArray, checked, env, type DB } from './core.ts';

export const environment=()=>Deno.env.get('EBAY_ENVIRONMENT')==='production'?'production':'sandbox';
export const apiBase=()=>environment()==='production'?'https://api.ebay.com':'https://api.sandbox.ebay.com';
export const scopes=['https://api.ebay.com/oauth/api_scope','https://api.ebay.com/oauth/api_scope/sell.inventory','https://api.ebay.com/oauth/api_scope/sell.fulfillment','https://api.ebay.com/oauth/api_scope/sell.analytics.readonly'];
export async function tokenGrant(body: URLSearchParams) {
  const response=await fetch(`${apiBase()}/identity/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${btoa(`${env('EBAY_CLIENT_ID')}:${env('EBAY_CLIENT_SECRET')}`)}`,'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new AppError(`eBay authorization failed (HTTP ${response.status}). Reconnect your eBay account.`,502);
  return await response.json();
}
export async function accessToken(db:DB,owner:string) {
  const row=checked(await db.from('ebay_credentials').select('*').eq('owner_id',owner).maybeSingle());
  if(!row || row.environment!==environment()) throw new AppError('Connect your eBay account for the configured environment.',409);
  if(new Date(row.expires_at).getTime()>Date.now()+120000) return row.access_token as string;
  const data=await tokenGrant(new URLSearchParams({grant_type:'refresh_token',refresh_token:row.refresh_token,scope:scopes.join(' ')}));
  checked(await db.from('ebay_credentials').update({access_token:data.access_token,expires_at:new Date(Date.now()+data.expires_in*1000).toISOString()}).eq('owner_id',owner));
  return data.access_token as string;
}
export async function rest(token:string,path:string,method='GET',body?:unknown) {
  // Only fixed, application-generated eBay API paths reach this adapter.
  const response=await fetch(`${apiBase()}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Content-Language':'en-US','X-EBAY-C-MARKETPLACE-ID':'EBAY_US'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(!response.ok) {
    const data=await response.json().catch(()=>({}));
    const ids=asArray(data.errors).map((e: any)=>String(e.errorId)).filter(v=>/^\d+$/.test(v)).join(', ');
    throw new AppError(`eBay request failed (HTTP ${response.status}${ids?`; code ${ids}`:''}).`,502);
  }
  return response.status===204 || response.headers.get('content-length')==='0' ? {} : await response.json().catch(()=>({}));
}
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,removeNSPrefix:true,processEntities:true});
export async function trading(token:string,call:string,body:string) {
  const response=await fetch(environment()==='production'?'https://api.ebay.com/ws/api.dll':'https://api.sandbox.ebay.com/ws/api.dll',{
    method:'POST',headers:{'Content-Type':'text/xml','X-EBAY-API-CALL-NAME':call,'X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1487','X-EBAY-API-IAF-TOKEN':token},
    body:`<?xml version="1.0" encoding="utf-8"?><${call}Request xmlns="urn:ebay:apis:eBLBaseComponents">${body}</${call}Request>`,signal:AbortSignal.timeout(20000)
  });
  if(!response.ok) throw new AppError(`eBay ${call} failed (HTTP ${response.status}).`,502);
  const source=await response.text();
  if(source.length>8000000 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new AppError('Unexpected eBay response.',502);
  const result=parser.parse(source)[`${call}Response`];
  if(!result || !['Success','Warning'].includes(result.Ack)) {
    const codes=asArray(result?.Errors).map((e:any)=>e.ErrorCode).filter(v=>/^\d+$/.test(v)).join(', ');
    throw new AppError(`eBay ${call} failed${codes?` (code ${codes})`:''}.`,502);
  }
  return result;
}
export const xmlValue=(v:any)=>v && typeof v==='object'?v['#text']:v;
