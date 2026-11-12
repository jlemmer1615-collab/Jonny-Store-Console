import { AppError, allRows, audit, checked, number, settings, xml, type DB } from './core.ts';
import { accessToken, environment, rest, trading, xmlValue } from './ebay.ts';
import { allowedSource, freshSnapshot, targetPrice } from './rules.ts';

export async function enqueue(db:DB,owner:string,kind:string,target:string,summary:string,payload:unknown,key:string,forceReview=false) {
  const config=await settings(db,owner);
  const status=!forceReview && !config.require_approval && config.automation_enabled?'approved':'pending';
  const r=await db.from('action_queue').insert({owner_id:owner,kind,target_id:target,summary,payload,idempotency_key:key,status}).select().single();
  if(r.error?.code==='23505') return {message:'This action is already queued or has already been processed.'};
  return {message:`Action ${status==='pending'?'queued for review':'approved'}.`,action:checked(r)};
}
export async function executeAction(db:DB,owner:string,id:string) {
  // Check gates BEFORE claiming. Never move a blocked action to running.
  if(environment()==='production' && Deno.env.get('LIVE_WRITES_ENABLED')!=='true') throw new AppError('Production writes are disabled. Enable LIVE_WRITES_ENABLED in Edge Function secrets after sandbox testing.',409);
  const row=checked(await db.from('action_queue').update({status:'running',updated_at:new Date().toISOString()}).eq('owner_id',owner).eq('id',id).eq('status','approved').select().maybeSingle());
  if(!row) throw new AppError('This action is not approved or is already processing.',409);
  let remoteStarted=false;
  try {
    if(Date.now()-new Date(row.created_at).getTime()>86400000) throw new AppError('Approval is older than 24 hours. Reconcile and create a fresh action.');
    const token=await accessToken(db,owner),config=await settings(db,owner);
    let result:unknown={};
    if(row.kind==='publish') {
      const p=checked(await db.from('products').select('*').eq('owner_id',owner).eq('id',row.target_id).single());
      if(!allowedSource(p)) throw new AppError('Publication needs owned inventory or an established wholesale agreement.');
      if(!freshSnapshot(p.snapshot_at)) throw new AppError('Verify stock and costs within six hours before publication.');
      if(!p.category_id || !p.location_key || !p.fulfillment_policy_id || !p.payment_policy_id || !p.return_policy_id || !p.image_url || !p.description) throw new AppError('Complete category, image, description, location and eBay policy IDs before publishing.');
      if(p.quantity<1 || p.price<targetPrice({...p,...config})) throw new AppError('Stock is empty or price is below your minimum margin.');
      if(JSON.stringify(p)!==row.payload.product_fingerprint) throw new AppError('The draft changed after review. Create a fresh publication action.');
      // Persist progress before each irreversible step. Uncertain results never retry automatically.
      remoteStarted=true;
      await rest(token,`/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`,'PUT',{
        availability:{shipToLocationAvailability:{quantity:p.quantity}},condition:p.condition,
        product:{title:p.title,description:xml(p.description),imageUrls:[p.image_url],aspects:p.aspects}
      });
      const offer=await rest(token,'/sell/inventory/v1/offer','POST',{
        sku:p.sku,marketplaceId:'EBAY_US',format:'FIXED_PRICE',availableQuantity:p.quantity,categoryId:p.category_id,
        listingDescription:xml(p.description),merchantLocationKey:p.location_key,listingDuration:'GTC',
        pricingSummary:{price:{value:String(p.price),currency:'USD'}},listingPolicies:{fulfillmentPolicyId:p.fulfillment_policy_id,paymentPolicyId:p.payment_policy_id,returnPolicyId:p.return_policy_id,bestOfferTerms:{bestOfferEnabled:true}}
      });
      checked(await db.from('action_queue').update({result:{offer_id:offer.offerId}}).eq('id',id).eq('owner_id',owner));
      const published=await rest(token,`/sell/inventory/v1/offer/${encodeURIComponent(offer.offerId)}/publish`,'POST');
      result={offer_id:offer.offerId,listing_id:published.listingId};
      checked(await db.from('listings').upsert({owner_id:owner,ebay_id:published.listingId,sku:p.sku,title:p.title,price:p.price,quantity:p.quantity,currency:'USD',image_url:p.image_url,status:'active',management:'inventory',listing_type:'FixedPriceItem',offer_id:offer.offerId},{onConflict:'owner_id,ebay_id'}));
    } else if(row.kind==='price' || row.kind==='stock') {
      const l=checked(await db.from('listings').select('*').eq('owner_id',owner).eq('id',row.target_id).single());
      if(l.status!=='active' || l.has_variations || l.listing_type!=='FixedPriceItem') throw new AppError('Only active, single-SKU fixed-price listings can be revised here.');
      if(l.currency!=='USD') throw new AppError('This version supports USD revisions only.');
      const field=row.kind==='price'?'price':'quantity';
      const value=number(row.payload.value,row.kind==='price'?0.01:0);
      if(field==='quantity'&&!Number.isInteger(value)) throw new AppError('Stock must be a whole number.');
      if(Number(l[field])!==Number(row.payload.previous)) throw new AppError('The listing changed since this action was queued. Sync and create a fresh action.');
      const p=checked(await db.from('products').select('*').eq('owner_id',owner).eq('sku',l.sku??'').maybeSingle());
      if(!p || !allowedSource(p) || !freshSnapshot(p.snapshot_at)) throw new AppError('Link a product with eligible sourcing and verify its costs and stock within six hours.');
      if(field==='price' && value<targetPrice({...p,...config})) throw new AppError('The new price is below your minimum profit margin.');
      if(field==='quantity' && value>p.quantity) throw new AppError('Quantity cannot exceed verified supplier or owned stock.');
      if(l.management==='inventory') {
        if(!l.offer_id || !l.sku) throw new AppError('Inventory API offer mapping is missing.');
        const current=await rest(token,`/sell/inventory/v1/offer/${encodeURIComponent(l.offer_id)}`);
        const remote=field==='price'?Number(current.pricingSummary?.price?.value):Number(current.availableQuantity);
        if(remote!==Number(row.payload.previous)) throw new AppError('eBay changed since approval. Sync and create a fresh action.');
        const offerChange:any={offerId:l.offer_id};
        if(field==='price') offerChange.price={value:String(value),currency:l.currency}; else offerChange.availableQuantity=value;
        remoteStarted=true;
        const response=await rest(token,'/sell/inventory/v1/bulk_update_price_quantity','POST',{requests:[{sku:l.sku,...(field==='quantity'?{shipToLocationAvailability:{quantity:value}}:{}),offers:[offerChange]}]});
        if(!response.responses?.length || response.responses.some((r:any)=>r.statusCode>=300)) throw new AppError('eBay could not confirm the inventory update. Check eBay before retrying.',502);
      } else {
        const current=await trading(token,'GetItem',`<ItemID>${xml(l.ebay_id)}</ItemID><DetailLevel>ReturnAll</DetailLevel>`);
        const remote=field==='price'?Number(xmlValue(current.Item?.SellingStatus?.CurrentPrice)):Number(current.Item?.Quantity)-Number(current.Item?.SellingStatus?.QuantitySold??0);
        if(remote!==Number(row.payload.previous)||current.Item?.SellingStatus?.ListingStatus!=='Active') throw new AppError('eBay changed since approval. Sync and create a fresh action.');
        remoteStarted=true;
        await trading(token,'ReviseFixedPriceItem',`<Item><ItemID>${xml(l.ebay_id)}</ItemID>${field==='price'?`<StartPrice currencyID="USD">${value}</StartPrice>`:`<Quantity>${value}</Quantity>`}</Item>`);
      }
      checked(await db.from('listings').update({[field]:value}).eq('owner_id',owner).eq('id',l.id));
      result={field,value};
    } else if(row.kind==='shipment') {
      const order=checked(await db.from('orders').select('*').eq('owner_id',owner).eq('id',row.target_id).single());
      if(order.payment_status!=='PAID' || order.fulfillment_status==='FULFILLED') throw new AppError('Only paid, unfulfilled orders can be marked shipped.');
      const current=await rest(token,`/sell/fulfillment/v1/order/${encodeURIComponent(order.ebay_order_id)}`);
      if(current.orderPaymentStatus!=='PAID'||current.orderFulfillmentStatus!=='NOT_STARTED') throw new AppError('The order changed in eBay. Sync and review before sending tracking.');
      // Sends tracking only. Does not purchase from a retail marketplace or assert supplier placement.
      remoteStarted=true;
      await rest(token,`/sell/fulfillment/v1/order/${encodeURIComponent(order.ebay_order_id)}/shipping_fulfillment`,'POST',{
        lineItems:order.line_items.map((l:any)=>({lineItemId:l.lineItemId,quantity:l.quantity})),
        shippedDate:new Date().toISOString(),shippingCarrierCode:row.payload.carrier,trackingNumber:row.payload.tracking
      });
      checked(await db.from('orders').update({fulfillment_status:'FULFILLED',tracking:row.payload.tracking}).eq('owner_id',owner).eq('id',order.id));
      result={tracking:row.payload.tracking};
    }
    checked(await db.from('action_queue').update({status:'completed',result,updated_at:new Date().toISOString()}).eq('owner_id',owner).eq('id',id));
    await audit(db,owner,'Action completed','success',row.summary);
    return {message:'Action completed.'};
  } catch(e) {
    const error=e instanceof AppError?e.message:'The action could not be confirmed.';
    checked(await db.from('action_queue').update({status:'needs_review',error:`${error}${remoteStarted?' Check eBay before creating another action; the remote change may have succeeded.':''}`,updated_at:new Date().toISOString()}).eq('id',id).eq('owner_id',owner));
    await audit(db,owner,'Action needs review','error',`${row.summary}: ${error}`);
    throw new AppError(error,409);
  }
}

