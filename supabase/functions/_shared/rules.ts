export type Pricing = {cost:number; shipping_cost:number; fee_percent:number; fixed_fee:number; min_margin:number};
export function ebayDay(offsetDays=0,now=Date.now()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now+offsetDays*86400000));
}
export function targetPrice(p:Pricing) {
  const divisor=1-(p.fee_percent+p.min_margin)/100;
  if(divisor<=0) throw new Error('Fees and margin must total less than 100%.');
  return Math.ceil(((p.cost+p.shipping_cost+p.fixed_fee)/divisor)*100)/100;
}
export function estimatedProfit(price:number,cost:number,shipping:number,feePercent:number,fixedFee:number) {
  return Math.round((price-cost-shipping-price*feePercent/100-fixedFee)*100)/100;
}
export function allowedSource(p:{sourcing_model:string;supplier_agreement:boolean;supplier:string}) {
  return p.sourcing_model==='owned' || (p.sourcing_model==='wholesale' && p.supplier_agreement && p.supplier!=='Amazon');
}
export function freshSnapshot(iso:string|null,now=Date.now()) {
  if(!iso) return false;
  const age=now-new Date(iso).getTime();
  return Number.isFinite(age) && age>=0 && age<=6*3600000;
}
export function offerIsActive(o:{status:string;expires_at:string|null},now=Date.now()) {
  return o.status==='Active' && (!o.expires_at || new Date(o.expires_at).getTime()>now);
}
export function trafficForListing(rows:Array<{listing_id:string;day:string;views:number|null}>,id:string) {
  return rows.filter(r=>r.listing_id===id).sort((a,b)=>b.day.localeCompare(a.day))[0]?.views??null;
}
