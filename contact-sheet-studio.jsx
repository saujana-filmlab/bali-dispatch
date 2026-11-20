function ContactSheetStudio({rolls,selectedRoll,workspaces,frames,readyRolls,excludedRolls,chooseRoll,includeRoll,
  filmName,customerName,orderNumber,scanStyle,setScanStyle,format,setFormat,numbered,setNumbered,
  confirmed,setConfirmed,active,setActive,working,isPreparing,prepareCount,progress,error,
  dragging,setDragging,prepareFolderDrop,prepare,preparePair,deliveryRef,storyRef,inputRef,folderInputRef,driveControl,onWorkspaceState,onFilmNameChange,onCustomerNameChange,intakeModeControl,driveTransferPanel,driveFolderPanel,rollIntake,localTrialIntake,intakeCounts,prepareReplacement,skipSheetPreparation,allowIntake,correctionRollIndex,recoverySample}) {
  const [view,setView]=React.useState('preview');
  const [showIntake,setShowIntake]=React.useState(false);
  const [intakeHover,setIntakeHover]=React.useState(false);
  const hoverTimer=React.useRef(null);
  const rollLabel=index=>String((correctionRollIndex??index)+1).padStart(2,"0");
  const intakeDropId=correctionRollIndex===null?"sl-intake-drop":"sl-correction-intake-drop";
  const compactIntake=Boolean(driveFolderPanel)||correctionRollIndex!==null;
  const [loadingSample,setLoadingSample]=React.useState(false);
  const [sampleError,setSampleError]=React.useState("");
  async function loadSampleScans(){
    setLoadingSample(true);setSampleError("");
    try{
      const response=await fetch("/refresh/synthetic-sample.jpg");
      if(!response.ok)throw Error("The sample scans could not be loaded.");
      const source=await response.blob();
      await rollIntake.pick([1,2,3].map(index=>new File([source],"sample-0"+index+".jpg",{type:"image/jpeg"})));
    }catch(error){setSampleError(error.message);}
    finally{setLoadingSample(false);}
  }
  const canDrop=Boolean(allowIntake&&!working&&!rollIntake.reading&&rolls.length);
  const scanCount=index=>allWorkspaces[index]?.frames?.length||intakeCounts[index]||0;
  const hasDraggedFiles=event=>Array.from(event.dataTransfer?.types||[]).includes("Files");
  function clearIntakeHover(){
    clearTimeout(hoverTimer.current);hoverTimer.current=null;setIntakeHover(false);
  }
  function markIntakeHover(){
    if(!canDrop){clearIntakeHover();return;}
    setIntakeHover(true);
    clearTimeout(hoverTimer.current);
    hoverTimer.current=setTimeout(clearIntakeHover,1100);
  }
  React.useEffect(()=>{
    const endEvents=["drop","dragend","pointerup","blur"];
    const outside=event=>{if(!event.target.closest?.(".sl-scan-summary"))clearIntakeHover();};
    const hide=()=>{if(document.hidden)clearIntakeHover();};
    endEvents.forEach(name=>window.addEventListener(name,clearIntakeHover,true));
    document.addEventListener("dragover",outside,true);
    document.addEventListener("visibilitychange",hide);
    return ()=>{
      clearTimeout(hoverTimer.current);
      endEvents.forEach(name=>window.removeEventListener(name,clearIntakeHover,true));
      document.removeEventListener("dragover",outside,true);
      document.removeEventListener("visibilitychange",hide);
    };
  },[]);
  React.useEffect(()=>{if(!canDrop)clearIntakeHover();},[canDrop]);
  const intakeDropHandlers={
    onPaste(event){
      const files=Array.from(event.clipboardData?.files||[]);
      if(!files.length||!canDrop)return;
      event.preventDefault();
      prepare(files.map((file,index)=>file.type==="image/png"?
        new File([file],"clipboard-"+crypto.randomUUID().slice(0,8)+"-"+(index+1)+".png",{type:file.type}):file));
    },
    onDragEnter(event){
      if(!hasDraggedFiles(event))return;
      event.preventDefault();
      markIntakeHover();
    },
    onDragOver(event){
      if(!hasDraggedFiles(event))return;
      event.preventDefault();
      event.dataTransfer.dropEffect=canDrop?"copy":"none";
      markIntakeHover();
    },
    onDragLeave(event){
      const next=event.relatedTarget;
      if(!(next instanceof Node)||!event.currentTarget.contains(next))clearIntakeHover();
    },
    onDrop(event){
      clearIntakeHover();
      if(!hasDraggedFiles(event))return;
      event.preventDefault();
      if(canDrop)prepareFolderDrop(event.dataTransfer);
    }
  };
  const [thumbnails,setThumbnails]=React.useState({});
  const included=!excludedRolls.includes(selectedRoll);
  const readyCount=Object.keys(readyRolls).filter(index=>!excludedRolls.includes(Number(index))).length;
  const includedCount=rolls.filter((_,index)=>!excludedRolls.includes(index)).length;
  const allDone=includedCount>0&&readyCount===includedCount;
  const allWorkspaces={...workspaces,[selectedRoll]:{frames,scanStyle,format,numbered}};
  const thumbnailKey=rolls.map((name,index)=>{
    const workspace=allWorkspaces[index];
    return [name,workspace?.frames?.map(frame=>frame.name).join(','),workspace?.scanStyle,workspace?.format,workspace?.numbered].join('|');
  }).join('::')+customerName;
  React.useEffect(()=>{
    if(view!=='all')return;
    let live=true;const urls=[];const controller=new AbortController();
    (async()=>{
      const next={};
      for(let index=0;index<rolls.length;index++) {
        const workspace=allWorkspaces[index];
        if(!workspace?.frames?.length) continue;
        const canvas=document.createElement('canvas');
        let blob;
        try{
          await csgRender(canvas,workspace.frames,'delivery',workspace.format,workspace.numbered,rolls[index],customerName,workspace.scanStyle,{scale:.33,signal:controller.signal});
          if(!live)return;
          blob=await csgCanvasBlob(canvas,.7);
        }finally{canvas.width=canvas.height=0;}
        const url=URL.createObjectURL(blob);urls.push(url);next[index]=url;
        if(!live) {URL.revokeObjectURL(url);return;}
      }
      if(live)setThumbnails(next);
    })().catch(()=>{});
    return()=>{live=false;controller.abort();urls.forEach(url=>URL.revokeObjectURL(url));};
  },[view,thumbnailKey,frames,workspaces]);
  const hasScans=rolls.some((_,index)=>scanCount(index)>0);
  const summaryKey=JSON.stringify(rolls.map((name,index)=>({name,frames:scanCount(index),ready:Boolean(readyRolls[index]),blank:rollIntake.blankRolls.includes(index)})));
  React.useEffect(()=>{onWorkspaceState?.(JSON.parse(summaryKey));},[summaryKey,onWorkspaceState]);
  function status(index) {
    if(excludedRolls.includes(index))return 'Skipped';
    if(readyRolls[index])return 'Ready';
    if(allWorkspaces[index]?.frames?.length)return 'Loaded';
    return 'Add scans';
  }
  function select(index) {chooseRoll(index);setView('preview');}
  return <>
    <section id={correctionRollIndex===null?"refresh-intake":"fix-delivery-intake"} aria-label="Scan upload" tabIndex={0} className={"sl-step-summary sl-scan-summary "+(hasScans?"complete":"")} data-drop-active={intakeHover&&canDrop} {...intakeDropHandlers}>
      <span className="sl-step-icon">{hasScans?<RefreshIcon name="Check" size={14}/>:correctionRollIndex===null?"2":<RefreshIcon name="FolderUp" size={14}/>}</span><h2>Scan upload</h2>
      <div className="sl-scan-chips">{rolls.map((name,index)=>scanCount(index)?<span key={index}>{rollLabel(index)} {name} / {scanCount(index)}</span>:null)}</div>
      <div className="sl-intake-actions">
        {intakeModeControl}
        {recoverySample&&!rollIntake.hasQueue&&<button type="button" className="sl-secondary" disabled={!canDrop||loadingSample} onClick={loadSampleScans}>{loadingSample?"Loading sample scans...":"Upload 3 sample scans"}</button>}
        {(hasScans||rollIntake.hasQueue)&&allowIntake&&!driveFolderPanel&&<button className="sl-secondary" aria-expanded={showIntake||intakeHover} aria-controls={intakeDropId} onClick={()=>setShowIntake(value=>!value)}>{showIntake?"Close":"Add scans"}</button>}
      </div>
      {sampleError&&<p className="sl-intake-mode-note" role="alert">{sampleError}</p>}
      {driveTransferPanel}
      {rollIntake.hasQueue&&driveFolderPanel&&<button type="button" className="sl-text-button rb-source" onClick={()=>rollIntake.setDrive(!rollIntake.showDrive)}>{rollIntake.showDrive?"View dropped rolls":"View Drive folder"}</button>}
      {rollIntake.hasQueue&&!rollIntake.showDrive||rollIntake.reading||rollIntake.error?rollIntake.panel:driveFolderPanel}
      {!allowIntake&&localTrialIntake&&skipSheetPreparation&&<p className="sl-intake-mode-note">Turn off Contact sheets only to upload to Drive.</p>}
      {(error||(localTrialIntake&&(isPreparing||progress==="Reading roll folders...")))&&
        <p className="sl-intake-mode-note" role={error?"alert":"status"}>{error||(isPreparing?"Preparing contact sheets: "+prepareCount.current+" / "+prepareCount.total:progress)}</p>}
      {allowIntake&&(showIntake||intakeHover||(!hasScans&&!rollIntake.hasQueue)||Boolean(driveFolderPanel))&&<div className="sl-intake-drop" id={intakeDropId} data-compact={compactIntake}>
        <span className="sl-intake-icon"><RefreshIcon name="FolderUp" size={compactIntake?22:36}/></span>
        <strong>{intakeHover&&canDrop?(rollIntake.uploadsEnabled?"Release to upload to Drive":"Release to prepare contact sheets"):(rollIntake.uploadsEnabled||!driveFolderPanel?"Drop scans or roll folders here":"Drop scans for contact sheets")}</strong>
        <span>{intakeHover&&canDrop?"Rollo's Workshop Upload Station":"JPEG / TIFF"}</span><div><button className="sl-secondary" disabled={!canDrop} onClick={()=>inputRef.current.click()}>Choose scans</button><button className="sl-secondary" disabled={!canDrop} onClick={()=>folderInputRef.current.click()}>Choose folder</button></div>
      </div>}
    </section>
    <section id={correctionRollIndex===null?"refresh-sheets":"fix-delivery-sheets"} className="cs-studio sl-contact" aria-label="Contact sheet workspace">
      <header className="sl-contact-heading"><h2><span className="sl-step-icon">{correctionRollIndex===null?"3":<RefreshIcon name="Images" size={14}/>}</span>Contact sheets</h2><span className="sl-finalized-progress"><i><span style={{width:(includedCount?readyCount/includedCount*100:0)+"%"}}/></i>{readyCount} / {includedCount} finalized</span></header>
      <nav className="cs-queue" aria-label="Film rolls">{rolls.map((name,index)=><button type="button" key={index} disabled={working} className={`cs-roll ${selectedRoll===index?'selected':''} ${status(index).toLowerCase().replace(' ','-')}`} onClick={()=>select(index)} aria-current={selectedRoll===index?'true':undefined}>
        {status(index)==="Ready"?<RefreshIcon name="Check" size={14}/>:selectedRoll===index?<span className="sl-active-dot"/>:null}<span>{rollLabel(index)} {name}</span><span className="sl-sr-only">{status(index)}</span>
      </button>)}</nav>
      <div className="cs-toolbar">
        <div className="cs-segments" role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={view==='preview'} className={view==='preview'?'active':''} onClick={()=>setView('preview')}>Preview</button><button role="tab" aria-selected={view==='all'} className={view==='all'?'active':''} onClick={()=>setView('all')}>All rolls</button></div>
        <div className="cs-segments" aria-label="Contact sheet orientation"><button aria-pressed={active==='delivery'} className={active==='delivery'?'active':''} onClick={()=>setActive('delivery')}>Landscape</button><button aria-pressed={active==='story'} className={active==='story'?'active':''} onClick={()=>setActive('story')}>Portrait</button></div>
        {driveControl}
      </div>
      <div className={view==='all'?'cs-overview':'cs-overview is-hidden'}>{rolls.map((name,index)=><button type="button" key={index} className="cs-overview-roll" disabled={working} onClick={()=>select(index)}><div className="cs-overview-image">{thumbnails[index]?<img src={thumbnails[index]} alt={`${name} contact sheet`}/>:<span>{excludedRolls.includes(index)?'Skipped':'No scans yet'}</span>}</div><div><span>{String(index+1).padStart(2,'0')} / {name}</span><small>{status(index)}</small></div></button>)}</div>
      <div className={view==='preview'?'cs-editor':'cs-editor is-hidden'}>
        <aside className="cs-tools" aria-label="Current roll controls">
          <div className="cs-upload-strip">{includeRoll&&<label><input type="checkbox" checked={included} disabled={working||!rolls.length} onChange={e=>includeRoll(selectedRoll,e.target.checked)}/>Include this roll</label>}
            {!skipSheetPreparation&&included&&scanCount(selectedRoll)>0&&<label className="sl-secondary sl-replace-scans">
              <input className="sl-sr-only" type="file" aria-label="Replace scans for this contact sheet" multiple accept=".jpg,.jpeg,.tif,.tiff,.png" disabled={working} onChange={event=>{prepareReplacement(event.target.files);event.target.value="";}}/>
              Replace scans
            </label>}
          </div>
          {!skipSheetPreparation&&included&&scanCount(selectedRoll)>0&&<small className="sl-replace-note">Contact sheet only. Drive files stay unchanged.</small>}
          <div className="sl-sheet-fields">
            <label>Film name<input aria-label="Contact sheet film name" value={filmName} disabled={working} onChange={e=>onFilmNameChange?.(selectedRoll,e.target.value)} readOnly={!onFilmNameChange}/></label>
            <label>Customer name<input aria-label="Contact sheet customer name" value={customerName} disabled={working} onChange={e=>onCustomerNameChange?.(e.target.value)} readOnly={!onCustomerNameChange}/></label>
          </div>
          <div className="cs-settings">
            <label className="sl-sauce"><span>Sheet style</span><div><img src="scansauce-white.png" alt="scanSAUce"/><select aria-label="scanSAUce style" value={scanStyle} disabled={working} onChange={e=>{setScanStyle(e.target.value);setConfirmed(false)}}><option>Classic</option><option>Isle Punch</option><option>Flat</option></select></div></label>
            <div><span className="cs-setting-label">Frame format</span><div className="cs-segments"><button disabled={working} aria-pressed={format==='full'} className={format==='full'?'active':''} onClick={()=>setFormat('full')}>Full frame</button><button disabled={working} aria-pressed={format==='half'} className={format==='half'?'active':''} onClick={()=>setFormat('half')}>Half frame</button></div></div>
            <label className="cs-numbering"><span>Frame numbers</span><input type="checkbox" role="switch" checked={numbered} disabled={working} onChange={e=>setNumbered(e.target.checked)}/></label>
          </div>
          <footer className="cs-footer">
            <button type="button" className={`cs-confirm ${confirmed?'checked':''}`} aria-pressed={confirmed} disabled={working||!frames.length||!included||Boolean(readyRolls[selectedRoll])} onClick={()=>setConfirmed(!confirmed)}><span className="cs-check-box" aria-hidden="true">{confirmed?<RefreshIcon name="Check" size={12}/>:null}</span>Scans checked</button>
            <button type="button" className="cs-create" disabled={!included||!frames.length||!confirmed||working||Boolean(readyRolls[selectedRoll])} onClick={preparePair}>{readyRolls[selectedRoll]?'Finalized':'Finalize contact sheet'}</button>
          </footer>
        </aside>
        <div className={`cs-stage ${active==='story'?'portrait':''}`} aria-busy={working}>
          <canvas ref={deliveryRef} className={frames.length&&!isPreparing&&active==='delivery'?'':'is-hidden'} aria-label="Landscape contact sheet preview"/>
          <canvas ref={storyRef} className={frames.length&&!isPreparing&&active==='story'?'':'is-hidden'} aria-label="Portrait contact sheet preview"/>
          {!frames.length&&!isPreparing&&<div className="sl-sheet-state"><RefreshIcon name={included?"Images":"CircleMinus"} size={29}/><strong>{included?"No scans loaded":"Roll skipped"}</strong></div>}
          {isPreparing&&<div className="sl-sheet-state sl-sheet-preparing">
            <span className="sl-prep-icon" aria-hidden="true"><RefreshIcon name="Film" size={30}/></span>
            <strong role="status">Preparing contact sheets</strong>
            <span className="sl-prep-count">{prepareCount.current} / {prepareCount.total} scans</span>
            <progress aria-label="Contact sheet preparation progress" value={prepareCount.current} max={prepareCount.total||1}/>
          </div>}
          {frames.length>0&&!included&&!isPreparing&&<div className="cs-skipped">Skipped for this delivery</div>}
          {frames.length>0&&working&&!isPreparing&&<span className="cs-rendering" role="status">Updating preview...</span>}
        </div>
      </div>
      <div className={`cs-feedback ${allDone?'complete':''}`} role="status" aria-live="polite">{error?<span role="alert">{error}</span>:allDone?'All done. You can publish and generate the link.':progress||' '}</div>
      <span className="sl-sr-only cs-frame-total">{frames.length} frames</span>
      <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,image/jpeg,image/tiff" hidden onChange={e=>{prepare(e.target.files);e.target.value=''}}/>
      <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={e=>{prepare(e.target.files,e.target.files[0]?.webkitRelativePath?.split('/')[0]||'');e.target.value=''}}/>
    </section>
  </>;

}
