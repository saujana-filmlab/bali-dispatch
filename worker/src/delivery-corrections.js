const uuid=value=>/^[0-9a-f-]{36}$/i.test(String(value||''));
export async function deliveryRecipients(db,order){
 const recipients=await db.select('order_recipients',`?select=email,is_primary&order_id=eq.${order.id}&order=is_primary.desc,created_at.asc`);
 let email=order.customer_email||recipients.find(item=>item.is_primary)?.email||'';
 if(!email&&!recipients.length&&!order.delivery_email_override&&order.customer_id){const customer=(await db.select('customers',`?select=email&id=eq.${order.customer_id}&limit=1`))[0];email=customer?.email||'';}
 const extraEmails=[...new Set(recipients.map(item=>String(item.email||'').trim()).filter(value=>value&&value.toLowerCase()!==email.toLowerCase()))];
 return {email,extraEmails};
}
export function savedDelivery(row){
 if(!row.delivery_url)return null;
 try{
  const url=new URL(row.delivery_url);
  if(url.protocol!=='https:'||url.hostname!=='bali-scans.saujanalab.com'||url.searchParams.get('order')!==row.order_number)return null;
  return {name:url.searchParams.get('name')||row.delivery_display_name||row.customer_name,film:url.searchParams.get('film')||row.film,theme:['classic','bw'].includes(url.searchParams.get('negative'))?url.searchParams.get('negative'):'colour',date:url.searchParams.get('date')||'',driveLink:row.drive_link||url.searchParams.get('link')||'',notes:row.notes||''};
 }catch{return null;}
}
export async function correctionRecord(db,orderNumber){
 const rows=await db.select('orders',`?select=*&order_number=eq.${encodeURIComponent(String(orderNumber||'').trim())}&limit=1`);
 const order=rows[0];if(!order)throw Error('Order not found');
 const sheets=await db.select('contact_sheets',`?select=*&order_id=eq.${order.id}&order=roll_index.asc`);
 return {order,sheets};
}
export async function handleDeliveryCorrection(action,data,db,env,helpers){
 const {order,sheets}=await correctionRecord(db,data.orderNumber);
 const display=savedDelivery(order);
 const recipients=await deliveryRecipients(db,order);
 const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(order.created_at)).map(part=>[part.type,part.value]));
 if(action==='getDeliveryForEdit')return {orderNumber:order.order_number,customerName:order.customer_name,revision:order.delivery_revision,details:{...(display||{name:order.delivery_display_name||order.customer_name,film:order.film||'',driveLink:order.drive_link||'',notes:order.notes||'',theme:'',date:`${dateParts.year}-${dateParts.month}-${dateParts.day}`}),...recipients},hasSavedLink:!!display,sheets:sheets.filter(s=>s.status==='ready').map(helpers.mapSheet)};
 if(!uuid(data.requestId)||!Number.isInteger(data.revision))throw Error('Reload this delivery before saving.');
 const input=data.details||{},clean=value=>String(value||'').trim();
 const details={name:clean(input.name),film:clean(input.film),driveLink:clean(input.driveLink),notes:clean(input.notes),theme:clean(input.theme),date:clean(input.date)};
 if(Object.hasOwn(input,'email')||Object.hasOwn(input,'extraEmails')){
  const email=clean(input.email),extras=input.extraEmails??[];
  if(!Array.isArray(extras)||extras.length>10||typeof input.email!=='string')throw Error('Check the delivery email addresses.');
  const valid=value=>value.length<=320&&/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);
  const extraEmails=[...new Map(extras.map(value=>{const email=clean(value);return [email.toLowerCase(),email];})).values()].filter(value=>value.toLowerCase()!==email.toLowerCase());
  if(email&&!valid(email)||extraEmails.some(value=>!valid(value))||!email&&extraEmails.length)throw Error('Enter valid delivery email addresses, with a primary email first.');
  details.email=email;details.extraEmails=extraEmails;
 }
 if(!details.name||details.name.length>200||!details.film||details.film.length>2000||details.notes.length>10000)throw Error('Check the name, film details and notes.');
 if(!['colour','classic','bw'].includes(details.theme))throw Error('Choose the delivery theme.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(details.date)||Number.isNaN(Date.parse(details.date))||new Date(details.date).toISOString().slice(0,10)!==details.date)throw Error('Enter a valid delivery date.');
 let drive;try{drive=new URL(details.driveLink);}catch{throw Error('Enter a valid Drive folder link.');}
 if(drive.protocol!=='https:'||drive.hostname!=='drive.google.com'||!/^\/drive\/folders\/[A-Za-z0-9_-]+\/?$/.test(drive.pathname))throw Error('Use the Google Drive folder link for this order.');
 if(details.driveLink!==order.drive_link&&data.driveLinkConfirmed!==true)throw Error('Confirm that the new Drive folder belongs to this order.');
 let replacement=null;
 if(data.contactSheets!==undefined&&!Array.isArray(data.contactSheets))throw Error('Invalid contact-sheet list.');
 if(Array.isArray(data.contactSheets)){
  const session=await helpers.verifyUpload(env,data.uploadNonce,order.order_number);
  if(Number(session.revision)!==data.revision)throw Error('The delivery changed before this upload. Reload it before saving.');
  const settings=helpers.settings(env);
  replacement=helpers.sanitize(data.contactSheets,settings.url);
 }
 const count=replacement?replacement.length:sheets.filter(s=>s.status==='ready').length;
 const url=new URL('https://bali-scans.saujanalab.com/');
 for(const [key,value] of Object.entries({theme:'bali',negative:details.theme,date:details.date,order:order.order_number,name:details.name,film:details.film,link:details.driveLink,sheets:count?'1':'0'}))url.searchParams.set(key,value);
 if(order.collect_negatives)url.searchParams.set('collectNegatives',order.collect_negatives);
 const members=order.customer_id?await db.select('rc_members',`?select=card_token&customer_id=eq.${order.customer_id}&limit=1`):[];
 if(members[0]?.card_token)url.hash=new URLSearchParams({rollCall:members[0].card_token}).toString();
 const result=await db.rpc('dispatch_correct_delivery',{p_order:order.id,p_revision:data.revision,p_details:{...details,deliveryUrl:url.href},p_sheets:replacement,p_request:data.requestId});
 return {...result,deliveryUrl:url.href};
}
