(function(){
 const {useState,useEffect,useRef,useMemo}=React;
 const dateText=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.split('-').reverse().join('/'):'';
 function parseDate(value){const m=String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!m)return null;const iso=`${m[3]}-${m[2]}-${m[1]}`;return !Number.isNaN(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:null;}
 function Editor({orderNumber,api,upload,readDriveFile,Preview,themes,onClose,onSaved}){
  const [record,setRecord]=useState(null),[details,setDetails]=useState(null),[sheets,setSheets]=useState([]),[tab,setTab]=useState('details'),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stage,setStage]=useState(''),[original,setOriginal]=useState(''),[previewIndex,setPreviewIndex]=useState(0);
  const modal=useRef(null),resources=useRef([]),pending=useRef(null),saving=useRef(false),mounted=useRef(true);
  const [replacementName,setReplacementName]=useState('');
  const [folderChecked,setFolderChecked]=useState(false);
  const [preparedFiles,setPreparedFiles]=useState({}),[preparedCount,setPreparedCount]=useState(0);
  const [labelIndex,setLabelIndex]=useState(null),[labelFilm,setLabelFilm]=useState(''),[labelName,setLabelName]=useState(''),[labelBusy,setLabelBusy]=useState(false),[previewFormat,setPreviewFormat]=useState('landscape');
  const labelController=useRef(null);
  const workspaceEpoch=useRef(0);
  useEffect(()=>{
   let live=true;mounted.current=true;const previous=document.activeElement,oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
   api('getDeliveryForEdit',{orderNumber}).then(value=>{if(!live)return;if(value?.error)throw Error(value.error);setRecord(value);setDetails({...value.details,date:dateText(value.details.date)});setSheets(value.sheets||[]);}).catch(error=>{if(live)setError(error.message);});
   modal.current?.focus();
   return()=>{live=false;mounted.current=false;labelController.current?.abort();document.body.style.overflow=oldOverflow;previous?.focus();resources.current.forEach(url=>URL.revokeObjectURL(url));};
  },[orderNumber]);
  function close(){if(!saving.current)onClose();}
  function keyboard(event){if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const nodes=[...modal.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(node=>node.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}}
  function update(key,value){pending.current=null;if(key==='driveLink')setFolderChecked(false);setError('');setDetails(old=>({...old,[key]:value}));}
  function updateExtraEmails(value){pending.current=null;setError('');setDetails(old=>({...old,extraEmailsText:value,extraEmails:value.split(/[,;]+/).map(email=>email.trim()).filter(Boolean)}));}
  function importOriginal(){
   try{const url=new URL(original);if(url.protocol!=='https:'||url.hostname!=='bali-scans.saujanalab.com'||url.searchParams.get('order')!==orderNumber)throw Error('Use the delivery link for this exact order.');const p=url.searchParams;pending.current=null;setDetails(old=>({...old,name:p.get('name')||old.name,film:p.get('film')||old.film,theme:['colour','classic','bw'].includes(p.get('negative'))?p.get('negative'):'colour',date:dateText(p.get('date'))||old.date}));setError('');}catch(error){setError(error.message||'Check the original delivery link.');}
  }
  const selectedSheet=sheets.find(sheet=>sheet.rollIndex===selected);
  useEffect(()=>{setPreparedFiles({});setPreparedCount(selectedSheet?.frameCount||0);},[selected]);
  const generatorRolls=useMemo(()=>[replacementName||selectedSheet?.filmName||details?.film||''],[replacementName,selectedSheet?.filmName,details?.film]);
  function stageSheet(sheet,index){
   if(!mounted.current){URL.revokeObjectURL(sheet.deliveryPreviewUrl);URL.revokeObjectURL(sheet.storyPreviewUrl);return;}
   if(index===null)return;
   resources.current.push(sheet.deliveryPreviewUrl,sheet.storyPreviewUrl);pending.current=null;
   workspaceEpoch.current++;setSheets(old=>old.map(item=>item.rollIndex===index?{...sheet,rollIndex:index,draft:false,replaced:true,generatedName:details.name}:item));setSelected(null);setLabelIndex(null);setError('');
  }
  function removeSheet(sheet){
   pending.current=null;workspaceEpoch.current++;
   const saved=record.sheets.some(item=>item.rollIndex===sheet.rollIndex);
   setSheets(old=>saved?old.map(item=>item.rollIndex===sheet.rollIndex?{...item,removed:!item.removed}:item):old.filter(item=>item.rollIndex!==sheet.rollIndex));
   setSelected(null);setLabelIndex(null);setError('');
  }
  function cancelReplacement(){
   workspaceEpoch.current++;setSheets(old=>old.filter(item=>item.rollIndex!==selected||!item.draft));setSelected(null);setError('');
  }
  function prepared(sheet){stageSheet(sheet,selected);}
  async function prepareLabel(){
   if(labelBusy)return;setLabelBusy(true);setError('');const controller=new AbortController();labelController.current=controller;
   const timer=setTimeout(()=>controller.abort(),20000);
   try{const sheet=sheets.find(item=>item.rollIndex===labelIndex);const corrected=await SaujanaContactSheetLabel.prepare({sheet,filmName:labelFilm,customerName:labelName,signal:controller.signal});stageSheet(corrected,labelIndex);}
   catch(error){if(mounted.current)setError(error.name==='AbortError'?'The saved sheets took too long to load. Please try again.':error.message);}
   finally{clearTimeout(timer);labelController.current=null;if(mounted.current)setLabelBusy(false);}
  }
  async function useJpegs(){
   const epoch=workspaceEpoch.current;
   try{
    if(!replacementName.trim())throw Error('Enter the replacement film name.');
    for(const key of ['landscape','portrait']){
     const file=preparedFiles[key];if(!file||file.size>20*1024*1024)throw Error('Choose both JPEGs, up to 20 MB each.');
     const bytes=new Uint8Array(await file.slice(0,2).arrayBuffer());if(bytes[0]!==255||bytes[1]!==216)throw Error('Both prepared sheets must be JPEG files.');
     const image=await createImageBitmap(file);const valid=key==='landscape'?image.width>image.height:image.height>image.width;image.close();if(!valid)throw Error(`Check the ${key} sheet orientation.`);
    }
    const count=Number(preparedCount);if(!Number.isInteger(count)||count<0||count>200)throw Error('Enter a frame count from 0 to 200.');
    if(epoch!==workspaceEpoch.current||!mounted.current)return;
    prepared({filmName:replacementName.trim(),frameCount:count,scanStyle:'classic',format:'full-frame',deliveryBlob:preparedFiles.landscape,storyBlob:preparedFiles.portrait,deliveryPreviewUrl:URL.createObjectURL(preparedFiles.landscape),storyPreviewUrl:URL.createObjectURL(preparedFiles.portrait)});
   }catch(error){setError(error.message);}
  }
  function validate(){if(!details?.name.trim()||!details.film.trim())throw Error('Enter the delivery name and film details.');const emails=[details.email,...(details.extraEmails||[])].filter(Boolean);if(emails.some(email=>email.length>320||!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email))||!details.email&&details.extraEmails?.length)throw Error('Enter valid delivery email addresses, with a primary email first.');if(sheets.some(sheet=>sheet.replaced&&!sheet.removed&&sheet.generatedName!==details.name))throw Error('Prepare the replacement sheets again with the updated delivery name.');if(!themes.some(item=>item.value===details.theme))throw Error('Choose the delivery theme.');if(!parseDate(details.date))throw Error('Enter the delivery date as DD/MM/YYYY.');let url;try{url=new URL(details.driveLink);}catch{throw Error('Enter the Google Drive folder link.');}if(url.protocol!=='https:'||url.hostname!=='drive.google.com'||!/^\/drive\/folders\/[A-Za-z0-9_-]+\/?$/.test(url.pathname))throw Error('Use the Google Drive folder link for this order.');}
  function review(){if(sheets.some(sheet=>sheet.draft)){setError('Finish or remove the new contact sheet before continuing.');setTab('sheets');return;}try{validate();setError('');setTab('review');}catch(error){setError(error.message);setTab('details');}}
  async function save(){
   if(saving.current)return;saving.current=true;setBusy(true);setError('');
   try{
    validate();let payload=pending.current;
    if(!payload){
     const changed=sheets.some(sheet=>sheet.replaced||sheet.removed),remaining=sheets.filter(sheet=>!sheet.removed);let uploadNonce='',uploaded=null;
     if(changed){
      setStage('Preparing replacement upload');const session=await api('beginContactSheetUpload',{orderNumber});if(session?.error||!session?.uploadNonce)throw Error(session?.error||'Could not start sheet replacement.');uploadNonce=session.uploadNonce;uploaded=[];
      for(const sheet of remaining){
       if(!sheet.replaced){uploaded.push(sheet);continue;}
       setStage(`Uploading roll ${sheet.rollIndex+1} · Landscape`);const deliveryUrl=await upload({orderNumber,uploadNonce,sheet,variant:'delivery'});
       setStage(`Uploading roll ${sheet.rollIndex+1} · Portrait`);const storyUrl=await upload({orderNumber,uploadNonce,sheet,variant:'story'});
       uploaded.push({...sheet,deliveryUrl,storyUrl});
      }
     }
     const {email,extraEmails,extraEmailsText,...deliveryDetails}=details;
     const recipientsChanged=email!==record.details.email||JSON.stringify(extraEmails||[])!==JSON.stringify(record.details.extraEmails||[]);
     payload={orderNumber,revision:record.revision,requestId:crypto.randomUUID(),driveLinkConfirmed:folderChecked,details:{...deliveryDetails,date:parseDate(details.date),...(recipientsChanged?{email,extraEmails}:{})},...(changed?{uploadNonce,contactSheets:uploaded.map(({rollIndex,filmName,frameCount,scanStyle,format,deliveryUrl,storyUrl})=>({rollIndex,filmName,frameCount,scanStyle,format,deliveryUrl,storyUrl}))}:{})};pending.current=payload;
    }
    setStage('Applying delivery correction');const result=await api('correctDelivery',payload);if(!result?.success)throw Error(result?.error||'Could not save this delivery.');pending.current=null;onSaved(result);
   }catch(error){setError(error.message||'Nothing was published. Please try again.');}
   finally{saving.current=false;setBusy(false);setStage('');}
  }
  const visible=sheets.filter(sheet=>!sheet.removed&&!sheet.draft),theme=themes.find(item=>item.value===details?.theme)||themes[0],generatorEpoch=workspaceEpoch.current;
  const previews=visible.map(sheet=>({...sheet,deliveryPreviewUrl:previewFormat==='portrait'?(sheet.storyPreviewUrl||sheet.storyUrl):(sheet.deliveryPreviewUrl||sheet.deliveryUrl),storyPreviewUrl:sheet.storyPreviewUrl||sheet.storyUrl}));
  return <div className="delivery-editor-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}><section className="delivery-editor" role="dialog" aria-modal="true" aria-labelledby="delivery-editor-title" tabIndex="-1" ref={modal} onKeyDown={keyboard}>
   <header className="delivery-editor-header"><div><h2 id="delivery-editor-title">Fix Delivery</h2><span>ORDER {orderNumber}</span></div><button type="button" aria-label="Close delivery editor" title="Close" disabled={busy} onClick={close}>×</button></header>
   {record&&<nav className="delivery-editor-tabs" aria-label="Delivery editor views">{[['details','Details'],['sheets','Contact sheets'],['review','Review']].map(([key,label])=><button type="button" key={key} disabled={busy||labelBusy} aria-pressed={tab===key} onClick={()=>key==='review'?review():setTab(key)}>{label}</button>)}</nav>}
   <div className="delivery-editor-body">
    {error&&<p className="delivery-editor-error" role="alert">{error}</p>}
    {!details&&!error&&<p role="status">Loading saved delivery...</p>}
    {details&&tab==='details'&&<>
     {!record.hasSavedLink&&<p className="delivery-editor-warning">The original sent link was not stored. Confirm the theme and delivery date before saving.</p>}
     {!record.hasSavedLink&&<details><summary>Original delivery link</summary><label>Original link<input type="url" value={original} onChange={event=>setOriginal(event.target.value)}/></label><button type="button" onClick={importOriginal}>Use original link details</button></details>}
     <div className="delivery-editor-fields">
      <label>Delivery name<input aria-label="Delivery name" value={details.name} maxLength="200" onChange={event=>update('name',event.target.value)}/></label>
      <label>Delivery email<input aria-label="Delivery email" type="email" value={details.email||''} maxLength="320" onChange={event=>update('email',event.target.value)}/></label>
      <label className="delivery-editor-wide">Additional emails<input aria-label="Additional emails" value={details.extraEmailsText??(details.extraEmails||[]).join(', ')} onChange={event=>updateExtraEmails(event.target.value)}/></label>
      <label>Film details<input aria-label="Film details" value={details.film} maxLength="2000" onChange={event=>update('film',event.target.value)}/></label>
      <label>Delivery theme<select aria-label="Delivery theme" value={details.theme} onChange={event=>update('theme',event.target.value)}><option value="">Choose theme</option>{themes.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Delivery date (DD/MM/YYYY)<input aria-label="Delivery date (DD/MM/YYYY)" inputMode="numeric" value={details.date} maxLength="10" onChange={event=>update('date',event.target.value)}/></label>
      <label className="delivery-editor-wide">Google Drive folder link<input aria-label="Google Drive folder link" type="url" value={details.driveLink} onChange={event=>update('driveLink',event.target.value)}/></label>
      <label className="delivery-editor-wide">Staff note<textarea aria-label="Staff note" rows="3" value={details.notes} maxLength="10000" onChange={event=>update('notes',event.target.value)}/></label>
     </div>
    </>}
    {details&&tab==='sheets'&&<>
     <p className="delivery-editor-warning">For a film-name typo, use Edit film name. No original scans are needed.</p>
     {sheets.some(sheet=>sheet.replaced||sheet.removed||sheet.draft)&&<button type="button" disabled={labelBusy} onClick={()=>{pending.current=null;workspaceEpoch.current++;setSheets(record.sheets);setSelected(null);setLabelIndex(null);}}>Discard sheet changes</button>}
     <ul className="delivery-editor-sheets">{sheets.map(sheet=><li key={sheet.rollIndex}>{(sheet.deliveryPreviewUrl||sheet.deliveryUrl)&&<img src={sheet.deliveryPreviewUrl||sheet.deliveryUrl} alt={`${sheet.filmName} saved contact sheet`}/>}<div><strong>Roll {sheet.rollIndex+1} · {sheet.filmName}</strong><span>{sheet.draft?'New sheet · not ready':sheet.removed?'Will be removed':sheet.labelOnly?'Film name corrected':sheet.replaced?'Replacement prepared':'Keep existing sheet'} · {sheet.frameCount} frames</span></div><div><button type="button" disabled={busy||labelBusy||sheet.removed||!sheet.deliveryUrl&&!sheet.deliveryBlob} onClick={()=>{workspaceEpoch.current++;setSelected(null);setLabelIndex(sheet.rollIndex);setLabelFilm(sheet.filmName);setLabelName(details.name);setError('');}}>Edit film name</button><button type="button" disabled={busy||labelBusy||sheet.removed} onClick={()=>{workspaceEpoch.current++;setLabelIndex(null);setReplacementName(sheet.filmName);setSelected(sheet.rollIndex);}}>{sheet.draft?'Continue':'Replace'}</button><button type="button" disabled={busy||labelBusy} onClick={()=>removeSheet(sheet)}>{sheet.removed?'Undo remove':'Remove'}</button></div></li>)}</ul>
     {labelIndex!==null&&<div className="delivery-editor-label-form"><h3>Edit film name · Roll {labelIndex+1}</h3><label>Film name on sheet<input aria-label="Film name on sheet" maxLength="120" value={labelFilm} disabled={labelBusy} onChange={event=>setLabelFilm(event.target.value)}/></label><label>Name on sheet<input aria-label="Name on sheet" maxLength="200" value={labelName} disabled={labelBusy} onChange={event=>setLabelName(event.target.value)}/></label><button type="button" disabled={labelBusy} onClick={prepareLabel}>{labelBusy?'Updating...':'Confirm change'}</button><button type="button" disabled={labelBusy} onClick={()=>setLabelIndex(null)}>Cancel</button></div>}
     {sheets.length<20&&<button type="button" disabled={labelBusy||sheets.some(sheet=>sheet.draft)} onClick={()=>{workspaceEpoch.current++;const index=Array.from({length:20},(_,i)=>i).find(i=>!sheets.some(sheet=>sheet.rollIndex===i));setSheets(old=>[...old,{rollIndex:index,filmName:details.film,frameCount:0,draft:true,removed:false}]);setLabelIndex(null);setReplacementName(details.film);setSelected(index);}}>Add contact sheet</button>}
     {selected!==null&&<div className="delivery-editor-generator"><button type="button" onClick={cancelReplacement}>{selectedSheet?.draft?'Cancel new sheet':'Cancel replacement'}</button><label>Replacement film name<input aria-label="Replacement film name" value={replacementName} onChange={event=>setReplacementName(event.target.value)}/></label><details><summary>Upload replacement contact sheets</summary><label>Landscape JPEG<input aria-label="Landscape JPEG" type="file" accept="image/jpeg,.jpg,.jpeg" onChange={event=>setPreparedFiles(old=>({...old,landscape:event.target.files[0]}))}/></label><label>Portrait JPEG<input aria-label="Portrait JPEG" type="file" accept="image/jpeg,.jpg,.jpeg" onChange={event=>setPreparedFiles(old=>({...old,portrait:event.target.files[0]}))}/></label><label>Frame count<input aria-label="Frame count" type="number" min="0" max="200" value={preparedCount} onChange={event=>setPreparedCount(event.target.value)}/></label><button type="button" onClick={useJpegs}>Confirm replacement</button></details><ContactSheetGenerator key={`${selected}:${generatorEpoch}`} embedded driveLink={details.driveLink} driveApi={api} readDriveFile={readDriveFile} orderNumber={orderNumber} customerName={details.name} rolls={generatorRolls} onSheetsChange={sheet=>{if(generatorEpoch!==workspaceEpoch.current){URL.revokeObjectURL(sheet.deliveryPreviewUrl);URL.revokeObjectURL(sheet.storyPreviewUrl);return;}prepared(sheet);}}/></div>}
    </>}
    {details&&tab==='review'&&<>
     <p className="delivery-editor-warning">Apply updates this existing delivery. No new order is created. Already-sent links for this order will show the saved correction when reopened.</p>
     <dl className="delivery-editor-summary"><dt>Film details</dt><dd>{details.film}</dd><dt>Delivery email</dt><dd>{details.email||'None'}</dd>{!!details.extraEmails?.length&&<><dt>Additional emails</dt><dd>{details.extraEmails.join(', ')}</dd></>}<dt>Delivery date</dt><dd>{details.date}</dd><dt>Drive folder</dt><dd>{details.driveLink}</dd><dt>Staff note</dt><dd>{details.notes||'None'}</dd></dl>
     {details.driveLink.trim()!==record.details.driveLink&&<label className="delivery-editor-folder-check"><input type="checkbox" checked={folderChecked} onChange={event=>{pending.current=null;setFolderChecked(event.target.checked);}}/>I checked that this folder belongs to order {orderNumber}.</label>}
     {!!previews.length&&<div className="delivery-editor-tabs" role="group" aria-label="Sheet preview format">{['landscape','portrait'].map(format=><button type="button" key={format} aria-pressed={previewFormat===format} onClick={()=>setPreviewFormat(format)}>{format==='landscape'?'Landscape':'Portrait'}</button>)}</div>}
     <Preview theme={theme} customerName={details.name} orderNumber={orderNumber} sheets={previews} activeSheet={previews[Math.min(previewIndex,previews.length-1)]} previewRoll={Math.min(previewIndex,Math.max(0,previews.length-1))} setPreviewRoll={setPreviewIndex} driveLink={details.driveLink}/>
     {!!sheets.filter(sheet=>sheet.removed).length&&<p className="delivery-editor-warning">Remove: {sheets.filter(sheet=>sheet.removed).map(sheet=>`Roll ${sheet.rollIndex+1}`).join(', ')}</p>}
    </>}
   </div>
   <footer className="delivery-editor-footer"><span role="status">{busy?stage:labelBusy?'Correcting both sheet labels...':'Nothing changes until Apply changes.'}</span><button type="button" disabled={busy} onClick={close}>Cancel</button>{details&&(tab==='review'?<button className="delivery-editor-primary" type="button" disabled={busy||(details.driveLink.trim()!==record.details.driveLink&&!folderChecked)} onClick={save}>{busy?'Saving...':'Apply changes'}</button>:<button className="delivery-editor-primary" type="button" disabled={labelBusy} onClick={review}>Review changes</button>)}</footer>
  </section></div>;
 }
 window.SaujanaDeliveryEditor=Editor;
})();
