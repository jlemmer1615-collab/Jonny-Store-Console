import { defaults, type Store, type Product } from './types';
import { ebayDay } from '../supabase/functions/_shared/rules';
const names=['Studio wireless headphones','Orbit ambient desk lamp','Everyday commuter backpack','Arc wireless game controller','Pocket portable speaker','Minimal aluminum laptop stand','Magnetic wireless charger','Compact mechanical keyboard'];
export function demoStore():Store {
  const now=Date.now(),iso=new Date(now).toISOString(),today=iso.slice(0,10);
  const products=names.map((title,i):Product=>({id:`product-${i}`,sku:`JNY-${1001+i}`,title,supplier:i%3===0?'Amazon':'AliExpress',supplier_url:'',sourcing_model:i%3===0?'owned':'wholesale',supplier_agreement:i%3!==0,cost:[24,12,19,17,13,10,8,23][i],shipping_cost:3.5,price:[59.99,34.95,49.99,42.99,36.99,29.99,24.99,64.99][i],quantity:[18,7,24,2,16,9,0,12][i],image_url:'',description:`${title} — sample product`,category_id:'',location_key:'',fulfillment_policy_id:'',payment_policy_id:'',return_policy_id:'',aspects:{},snapshot_at:iso}));
  const listings=products.map((p,i)=>({id:`listing-${i}`,ebay_id:`demo-${i}`,sku:p.sku,title:p.title,price:p.price,currency:'USD',quantity:p.quantity,sold:[32,24,18,14,21,12,8,19][i],watchers:[28,19,15,12,17,8,6,22][i],image_url:null,status:'active',management:'trading',listing_type:'FixedPriceItem',has_variations:false,synced_at:iso}));
  const views=[1842,1264,986,842,720,615,428,1108];
  const traffic=Array.from({length:30},(_,i)=>{
    const weekday=new Date(now-(30-i)*86400000).getDay(),weekend=weekday===0||weekday===6?1.16:1;
    const views=Math.max(42,Math.round((96+i*6.1+Math.sin(i*.55)*46+Math.sin(i*1.7+1.1)*23+(i===11||i===22?185:0))*weekend));
    return {listing_id:'__store__',day:ebayDay(i-30),views,impressions:views*7+Math.round(Math.sin(i*1.3)*240)+860,transactions:Math.max(0,Math.round(views/88)+i%3)};
  });
  traffic.push(...listings.map((l,i)=>({listing_id:l.ebay_id,day:today,views:views[i],impressions:views[i]*8,transactions:l.sold})));
  const offers=[0,1,2,3,0].map((n,i)=>({id:`offer-${i}`,ebay_offer_id:`demo-offer-${i}`,listing_id:listings[n].ebay_id,title:names[n],amount:products[n].price-5-i,currency:'USD',quantity:1,status:'Active',expires_at:new Date(now+(i+3)*3600000).toISOString()}));
  const orders=Array.from({length:23},(_,i)=>({id:`order-${i}`,ebay_order_id:`DEMO-${80420+i}`,total:products[i%8].price,currency:'USD',payment_status:'PAID',fulfillment_status:i<3?'NOT_STARTED':'FULFILLED',line_items:[{lineItemId:`line-${i}`,sku:products[i%8].sku,title:names[i%8],quantity:1}],cost_estimate:products[i%8].cost+3.5,fee_estimate:products[i%8].price*.136+.4,ordered_at:new Date(now-i*86400000).toISOString()}));
  const actions=[{id:'action-1',kind:'price',target_id:'listing-0',summary:'Studio wireless headphones: price $59.99 → $62.50',payload:{previous:59.99,value:62.5},status:'pending',created_at:iso},{id:'action-2',kind:'stock',target_id:'listing-3',summary:'Arc wireless game controller: stock 2 → 8',payload:{previous:2,value:8},status:'pending',created_at:iso}];
  const runs=[{id:'run-1',job:'Store sync',status:'success',detail:'Sample listings, orders, offers and traffic refreshed.',created_at:iso},{id:'run-2',job:'Price monitor',status:'warning',detail:'2 sample changes are waiting for review.',created_at:new Date(now-1800000).toISOString()},{id:'run-3',job:'Inventory check',status:'success',detail:'Sample stock levels checked.',created_at:new Date(now-3600000).toISOString()}];
  return {listings,products,traffic,offers,orders,actions,runs,settings:{...defaults}};
}
