const uuid=value=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
export async function customerAccess(db,memberId=null){
 const state=await db.rpc('rc_customer_access',{p_member:memberId});
 if(!state||typeof state.systemEnabled!=='boolean')throw Error('Roll Call access settings unavailable.');
 return state;
}
export async function handleAccess(action,data,db,env){
 const memberId=data.memberId||null;
 if(memberId&&!uuid(memberId))throw Error('Choose a saved member.');
 if(action==='getRollCallAccess')return {...await customerAccess(db,memberId),masterConfigured:!!env.ROLL_CALL_MASTER_PASSWORD};
 if(typeof data.enabled!=='boolean'||!Number.isInteger(data.expectedVersion)||!uuid(data.requestId))throw Error('Refresh access settings before changing them.');
 const secret=String(env.ROLL_CALL_MASTER_PASSWORD||'');
 if(!secret)throw Error('The master password has not been configured.');
 if(secret.length<8||secret.length>256)throw Error('Master password setup requires at least 8 characters.');
 if(!await db.rpc('rc_access_attempt'))throw Error('Too many master-password attempts. Try again in 15 minutes.');
 const digest=async value=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const a=await digest(secret),b=await digest(String(data.masterPassword||'').slice(0,256));
 let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
 if(difference)throw Error('Incorrect master password.');
 return db.rpc('rc_set_customer_access',{p_member:memberId,p_enabled:data.enabled,p_expected_version:data.expectedVersion,p_request:data.requestId});
}