export async function planAutomation(db:DB,owner:string) {
  const config=await settings(db,owner);
  if(!config.automation_enabled) return;
  const products=await allRows(db,owner,'products');
  const listings=(await allRows(db,owner,'listings')).filter(l=>l.status==='active'&&!l.has_variations);
  for(const l of listings) {
    const p=products.find((p:any)=>p.sku===l.sku);
    if(!p || !allowedSource(p) || !freshSnapshot(p.snapshot_at) || l.currency!=='USD' || l.listing_type!=='FixedPriceItem') continue;
    const price=targetPrice({...p,...config}),day=new Date().toISOString().slice(0,10);
    if(Math.abs(price-Number(l.price))>=0.02) await enqueue(db,owner,'price',l.id,`${l.title}: $${l.price} → $${price.toFixed(2)}`,{previous:l.price,value:price},`auto-price:${l.id}:${day}:${price}`,Math.abs(price/Number(l.price)-1)>.25);
    if(Number(p.quantity)!==Number(l.quantity)) await enqueue(db,owner,'stock',l.id,`${l.title}: stock ${l.quantity} → ${p.quantity}`,{previous:l.quantity,value:p.quantity},`auto-stock:${l.id}:${day}:${p.quantity}`);
  }
  // Automatic publication and shipment need an explicit complete draft/tracking action first.
  // No unsupported supplier purchasing endpoint is invented here.
  const approved=checked(await db.from('action_queue').select('id').eq('owner_id',owner).eq('status','approved').order('created_at').limit(3))??[];
  for(const a of approved) { try { await executeAction(db,owner,a.id); } catch { /* recorded on action; next job does not retry uncertain writes */ } }
}
