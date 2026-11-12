import { AppError, admin, audit, checked, cors, env, failure, hash, https, json, number, operator, recoverInterrupted, settings, text } from '../_shared/core.ts';
import { environment, scopes } from '../_shared/ebay.ts';
import { enqueue, executeAction } from '../_shared/actions.ts';
import { syncStore } from '../_shared/sync.ts';

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:cors(req)});
  try {
    if(req.method!=='POST') throw new AppError('Use POST.',405);
    if(Number(req.headers.get('content-length')??0)>100000) throw new AppError('Request too large.',413);
    const db=admin(),owner=await operator(req,db),raw=await req.text();
    if(raw.length>100000)throw new AppError('Request too large.',413);
    let body;try{body=JSON.parse(raw);}catch{throw new AppError('Send a valid JSON request.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError('Send a JSON object.');
    const action=text(body.action,50);
    if(action==='status') {
      await recoverInterrupted(db,owner);
      const credentials=checked(await db.from('ebay_credentials').select('environment,expires_at').eq('owner_id',owner).maybeSingle());
      await settings(db,owner);
      return json(req,{environment:environment(),connected:credentials?.environment===environment(),developer_configured:!!Deno.env.get('EBAY_CLIENT_ID'),writes_enabled:environment()==='sandbox'||Deno.env.get('LIVE_WRITES_ENABLED')==='true',supplier_connector:false});
    }
    if(action==='oauth-start') {
      const state=crypto.randomUUID()+crypto.randomUUID();
      checked(await db.from('oauth_states').delete().eq('owner_id',owner));
      checked(await db.from('oauth_states').insert({state_hash:await hash(state),owner_id:owner,expires_at:new Date(Date.now()+600000).toISOString()}));
      const p=new URLSearchParams({client_id:env('EBAY_CLIENT_ID'),redirect_uri:env('EBAY_RUNAME'),response_type:'code',scope:scopes.join(' '),state});
      return json(req,{url:`https://auth${environment()==='sandbox'?'.sandbox':''}.ebay.com/oauth2/authorize?${p}`});
    }
    if(action==='sync') return json(req,await syncStore(db,owner));
    if(action==='save-settings') {
      const fee=number(body.fee_percent,0,49),margin=number(body.min_margin,0,94);
      if(fee+margin>=95) throw new AppError('Fees plus margin must be below 95%.');
      if(typeof body.require_approval!=='boolean'||typeof body.automation_enabled!=='boolean') throw new AppError('Invalid automation settings.');
      checked(await db.from('store_settings').upsert({owner_id:owner,require_approval:body.require_approval,automation_enabled:body.automation_enabled,
        fee_percent:fee,min_margin:margin,fixed_fee:number(body.fixed_fee,0,100),low_stock:Math.floor(number(body.low_stock,0,1000)),updated_at:new Date().toISOString()}));
      await audit(db,owner,'Settings updated','success',body.require_approval?'Actions require your approval.':'Approval requirement disabled by the operator.');
      return json(req,{message:'Settings saved.'});
    }
    if(action==='save-product') {
      if(!['Amazon','AliExpress','Wholesale','Owned inventory'].includes(body.supplier)) throw new AppError('Choose a valid supplier.');
      if(!['research','owned','wholesale'].includes(body.sourcing_model)) throw new AppError('Choose a sourcing model.');
      if(body.supplier==='Amazon'&&body.sourcing_model==='wholesale') throw new AppError('Amazon retail cannot be treated as a wholesale arrangement. Use owned inventory or research.');
      const quantity=number(body.quantity,0,100000); if(!Number.isInteger(quantity)) throw new AppError('Quantity must be a whole number.');
      if(body.aspects&&(typeof body.aspects!=='object'||Array.isArray(body.aspects)||Object.values(body.aspects).some(v=>!Array.isArray(v)||v.some(x=>typeof x!=='string'))))throw new AppError('Item specifics must be an object of string arrays.');
      const product={owner_id:owner,sku:text(body.sku,50),title:text(body.title,80),supplier:body.supplier,supplier_url:https(body.supplier_url??''),
        sourcing_model:body.sourcing_model,supplier_agreement:body.supplier_agreement===true,cost:number(body.cost),shipping_cost:number(body.shipping_cost),price:number(body.price,.01),quantity,
        image_url:https(body.image_url??''),description:text(body.description??'',10000,false),category_id:text(body.category_id??'',30,false),location_key:text(body.location_key??'',100,false),
        fulfillment_policy_id:text(body.fulfillment_policy_id??'',50,false),payment_policy_id:text(body.payment_policy_id??'',50,false),return_policy_id:text(body.return_policy_id??'',50,false),
        aspects:body.aspects&&typeof body.aspects==='object'&&!Array.isArray(body.aspects)?body.aspects:{},
        snapshot_at:body.verified===true?new Date().toISOString():null};
      if(body.id) {
        const existing=checked(await db.from('products').select('id').eq('owner_id',owner).eq('id',text(body.id,36)).single());
        if(!existing) throw new AppError('Product not found.',404);
        checked(await db.from('products').update(product).eq('id',existing.id).eq('owner_id',owner));
      } else checked(await db.from('products').insert(product));
      await audit(db,owner,'Product saved','success',`${product.sku}: ${product.title}`);
      return json(req,{message:'Product saved. Publication is a separate action.'});
    }
    if(action==='queue-publish') {
      const p=checked(await db.from('products').select('*').eq('owner_id',owner).eq('id',text(body.id,36)).single());
      const active=checked(await db.from('listings').select('id').eq('owner_id',owner).eq('sku',p.sku).eq('status','active'));
      if(active?.length) throw new AppError('This SKU already has an active listing.');
      return json(req,await enqueue(db,owner,'publish',p.id,`Publish ${p.title}`,{product_fingerprint:JSON.stringify(p)},`publish:${p.id}:${p.snapshot_at??p.created_at}`));
    }
    if(action==='queue-price'||action==='queue-stock') {
      const l=checked(await db.from('listings').select('*').eq('owner_id',owner).eq('id',text(body.id,36)).single());
      const kind=action==='queue-price'?'price':'stock',value=number(body.value,kind==='price'?.01:0),previous=kind==='price'?l.price:l.quantity;
      if(kind==='stock'&&!Number.isInteger(value)) throw new AppError('Stock must be a whole number.');
      return json(req,await enqueue(db,owner,kind,l.id,`${l.title}: ${kind} ${previous} → ${value}`,{previous,value},text(body.request_id,100),kind==='price'&&Math.abs(value/Number(l.price)-1)>.25));
    }
    if(action==='queue-shipment') {
      const o=checked(await db.from('orders').select('*').eq('owner_id',owner).eq('id',text(body.id,36)).single());
      if(o.fulfillment_status==='IN_PROGRESS') throw new AppError('Partial shipments must be managed in eBay Seller Hub in this version.');
      return json(req,await enqueue(db,owner,'shipment',o.id,`Send tracking for order ${o.ebay_order_id}`,{carrier:text(body.carrier,50),tracking:text(body.tracking,100)},text(body.request_id,100)));
    }
    if(action==='approve'||action==='reject') {
      const status=action==='approve'?'approved':'rejected';
      const r=checked(await db.from('action_queue').update({status,updated_at:new Date().toISOString()}).eq('owner_id',owner).eq('id',text(body.id,36)).eq('status','pending').select().maybeSingle());
      if(!r) throw new AppError('The action is no longer pending.',409);
      await audit(db,owner,`Action ${status}`,'success',r.summary);
      return json(req,{message:action==='approve'?'Approved. Execute now or leave it for the enabled scheduler.':'Action rejected.'});
    }
    if(action==='reconcile') {
      if(body.confirmed!==true) throw new AppError('Check the actual result in eBay before closing this action.');
      const r=checked(await db.from('action_queue').update({status:'rejected',updated_at:new Date().toISOString()}).eq('owner_id',owner).eq('id',text(body.id,36)).eq('status','needs_review').select().maybeSingle());
      if(!r) throw new AppError('This action does not need reconciliation.');
      await audit(db,owner,'Action reconciled','success',`Operator confirmed eBay state: ${r.summary}`);
      return json(req,{message:'Review closed. Sync before creating a fresh action.'});
    }
    if(action==='execute') return json(req,await executeAction(db,owner,text(body.id,36)));
    throw new AppError('Unknown action.');
  } catch(e) { return failure(req,e); }
});
