const API='https://www.googleapis.com/drive/v3/files';
const TOKEN_URL='https://oauth2.googleapis.com/token';
const FOLDER='application/vnd.google-apps.folder';
const MAX_BYTES=200*1024*1024;
const id=value=>/^[A-Za-z0-9_-]{8,160}$/.test(String(value||''));
const encode=value=>new TextEncoder().encode(value);
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
let cachedToken=null;
async function googleFetch(url,init={}){
 const response=await fetch(url,{...init,redirect:'manual'});
 if(response.status>=300&&response.status<400)throw Error('Google returned an unexpected redirect. Please try again.');
 return response;
}
function settings(env){
 let credentials;try{credentials=JSON.parse(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON||'{}');}catch{throw Error('The Drive connection needs administrator setup.');}
 const root=String(env.GOOGLE_DRIVE_ROOT_FOLDER_ID||'');
 if(!credentials.client_email||!credentials.private_key||!id(root))throw Error('Drive import is not connected yet. Ask Ed to connect the lab scans folder.');
 return {credentials,root,signing:env.CONTACT_SHEETS_UPLOAD_SIGNING_KEY||env.CONTACT_SHEETS_ADMIN_KEY};
}
async function accessToken(config,refresh=false){
 const identity=config.credentials.client_email+'\n'+config.credentials.private_key;
 if(!refresh&&cachedToken?.identity===identity&&cachedToken.expires>Date.now()+60000)return cachedToken.value;
 const now=Math.floor(Date.now()/1000),header=b64(encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),body=b64(encode(JSON.stringify({iss:config.credentials.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:TOKEN_URL,iat:now,exp:now+3600})));
 const pem=config.credentials.private_key.replace(/-----[^-]+-----|\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),char=>char.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encode(header+'.'+body));
 const response=await googleFetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:header+'.'+body+'.'+b64(new Uint8Array(signature))})});
 const result=await response.json();if(!response.ok||!result.access_token)throw Error('Could not connect to Drive. Check the lab Drive connection.');
 cachedToken={identity,value:result.access_token,expires:Date.now()+Number(result.expires_in||3600)*1000};return result.access_token;
}
async function drive(config,url){
 let response=await googleFetch(url,{headers:{Authorization:'Bearer '+await accessToken(config)}});
 if(response.status===401)response=await googleFetch(url,{headers:{Authorization:'Bearer '+await accessToken(config,true)}});
 if(!response.ok){const error=Error(response.status===404||response.status===403?'This folder or file is not available to the lab Drive connection.':response.status===429?'Drive is busy. Please try again shortly.':'Could not read from Drive. Please try again.');error.status=response.status;throw error;}
 return response;
}
async function metadata(config,fileId){if(!id(fileId))throw Error('Invalid Drive item.');const url=new URL(API+'/'+fileId);url.search=new URLSearchParams({fields:'id,name,mimeType,parents,trashed,size,modifiedTime,capabilities(canDownload)',supportsAllDrives:'true'});return (await drive(config,url)).json();}
async function insideRoot(config,file){
 const seen=new Set();let pending=[file.id];
 for(let depth=0;depth<24&&pending.length;depth++){
  const next=[];
  for(const item of pending){if(item===config.root)return;if(seen.has(item))continue;seen.add(item);const value=item===file.id?file:await metadata(config,item);next.push(...(value.parents||[]));}
  pending=next;
 }
 throw Error('Use a folder inside the connected lab scans folder.');
}
async function children(config,parent){
 const output=[];let pageToken='';
 do{
  const url=new URL(API);url.search=new URLSearchParams({q:`'${parent}' in parents and trashed = false`,fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,parents,trashed,size,modifiedTime,capabilities(canDownload))',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(pageToken?{pageToken}:{})});
  const result=await(await drive(config,url)).json();if(result.incompleteSearch)throw Error('Drive returned an incomplete folder listing. Try again.');output.push(...(result.files||[]));if(output.length>4000)throw Error('This folder is too large. Choose the order folder or one roll folder.');pageToken=result.nextPageToken||'';
 }while(pageToken);
 return output.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
}
async function mac(secret,value){if(!secret)throw Error('Drive import signing is not configured.');const key=await crypto.subtle.importKey('raw',encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encode(value))));}
async function ticket(config,file){
 if(file.capabilities?.canDownload===false)throw Error('Download is disabled for '+file.name);
 const size=Number(file.size);if(!Number.isSafeInteger(size)||size<=0||size>MAX_BYTES)throw Error(file.name+' exceeds the 200 MB per-scan limit or has no readable size.');
 const mime=/\.tiff?$/i.test(file.name)?'image/tiff':'image/jpeg';
 const payload=b64(encode(JSON.stringify({id:file.id,root:config.root,name:file.name,mime,size,modified:file.modifiedTime,exp:Date.now()+30*60*1000})));
 return {id:file.id,name:file.name,size,mimeType:mime,ticket:payload+'.'+await mac(config.signing,payload)};
}
export async function listDriveScans(env,data){
 const config=settings(env);let url;try{url=new URL(data.folderUrl);}catch{throw Error('Enter the order’s Drive folder link.');}
 if(url.protocol!=='https:'||url.hostname!=='drive.google.com')throw Error('Use a Google Drive folder link.');
 const folderId=url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/)?.[1];if(!id(folderId))throw Error('Use the Drive folder link, not an individual file link.');
 const root=await metadata(config,folderId);if(root.trashed||root.mimeType!==FOLDER)throw Error('Choose a Drive folder.');await insideRoot(config,root);
 const groups=[];let visited=0,total=0;
 async function scan(folder,depth){
  if(++visited>100||depth>5)throw Error('This folder has too many nested folders. Choose a smaller order folder.');
  const items=await children(config,folder.id),files=items.filter(file=>/\.(jpe?g|tiff?)$/i.test(file.name)&&!file.mimeType.startsWith('application/vnd.google-apps.'));
  if(files.length){total+=files.length;if(files.length>200||total>2000||groups.length>=20)throw Error('Use up to 20 roll folders, with at most 200 scans per roll.');const prepared=[];for(const file of files)prepared.push(await ticket(config,file));groups.push({id:folder.id,name:folder.name,files:prepared});}
  for(const child of items.filter(file=>file.mimeType===FOLDER))await scan(child,depth+1);
 }
 await scan(root,0);if(!groups.length)throw Error('No JPEG or TIFF scans were found in this folder.');
 return {folderName:root.name,groups,totalFiles:total};
}
export async function verifyDriveRoot(env){
 const config=settings(env),folder=await metadata(config,config.root);
 if(folder.trashed||folder.mimeType!==FOLDER)throw Error('Choose the lab scans root folder.');
 return {id:folder.id,name:folder.name};
}
export async function getDriveScan(env,data,headers={}){
 const config=settings(env),[body,signature,extra]=String(data.ticket||'').split('.');if(!body||!signature||extra||body.length>2000)throw Error('Invalid Drive import ticket.');
 const expected=await mac(config.signing,body);let different=expected.length^signature.length;for(let i=0;i<expected.length;i++)different|=expected.charCodeAt(i)^signature.charCodeAt(i);if(different)throw Error('Invalid Drive import ticket.');
 let item;try{item=JSON.parse(new TextDecoder().decode(unb64(body)));}catch{throw Error('Invalid Drive import ticket.');}
 if(item.root!==config.root||!id(item.id)||Date.now()>item.exp||!Number.isSafeInteger(item.size)||item.size>MAX_BYTES)throw Error('Drive import expired. Load the folder again.');
 // Recheck membership and revision so a moved or replaced file cannot reuse an earlier ticket.
 const file=await metadata(config,item.id);if(file.trashed||file.capabilities?.canDownload===false||String(file.modifiedTime)!==String(item.modified)||Number(file.size)!==item.size)throw Error('This scan changed in Drive. Load the folder again.');await insideRoot(config,file);
 const url=new URL(API+'/'+item.id);url.search=new URLSearchParams({alt:'media',supportsAllDrives:'true'});const response=await drive(config,url);
 return new Response(response.body,{headers:{...headers,'Content-Type':item.mime,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
}
