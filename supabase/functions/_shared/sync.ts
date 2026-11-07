import { AppError, allRows, asArray, audit, checked, settings, type DB } from './core.ts';
import { accessToken, rest, trading, xmlValue } from './ebay.ts';
import { ebayDay } from './rules.ts';

export async function syncStore(db:DB,owner:string) {
  const claimed=checked(await db.rpc('claim_console_job',{p_owner:owner}));
  if(!claimed) throw new AppError('A store sync is already running. Try again in a few minutes.',409);
  const started=new Date().toISOString();
  try {
    const token=await accessToken(db,owner), config=await settings(db,owner);
    let listingCount=0;
    const budget=()=>{if(Date.now()-new Date(started).getTime()>95000)throw new AppError('Sync time budget reached. Use bulk feeds for larger stores.',409);};
    const mappings=await allRows(db,owner,'listings','id,ebay_id,management,offer_id');
    const products=await allRows(db,owner,'products','id,sku,cost,shipping_cost');
    // Page all active listings, including ones created outside this app.
    for(let page=1;page<=100;page++) {
      budget();
      const r=await trading(token,'GetMyeBaySelling',`<DetailLevel>ReturnAll</DetailLevel><ActiveList><Include>true</Include><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`);
      const rows=asArray(r.ActiveList?.ItemArray?.Item).map((i:any)=>({owner_id:owner,ebay_id:String(i.ItemID),sku:i.SKU??null,title:i.Title,
        price:Number(xmlValue(i.SellingStatus?.CurrentPrice)??xmlValue(i.BuyItNowPrice)??0),currency:i.Currency??'USD',quantity:Math.max(0,Number(i.Quantity??0)-Number(i.SellingStatus?.QuantitySold??0)),
        sold:Number(i.SellingStatus?.QuantitySold??0),watchers:i.WatchCount==null?null:Number(i.WatchCount),image_url:i.PictureDetails?.GalleryURL??null,
        status:'active',listing_type:i.ListingType,has_variations:!!i.Variations,synced_at:started,
        management:mappings.find((l:any)=>l.ebay_id===String(i.ItemID))?.management??'trading',
        offer_id:mappings.find((l:any)=>l.ebay_id===String(i.ItemID))?.offer_id??null}));
      if(rows.length) { checked(await db.from('listings').upsert(rows,{onConflict:'owner_id,ebay_id'})); listingCount+=rows.length; }
      const pages=Number(r.ActiveList?.PaginationResult?.TotalNumberOfPages??1);
      if(page>=pages) break;
      if(page===100) throw new AppError('Listing sync exceeded 10,000 items; use eBay bulk feeds for this account.',409);
    }
    // Only archive after ALL pages succeed. Never erase active data on a partial sync.
    checked(await db.from('listings').update({status:'ended'}).eq('owner_id',owner).eq('status','active').lt('synced_at',started));
    const since=new Date(Date.now()-30*86400000).toISOString();
    for(let offset=0;offset<10000;offset+=100) {
      budget();
      const query=new URLSearchParams({limit:'100',offset:String(offset),filter:`creationdate:[${since}..]`});
      const r=await rest(token,`/sell/fulfillment/v1/order?${query}`);
      const rows=asArray(r.orders).map((o:any)=>{
        const line_items=asArray(o.lineItems).map((l:any)=>({lineItemId:l.lineItemId,sku:l.sku??'',title:l.title,quantity:l.quantity,amount:Number(l.total?.value??0)}));
        const known=line_items.every((l:any)=>products.some((p:any)=>p.sku===l.sku));
        const cost=known?line_items.reduce((sum:number,l:any)=>{const p=products.find((p:any)=>p.sku===l.sku)!;return sum+(Number(p.cost)+Number(p.shipping_cost))*l.quantity;},0):null;
        const total=Number(o.pricingSummary?.total?.value??0);
        return {owner_id:owner,ebay_order_id:o.orderId,total,currency:o.pricingSummary?.total?.currency??'USD',payment_status:o.orderPaymentStatus,
          fulfillment_status:o.orderFulfillmentStatus,line_items,cost_estimate:cost,fee_estimate:Math.round((total*Number(config.fee_percent)/100+Number(config.fixed_fee))*100)/100,
          ordered_at:o.creationDate,synced_at:started};
      });
      if(rows.length) checked(await db.from('orders').upsert(rows,{onConflict:'owner_id,ebay_order_id'}));
      if(offset+100>=Number(r.total??0)) break;
      if(offset===9900) throw new AppError('Order sync exceeded 10,000 orders in 30 days.',409);
    }
    const warnings:string[]=[];
    try {
      // GetBestOffers without ItemID returns active offers grouped by item.
      for(let page=1;page<=50;page++) {
        budget();
        const r=await trading(token,'GetBestOffers',`<BestOfferStatus>Active</BestOfferStatus><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>`);
        const rows=asArray(r.ItemBestOffersArray?.ItemBestOffers).flatMap((group:any)=>asArray(group.BestOfferArray?.BestOffer).map((o:any)=>({
          owner_id:owner,ebay_offer_id:String(o.BestOfferID),listing_id:String(group.Item.ItemID),title:group.Item.Title??`Listing ${group.Item.ItemID}`,
          amount:Number(xmlValue(o.Price)),currency:o.Price?.['@_currencyID']??'USD',quantity:Number(o.Quantity??1),status:o.Status,expires_at:o.ExpirationTime??null,synced_at:started
        })));
        if(rows.length) checked(await db.from('buyer_offers').upsert(rows,{onConflict:'owner_id,ebay_offer_id'}));
        if(page>=Number(r.PaginationResult?.TotalNumberOfPages??1)) break;
        if(page===50) throw new AppError('Offer sync page limit reached.');
      }
      checked(await db.from('buyer_offers').update({status:'Inactive'}).eq('owner_id',owner).eq('status','Active').lt('synced_at',started));
    } catch { warnings.push('Buyer offers unavailable; previous data retained. Check Trading API access.'); }
    // Daily, listing-level traffic: upsert by day to avoid double counting on repeated syncs.
    try {
      const to=ebayDay(-1).replaceAll('-','');
      const from=ebayDay(-30).replaceAll('-','');
      const q=new URLSearchParams({dimension:'DAY',filter:`date_range:[${from}..${to}]`,metric:'LISTING_VIEWS_TOTAL,TOTAL_IMPRESSION_TOTAL,TRANSACTION'});
      const report=await rest(token,`/sell/analytics/v1/traffic_report?${q}`);
      const keys=report.header?.metrics?.map((m:any)=>m.key)??[];
      const rows=asArray(report.records).map((r:any)=>{
        const val=(key:string)=>{const cell=r.metricValues?.[keys.indexOf(key)];return cell?.applicable===false||cell?.value==null?null:Number(cell.value);};
        const day=new Date(r.dimensionValues[0].value).toISOString().slice(0,10);
        return {owner_id:owner,listing_id:'__store__',day,views:val('LISTING_VIEWS_TOTAL'),impressions:val('TOTAL_IMPRESSION_TOTAL'),transactions:val('TRANSACTION'),synced_at:started};
      });
      if(rows.length) checked(await db.from('traffic_daily').upsert(rows,{onConflict:'owner_id,listing_id,day'}));
      // Listing view totals are a separate 30-day snapshot, never mixed into daily totals.
      const listingRows=(await allRows(db,owner,'listings','id,ebay_id,status')).filter(l=>l.status==='active');
      for(let i=0;i<listingRows.length;i+=100) {
        budget();
        const ids=listingRows.slice(i,i+100).map((l:any)=>l.ebay_id);
        const p=new URLSearchParams({dimension:'LISTING',filter:`listing_ids:{${ids.join('|')}},date_range:[${from}..${to}]`,metric:'LISTING_VIEWS_TOTAL,TOTAL_IMPRESSION_TOTAL,TRANSACTION'});
        const rr=await rest(token,`/sell/analytics/v1/traffic_report?${p}`);
        const kk=rr.header?.metrics?.map((m:any)=>m.key)??[];
        const data=asArray(rr.records).map((r:any)=>{
          const v=(key:string)=>{const cell=r.metricValues?.[kk.indexOf(key)];return cell?.applicable===false||cell?.value==null?null:Number(cell.value);};
          return {owner_id:owner,listing_id:String(r.dimensionValues[0].value),day:new Date().toISOString().slice(0,10),views:v('LISTING_VIEWS_TOTAL'),impressions:v('TOTAL_IMPRESSION_TOTAL'),transactions:v('TRANSACTION'),synced_at:started};
        });
        if(data.length) checked(await db.from('traffic_daily').upsert(data,{onConflict:'owner_id,listing_id,day'}));
      }
    } catch { warnings.push('Traffic unavailable or delayed; previous data retained. Analytics may be unavailable in sandbox.'); }
    const detail=`Synced ${listingCount} active listings and the last 30 days of orders. ${warnings.join(' ')}`;
    await audit(db,owner,'Store sync',warnings.length?'warning':'success',detail);
    return {message:detail,warnings};
  } catch(e) { await audit(db,owner,'Store sync','error',e instanceof AppError?e.message:'Sync interrupted. Previous data retained.'); throw e; }
  finally { checked(await db.from('job_locks').delete().eq('owner_id',owner)); }
}
