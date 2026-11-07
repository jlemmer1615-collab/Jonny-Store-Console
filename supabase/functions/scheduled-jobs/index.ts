import { AppError, admin, checked, env, recoverInterrupted, safeEqual } from '../_shared/core.ts';
import { syncStore } from '../_shared/sync.ts';
import { planAutomation } from '../_shared/actions.ts';

Deno.serve(async req=>{
  try {
    if(req.method!=='POST') return new Response('Method not allowed',{status:405});
    if(!safeEqual(req.headers.get('authorization')??'',`Bearer ${env('CRON_SECRET')}`)) return new Response('Unauthorized',{status:401});
    const db=admin(),owners=checked(await db.from('console_operators').select('user_id'))??[];
    const results=[];
    // Intended for one operator. No input can select another account or arbitrary URL.
    for(const {user_id} of owners) {
      try { await recoverInterrupted(db,user_id); await syncStore(db,user_id); await planAutomation(db,user_id); results.push({status:'success'}); }
      catch(e) { results.push({status:'error',message:e instanceof AppError?e.message:'Scheduled sync failed.'}); }
    }
    return Response.json({results},{status:results.some(r=>r.status==='error')?502:200});
  } catch { return Response.json({error:'Scheduler configuration failed.'},{status:500}); }
});
