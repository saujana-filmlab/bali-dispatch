const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));
const clean = value => String(value||'').trim();
async function resolveId(db,table,legacyField,value) {
  const id=clean(value);if(!id) throw new Error('Select a Registry customer or saved order first.');
  const filters=[`${legacyField}.eq.${encodeURIComponent(id)}`];
  if(uuid(id)) filters.push(`id.eq.${id}`);
  const rows=await db.select(table,`?select=id&or=(${filters.join(',')})&limit=1`);
  if(!rows[0]) throw new Error('Customer or order not found.');
  return rows[0].id;
}
export async function protectRollCallCustomer(db,id) {
  const customerId=await resolveId(db,'customers','legacy_customer_id',id);
  const members=await db.select('rc_members',`?select=id&customer_id=eq.${customerId}&limit=1`);
  if(members.length) throw new Error('This customer has a permanent Roll Call record. Edit their details instead of deleting them.');
}
export function publicRollCall(snapshot) {
  if(!snapshot) return null;
  return {
    member:{name:snapshot.member.name,number:snapshot.member.number},
    totalStamps:snapshot.totalStamps,currentCard:snapshot.currentCard,completedCards:snapshot.completedCards,
    cards:snapshot.cards,
    availableRewards:snapshot.rewards.filter(reward=>reward.displayStatus==='available').length,
    rewards:snapshot.rewards.filter(reward=>reward.status!=='void').map(({cardNumber,atStamp,displayStatus,earnedAt,expiresAt,usedAt})=>({
      cardNumber,atStamp,
      status:displayStatus==='available'?'ready':displayStatus==='redeemed'||displayStatus==='used_on_paper'?'used':displayStatus,
      earnedAt,expiresAt,usedAt
    })),
    complimentaryRollEarnsStamp:false
  };
}
export async function handleRollCall(action,data,db,env,authorize,method) {
  if(method!=='POST') throw new Error('Roll Call requests must use POST.');
  if(action==='getRollCallCard') {
    const token=clean(data.token);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Card not found.');
    const rows=await db.select('rc_members',`?select=id&card_token=eq.${encodeURIComponent(token)}&limit=1`);
    if(!rows[0]) throw new Error('Card not found.');
    return publicRollCall(await db.rpc('rc_snapshot',{p_member:rows[0].id}));
  }
  await authorize(env,data);
  if(action==='getRollCallCustomers') {
    const offset=Number(data.offset||0);
    if(!Number.isInteger(offset)||offset<0||offset>1000000)throw new Error('Invalid customer page.');
    return db.rpc('rc_staff_customers',{p_search:clean(data.search).slice(0,100),p_offset:offset,p_members_only:data.membersOnly===true});
  }
  if(action==='getRollCallReport') {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(clean(data.date)))throw new Error('Choose a report date.');
    return db.rpc('rc_daily_redemptions',{p_day:data.date});
  }
  if(action==='getRollCall') {
    let rows;
    if(data.orderId) {
      const orderId=await resolveId(db,'orders','legacy_order_id',data.orderId);
      rows=await db.select('rc_order_members',`?select=member_id&order_id=eq.${orderId}&limit=1`);
      if(rows[0]) return {snapshot:await db.rpc('rc_snapshot',{p_member:rows[0].member_id}),attached:true,orderId};
    }
    if(!data.customerId) return {snapshot:null,attached:false};
    const customerId=await resolveId(db,'customers','legacy_customer_id',data.customerId);
    rows=await db.select('rc_members',`?select=id&customer_id=eq.${customerId}&limit=1`);
    return {snapshot:rows[0]?await db.rpc('rc_snapshot',{p_member:rows[0].id}):null,attached:false};
  }
  if(action!=='rollCallCommand') throw new Error('Unknown Roll Call action.');
  const operation=clean(data.operation),actor='Dispatch staff';
  if(!uuid(data.requestId)) throw new Error('A request ID is required.');
  if(!['enroll','redeem','reverse','add_stamps','remove_stamps'].includes(operation)) throw new Error('Unknown Roll Call operation.');
  const input={...data.input};
  if(operation==='enroll') {
    input.customerId=await resolveId(db,'customers','legacy_customer_id',input.customerId);
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    input.cardToken=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  } else if(!uuid(input.memberId)) throw new Error('Select a saved Roll Call member.');
  if(operation==='reverse'&&!Object.prototype.hasOwnProperty.call(input,'expectedUsedAt'))throw new Error('Refresh this card before restoring a reward.');
  if(input.orderId) input.orderId=await resolveId(db,'orders','legacy_order_id',input.orderId);
  if(JSON.stringify(input).length>8000) throw new Error('Roll Call request is too large.');
  return {snapshot:await db.rpc('roll_call_apply',{p_action:operation,p_payload:input,p_staff:actor,p_request:data.requestId})};
}
