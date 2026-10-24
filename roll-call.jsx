(function () {
  const {useState,useEffect,useRef}=React;
  const cardLink=token=>`${window.ROLL_CALL_BASE || 'https://bali-scans.saujanalab.com'}/roll-call/#token=${encodeURIComponent(token)}`;
  const available=snapshot=>(snapshot?.rewards||[]).filter(reward=>reward.displayStatus==='available');
  const when=value=>new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});
  function useRecord(customerId,orderId,api) {
    const [record,setRecord]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
    const sequence=useRef(0);
    async function load() {
      const current=++sequence.current;setLoading(true);setError('');
      try {const value=await api('getRollCall',{customerId,orderId});if(value?.error) throw Error(value.error);if(current===sequence.current)setRecord(value);}
      catch(error){if(current===sequence.current)setError(error.message);}
      finally{if(current===sequence.current)setLoading(false);}
    }
    useEffect(()=>{setRecord(null);load();return()=>{sequence.current++;};},[customerId,orderId]);
    return {record,setRecord,error,setError,loading,load};
  }
  function Summary({snapshot}) {
    return <div className="rc-summary"><strong>{snapshot.member.number}</strong><span>Card {snapshot.currentCard.number} · {snapshot.currentCard.stamps}/10 stamps</span><span>{snapshot.completedCards} completed · {available(snapshot).length} {available(snapshot).length===1?'reward':'rewards'} available</span><div className="rc-mini" aria-label={`${snapshot.currentCard.stamps} of 10 stamps`}>{Array.from({length:10},(_,index)=><span key={index} className={index<snapshot.currentCard.stamps?'filled':''}>{index+1}</span>)}</div></div>;
  }
  function Opening({value,onChange}) {
    return <div className="rc-fields">{[['completedCards','Completed paper cards'],['currentStamps','Stamps on current card'],['unusedRewards','Unused paper rewards']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min="0" max={key==='currentStamps'?9:1000} step="1" value={value[key]} onChange={event=>onChange({...value,[key]:event.target.value})}/></label>)}</div>;
  }
  function CustomerPanel({customer,api}) {
    const state=useRecord(customer.id,null,api),snapshot=state.record?.snapshot;
    const [open,setOpen]=useState(false),[paper,setPaper]=useState({completedCards:0,currentStamps:0,unusedRewards:0});
    const [quantity,setQuantity]=useState(1),[removeQuantity,setRemoveQuantity]=useState(1),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
    const [paperDates,setPaperDates]=useState({});
    const running=useRef(false),pending=useRef(null);
    useEffect(()=>{setOpen(false);setNotice('');setQuantity(1);setRemoveQuantity(1);setPaperDates({});pending.current=null;setPaper({completedCards:0,currentStamps:0,unusedRewards:0});},[customer.id]);
    async function command(operation,input,message) {
      if(running.current)return;
      running.current=true;setBusy(true);state.setError('');setNotice('');
      const payload={memberId:snapshot?.member.id,...input};
      if(operation==='reverse')payload.expectedUsedAt=snapshot.rewards.find(item=>item.id===input.rewardId)?.usedAt||null;
      const signature=JSON.stringify({operation,payload});
      if(pending.current?.signature!==signature)pending.current={signature,id:crypto.randomUUID()};
      try {
        const result=await api('rollCallCommand',{operation,requestId:pending.current.id,input:payload});
        if(result?.error){pending.current=null;throw Error(result.error);}
        pending.current=null;state.setRecord({snapshot:result.snapshot,attached:false});
        setNotice(message);setQuantity(1);setRemoveQuantity(1);setOpen(false);
        if(window.BroadcastChannel){const updates=new BroadcastChannel('roll-call-updates');updates.postMessage({memberNumber:result.snapshot.member.number});updates.close();}
      }catch(error){state.setError(error.message);}
      finally{running.current=false;setBusy(false);}
    }
    function addStamps() {
      const count=Number(quantity);
      if(!Number.isInteger(count)||count<1||count>200)return state.setError('Choose between 1 and 200 stamps.');
      command('add_stamps',{quantity:count,expectedVersion:snapshot.member.version},`${count} ${count===1?'stamp':'stamps'} added.`);
    }
    function savePaper() {
      command(snapshot?'opening':'enroll',{customerId:customer.id,expectedVersion:snapshot?.member.version,...paper},snapshot?'Paper progress corrected.':'Roll Call enabled.');
    }
    function removeStamps() {
      const count=Number(removeQuantity);
      if(!Number.isInteger(count)||count<1||count>Math.min(200,snapshot.totalStamps))return state.setError('Choose how many stamps to remove, up to the current total.');
      command('remove_stamps',{quantity:count,expectedVersion:snapshot.member.version},`${count} ${count===1?'stamp':'stamps'} removed.`);
    }
    const rewards=snapshot?.rewards.filter(item=>item.status!=='void')||[];
    const ready=rewards.filter(item=>['available','verify'].includes(item.displayStatus));
    const used=rewards.filter(item=>!['available','verify'].includes(item.displayStatus));
    function rewardRow(item,manage=false) {
      return <div key={item.id} className="rc-reward-row">
        <span>Card {item.cardNumber} · stamp {item.atStamp}</span>
        <b>{item.displayStatus==='available'?'READY':item.displayStatus==='verify'?'CHECK DATE':item.displayStatus==='expired'?'EXPIRED':'USED'}</b>
        {item.expiresAt&&<small>{item.displayStatus==='expired'?'Expired':'Valid until'} {new Date(item.expiresAt).toLocaleDateString('en-GB')}</small>}
        {item.displayStatus==='verify'&&<label>Original paper stamp date<input type="date" aria-label={`Paper stamp date for card ${item.cardNumber} stamp ${item.atStamp}`} value={paperDates[item.id]||''} onChange={event=>setPaperDates({...paperDates,[item.id]:event.target.value})}/></label>}
        {['available','verify'].includes(item.displayStatus)&&<button className="rc-primary" disabled={busy||item.displayStatus==='verify'&&!paperDates[item.id]} onClick={()=>command('redeem',{rewardId:item.id,paperEarnedOn:paperDates[item.id]},'Reward marked USED.')}>Mark used</button>}
        {manage&&['redeemed','used_on_paper'].includes(item.status)&&<button className="rc-primary" disabled={busy} onClick={()=>command('reverse',{rewardId:item.id},'Reward restored. Original expiry retained.')}>Mark ready</button>}
        {item.usedAt&&<small>Used {when(item.usedAt)}</small>}
      </div>;
    }
    return <section className="rc-staff" aria-label="Customer Roll Call">
      <div className="rc-title"><h3>ROLL CALL</h3><span>{state.loading?'Loading…':snapshot?'MEMBER':'NOT ENROLLED'}</span></div>
      {state.error&&<p role="alert" className="rc-error">{state.error} <button onClick={state.load}>Refresh card</button></p>}
      {notice&&<p role="status" className="rc-notice">{notice}</p>}
      {snapshot&&<>
        <Summary snapshot={snapshot}/>
        <div className="rc-add-stamps">
          <label htmlFor="rc-stamp-count">Stamps to add</label>
          <div className="rc-stamp-controls">
            <button type="button" aria-label="One fewer stamp" disabled={busy||Number(quantity)<=1} onClick={()=>setQuantity(Math.max(1,Number(quantity)-1))}>−</button>
            <input id="rc-stamp-count" type="number" min="1" max="200" step="1" value={quantity} disabled={busy} onChange={event=>setQuantity(event.target.value)}/>
            <button type="button" aria-label="One more stamp" disabled={busy||Number(quantity)>=200} onClick={()=>setQuantity(Math.min(200,Number(quantity)+1))}>+</button>
            <button className="rc-primary" disabled={busy} onClick={addStamps}>{busy?'Saving…':'Add stamps'}</button>
          </div>
          <p className="rc-muted">1 paid roll = 1 stamp. Complimentary rolls do not count.</p>
        </div>
        <div className="rc-actions"><a href={cardLink(snapshot.member.cardToken)} target="_blank" rel="noopener noreferrer">View card</a><button onClick={async()=>{await navigator.clipboard.writeText(cardLink(snapshot.member.cardToken));setNotice('Card link copied.');}}>Copy card link</button></div>
        <div className="rc-rewards-heading">REWARDS <span>{available(snapshot).length} ready</span></div>
        {ready.length?ready.map(item=>rewardRow(item)):<p className="rc-muted">Next reward at stamp 5 or 10.</p>}
        {!!used.length&&<details className="rc-disclosure"><summary>Used &amp; expired rewards <span>{used.length}</span></summary>{used.map(item=>rewardRow(item))}</details>}
        <details className="rc-disclosure rc-manage"><summary>Manage card</summary>
          <label htmlFor="rc-remove-count">Stamps to remove</label>
          <div className="rc-remove-controls"><input id="rc-remove-count" type="number" min="1" max={Math.min(200,snapshot.totalStamps)} value={removeQuantity} onChange={event=>setRemoveQuantity(event.target.value)} disabled={busy||!snapshot.totalStamps}/><button disabled={busy||!snapshot.totalStamps} onClick={removeStamps}>Remove stamps</button></div>
          <div className="rc-rewards-heading">VOUCHER STATUS</div>
          {rewards.map(item=>rewardRow(item,true))}
        </details>
        <details className="rc-disclosure"><summary>Activity</summary>
          <ul className="rc-audit">{snapshot.audit.map(event=><li key={event.id}><strong>{event.action==='add_stamps'?`+${event.after?.input?.quantity||''} stamps`:event.action==='remove_stamps'?`-${event.after?.input?.quantity||''} stamps`:event.action==='redeem'?'Reward marked used':event.action==='undo_stamps'?'Stamps removed':event.action==='reverse'?'Reward restored':event.action}</strong><br/><time>{when(event.createdAt)}</time>{event.reason&&<p>{event.reason}</p>}</li>)}</ul>
        </details>
      </>}
      {!snapshot&&!state.loading&&!state.error&&<button className="rc-primary" disabled={busy} onClick={()=>setOpen(!open)}>Enable Roll Call</button>}
      {open&&<div className="rc-form"><Opening value={paper} onChange={setPaper}/><div className="rc-actions"><button className="rc-primary" disabled={busy} onClick={savePaper}>{busy?'Saving…':'Enable membership'}</button><button disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div></div>}
    </section>;
  }

  const reportDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Makassar',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const usedTime=value=>new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Makassar',dateStyle:'medium',timeStyle:'short'});
  function redemptionText(item) {
    return `${item.name}\n${item.email||'No email recorded'}\n${item.memberNumber} · Card ${String(item.cardNumber).padStart(3,'0')} · Stamp ${item.atStamp}\n1 free C-41 develop + scan · USED\nUsed ${usedTime(item.usedAt)} (Bali)\nVoucher ${item.rewardId}`;
  }
  function dailyReportText(report) {
    return `ROLL CALL · FREE DEVSCAN\n${report.items.length} ${report.items.length===1?'voucher':'vouchers'} used\n`+
      report.items.map(redemptionText).join('\n\n');
  }
  async function loadDailyReport(api) {
    const result=await api('getRollCallReport',{date:reportDay()});
    if(result?.error||!Array.isArray(result?.items))throw Error(result?.error||'Could not load Roll Call redemptions.');
    return result;
  }
  let proofAssets;
  async function createProof(item) {
    const script=document.querySelector('script[src*="roll-call.jsx"]');
    const loadImage=src=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(Error('Could not load card artwork.'));image.src=new URL(src,script?.src||location.href).href;});
    const [art,stamp]=await (proofAssets ||= Promise.all([loadImage('roll-call-assets/roll-call-back.png'),loadImage('roll-call-assets/stamp.png')]).catch(error=>{proofAssets=null;throw error;}));
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1900;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f4eee2';ctx.fillRect(0,0,1000,1900);
    const line=(text,y,size=24,color='#173a70')=>{let font=size;do{ctx.font=`bold ${font}px Arial`;if(ctx.measureText(text).width<=880)break;font--;}while(font>10);ctx.fillStyle=color;ctx.fillText(text,60,y);};
    line('ROLL CALL / REDEMPTION RECORD',55,22);line(item.name,104,36);line(item.email||'No email recorded',142,22);
    line(`${item.memberNumber} / CARD ${String(item.cardNumber).padStart(3,'0')} / STAMP ${item.atStamp}`,181,24);
    const x=110,y=220,w=780,h=w*2000/1223;ctx.drawImage(art,x,y,w,h);
    for(let i=1;i<=item.cardStamps;i++){
      let hash=2166136261;for(const c of `${item.memberNumber}:${item.cardNumber}:${i}`)hash=Math.imul(hash^c.charCodeAt(0),16777619);
      const channel=shift=>(hash>>>shift)&15;
      const sw=w*.164,sh=sw*243/206;
      const sx=x+([.044,.238,.432,.626,.82][(i-1)%5])*w,sy=y+(i>5?.48:.185)*h;
      const cx=sx+sw/2+(channel(0)-7.5)*.0062*sw,cy=sy+h*.1+(channel(4)-7.5)*.005*sh;
      const tinted=document.createElement('canvas');tinted.width=stamp.width;tinted.height=stamp.height;
      const ink=tinted.getContext('2d');ink.drawImage(stamp,0,0);ink.globalCompositeOperation='source-in';ink.fillStyle=i===5||i===10?'#215283':'#ec424e';ink.fillRect(0,0,tinted.width,tinted.height);
      ctx.save();ctx.translate(cx,cy);ctx.rotate((channel(8)-7.5)*1.16*Math.PI/180);ctx.scale(.93+channel(12)*.005,.93+channel(12)*.005);ctx.globalAlpha=.74+channel(16)*.011;ctx.globalCompositeOperation='multiply';ctx.drawImage(tinted,-sw/2,-sh/2,sw,sh);ctx.restore();
      if(i===item.atStamp){ctx.save();ctx.translate(cx,cy);ctx.rotate(-8*Math.PI/180);ctx.fillStyle='#f4eee2';ctx.fillRect(-58,-23,116,46);ctx.strokeStyle='#215283';ctx.lineWidth=4;ctx.strokeRect(-58,-23,116,46);ctx.fillStyle='#215283';ctx.font='bold 30px monospace';ctx.textAlign='center';ctx.fillText('USED',0,10);ctx.restore();}
    }
    line('FREE C-41 DEVELOP + SCAN / USED',1580,30);
    line(`Recorded ${usedTime(item.usedAt)} (Bali)`,1628,23);
    line('Voucher '+item.rewardId,1670,18);
    line('One complimentary C-41 develop + scan.',1720,23,'#191919');
    line('Saujana Film Lab Bali',1815,24);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not create proof image.')),'image/png'));
  }
  async function createDailyProof(report,page=0) {
    const pages=Math.max(1,Math.ceil(report.items.length/6)),current=Math.min(Math.max(0,page),pages-1);
    const items=report.items.slice(current*6,current*6+6),portrait=items.length>3;
    const canvas=document.createElement('canvas');canvas.width=portrait?1700:2400;canvas.height=portrait?2400:1700;
    const ctx=canvas.getContext('2d'),width=canvas.width,height=canvas.height;
    ctx.fillStyle='#f4eee2';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#173a70';ctx.font='bold 48px Arial';ctx.fillText('ROLL CALL / DAILY REDEMPTIONS',70,85);
    ctx.font='26px Arial';ctx.fillText(`${report.date} · Bali · ${new Set(report.items.map(item=>item.memberNumber)).size} members · ${report.items.length} vouchers used`,70,135);
    ctx.strokeStyle='#173a70';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(70,165);ctx.lineTo(width-70,165);ctx.stroke();
    const tileWidth=portrait?500:720,tileHeight=tileWidth*1.9,columns=Math.min(3,items.length);
    for(let index=0;index<items.length;index++){
      const row=Math.floor(index/3),column=index%3,rowCount=Math.min(3,items.length-row*3);
      const x=(width-rowCount*tileWidth-(rowCount-1)*35)/2+column*(tileWidth+35),y=195+row*(tileHeight+45);
      const bitmap=await createImageBitmap(await createProof(items[index]));ctx.drawImage(bitmap,x,y,tileWidth,tileHeight);bitmap.close();
    }
    if(!items.length){ctx.font='32px Arial';ctx.fillText('No Roll Call vouchers used on this day.',70,260);}
    ctx.fillStyle='#173a70';ctx.font='22px Arial';ctx.fillText('Saujana Film Lab Bali / Internal redemption record',70,height-45);
    ctx.textAlign='right';ctx.fillText(`Page ${current+1} / ${pages}`,width-70,height-45);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not create daily report image.')),'image/png'));
  }
  function ReportPanel({api,report,onChange}) {
    const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
    const [page,setPage]=useState(0),[preview,setPreview]=useState('');
    useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
    const pages=Math.max(1,Math.ceil((report?.items.length||0)/6));
    const currentPage=Math.min(page,pages-1);
    async function refresh(){setBusy(true);setError('');try{onChange(await loadDailyReport(api));}catch(error){setError(error.message);}finally{setBusy(false);}}
    useEffect(()=>{refresh();},[]);
    async function daily(mode) {
      setBusy(true);setError('');setNotice('');
      try {
        const fresh=loadDailyReport(api).then(value=>{onChange(value);return value;});
        const image=fresh.then(value=>createDailyProof(value,currentPage));
        if(mode==='copy'){await navigator.clipboard.write([new ClipboardItem({'image/png':image})]);setNotice('Daily report copied as one image. Paste it into the team chat.');return;}
        const blob=await image;
        if(mode==='share'){
          const file=new File([blob],`roll-call-${(await fresh).date}-page-${currentPage+1}.png`,{type:'image/png'});
          if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Roll Call daily report'});return;}
          await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);setNotice('Daily report image copied.');return;
        }
        setPreview(URL.createObjectURL(blob));
      } catch(error){if(error.name!=='AbortError')setError(error.message);}finally{setBusy(false);}
    }
    async function proof(item,share=false){
      setBusy(true);setError('');setNotice('');
      try{
        if(!share){await navigator.clipboard.write([new ClipboardItem({'image/png':createProof(item)})]);setNotice('Card proof copied. Paste it into your report.');return;}
        const blob=await createProof(item),name=`${item.memberNumber}-card-${item.cardNumber}-stamp-${item.atStamp}-used.png`;
        const file=new File([blob],name,{type:'image/png'});
        if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'Roll Call voucher used',text:redemptionText(item)});return;}
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);setNotice('Card proof copied. Paste it into your report.');
      }catch(error){if(error.name!=='AbortError')setError(error.message);}finally{setBusy(false);}
    }
    return <section className="rc-staff rc-daily-report" aria-label="Roll Call daily report">
      <div className="rc-title"><h3>ROLL CALL · FREE DEVSCAN</h3><button onClick={refresh} disabled={busy}>Refresh vouchers</button></div>
      <p className="rc-muted">{report?.date||reportDay()} · Bali · {report?report.items.length+' used':'Loading…'}</p>
      <div className="rc-actions rc-daily-actions">
        <button disabled={busy||!report} onClick={()=>daily('preview')}>Preview daily report</button>
        <button className="rc-primary" disabled={busy||!report} onClick={()=>daily('copy')}>Copy daily report image</button>
        {navigator.share&&<button disabled={busy||!report} onClick={()=>daily('share')}>Share daily report</button>}
        {pages>1&&<label>Report page<select aria-label="Report page" value={currentPage} onChange={event=>{setPage(Number(event.target.value));setPreview('');}}>{Array.from({length:pages},(_,index)=><option key={index} value={index}>{index+1} / {pages}</option>)}</select></label>}
      </div>
      {preview&&<div className="rc-daily-preview"><div><strong>Daily report · page {currentPage+1}</strong><button onClick={()=>setPreview('')}>Close preview</button></div><img src={preview} alt={`Roll Call daily redemption report, page ${currentPage+1}`}/></div>}
      {error&&<p role="alert" className="rc-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {report?.items.length===0&&<p>No Roll Call vouchers used today.</p>}
      {report?.items.map(item=><div key={item.rewardId} className="rc-report-row">
        <strong>{item.name}</strong><span>{item.email}</span><span>{item.memberNumber} · Card {String(item.cardNumber).padStart(3,'0')} · Stamp {item.atStamp} · USED</span><small>{usedTime(item.usedAt)} (Bali)</small>
        <div className="rc-actions"><button disabled={busy} onClick={async()=>{try{await navigator.clipboard.writeText(redemptionText(item));setNotice('Voucher details copied.');}catch{setError('Could not copy. Please try again.');}}}>Copy details</button><button disabled={busy} onClick={()=>proof(item)}>Copy card proof</button>{navigator.share&&<button disabled={busy} onClick={()=>proof(item,true)}>Share proof</button>}</div>
      </div>)}
    </section>;
  }
  function OrderPanel({order,customerId,api,onCard}) {
    const state=useRecord(customerId,null,api),snapshot=state.record?.snapshot;
    const callback=useRef(onCard);callback.current=onCard;
    useEffect(()=>{if(snapshot)callback.current(snapshot.member.cardToken);},[snapshot?.member.id,snapshot?.member.cardToken]);
    return null;
  }
  window.SaujanaRollCall={CustomerPanel,OrderPanel,ReportPanel,cardLink,reportDay,redemptionText,dailyReportText,loadDailyReport,createProof,createDailyProof};
}());
