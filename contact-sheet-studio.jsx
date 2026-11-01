function ContactSheetStudio({rolls,selectedRoll,workspaces,frames,readyRolls,excludedRolls,chooseRoll,includeRoll,
  filmName,customerName,orderNumber,scanStyle,setScanStyle,format,setFormat,numbered,setNumbered,
  confirmed,setConfirmed,active,setActive,working,isPreparing,prepareCount,progress,error,
  dragging,setDragging,prepareFolderDrop,prepare,preparePair,deliveryRef,storyRef,inputRef,folderInputRef}) {
  const [view,setView]=React.useState('preview');
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
    let live=true;const urls=[];
    (async()=>{
      const next={};
      for(let index=0;index<rolls.length;index++) {
        const workspace=allWorkspaces[index];
        if(!workspace?.frames?.length) continue;
        const canvas=document.createElement('canvas');
        await csgRender(canvas,workspace.frames,'delivery',workspace.format,workspace.numbered,rolls[index],customerName,workspace.scanStyle);
        const blob=await csgCanvasBlob(canvas,.7);const url=URL.createObjectURL(blob);urls.push(url);next[index]=url;
        if(!live) {URL.revokeObjectURL(url);return;}
      }
      if(live)setThumbnails(next);
    })().catch(()=>{});
    return()=>{live=false;urls.forEach(url=>URL.revokeObjectURL(url));};
  },[thumbnailKey,frames,workspaces]);
  function status(index) {
    if(excludedRolls.includes(index))return 'Skipped';
    if(readyRolls[index])return 'Ready';
    if(allWorkspaces[index]?.frames?.length)return 'Loaded';
    return 'Add scans';
  }
  function select(index) {chooseRoll(index);setView('preview');}
  const dropHandlers={onDragOver:e=>{e.preventDefault();if(included&&!working)setDragging(true)},onDragLeave:()=>setDragging(false),onDrop:e=>{e.preventDefault();setDragging(false);if(included&&!working)prepareFolderDrop(e.dataTransfer)}};
  return <section className="cs-studio" aria-label="Contact sheet workspace">
    <header className="cs-heading"><div><div className="cs-subtitle">Rollo's Studio</div><h2>Contact Sheets Station<span className="cs-count">{String(rolls.length).padStart(2,'0')}</span></h2><p>{customerName||'New customer'}{orderNumber?` / ${orderNumber}`:''}</p></div><div className={`cs-duty ${working?'busy':''}`}><span/>{working?'Rollo is on it':'Rollo is on duty'}</div></header>
    <nav className="cs-queue" aria-label="Film rolls">{rolls.map((name,index)=><button type="button" key={index} disabled={working} className={`cs-roll ${selectedRoll===index?'selected':''} ${status(index).toLowerCase().replace(' ','-')}`} onClick={()=>select(index)} aria-current={selectedRoll===index?'true':undefined}>
      <span className="cs-roll-number">{String(index+1).padStart(2,'0')}</span><span className="cs-roll-name"><strong>{name}</strong><small>{allWorkspaces[index]?.frames?.length||0} frames</small></span><span className="cs-roll-status">{status(index)==='Ready'?'✓ ':''}{status(index)}</span>
    </button>)}</nav>
    <div className="cs-toolbar"><div className="cs-segments" role="tablist" aria-label="Workspace view"><button role="tab" aria-selected={view==='preview'} className={view==='preview'?'active':''} onClick={()=>setView('preview')}>Preview</button><button role="tab" aria-selected={view==='all'} className={view==='all'?'active':''} onClick={()=>setView('all')}>All rolls</button></div><span className="cs-ready-count">{readyCount} / {includedCount} finalized</span></div>
    <div className={view==='all'?'cs-overview':'cs-overview is-hidden'}>{rolls.map((name,index)=><button type="button" key={index} className="cs-overview-roll" disabled={working} onClick={()=>select(index)}><div className="cs-overview-image">{thumbnails[index]?<img src={thumbnails[index]} alt={`${name} contact sheet`}/>:<span>{excludedRolls.includes(index)?'Skipped':'No scans yet'}</span>}</div><div><span>{String(index+1).padStart(2,'0')} / {name}</span><small>{status(index)}</small></div></button>)}</div>
    <div className={view==='preview'?'cs-editor':'cs-editor is-hidden'}>
      <div className="cs-preview-toolbar"><div><span className="cs-roll-kicker">ROLL {String(selectedRoll+1).padStart(2,'0')}</span><strong>{filmName||'Add a film roll'}</strong><span className="cs-frame-total">{frames.length} frames</span></div><div className="cs-segments" aria-label="Contact sheet orientation"><button aria-pressed={active==='delivery'} className={active==='delivery'?'active':''} onClick={()=>setActive('delivery')}>Landscape</button><button aria-pressed={active==='story'} className={active==='story'?'active':''} onClick={()=>setActive('story')}>Portrait</button></div></div>
      <div className={`cs-stage ${active==='story'?'portrait':''} ${dragging?'dragging':''}`} aria-busy={working} {...dropHandlers}>
        <canvas ref={deliveryRef} className={frames.length&&active==='delivery'?'':'is-hidden'} aria-label="Landscape contact sheet preview"/>
        <canvas ref={storyRef} className={frames.length&&active==='story'?'':'is-hidden'} aria-label="Portrait contact sheet preview"/>
        {!frames.length&&!isPreparing&&<div className="cs-empty"><div className="cs-empty-film">{included?'＋':'−'}</div><h3>{included?'A roll, ready for its close-up.':'This roll is skipped.'}</h3>{included&&<><p>Drop scans or roll folders here</p><div className="cs-upload-actions"><button disabled={working||!rolls.length} onClick={()=>inputRef.current.click()}>Choose scans</button><button disabled={working||!rolls.length} onClick={()=>folderInputRef.current.click()}>Choose folder</button></div><small>JPEG / TIFF</small></>}</div>}
        {isPreparing&&<div className="cs-processing" role="status"><div className="cs-rollo-sprite"/><strong>{prepareCount.current} / {prepareCount.total}</strong><span>Rollo is preparing your scans</span><progress value={prepareCount.current} max={prepareCount.total||1}/></div>}
        {frames.length>0&&!included&&<div className="cs-skipped">Skipped for this delivery</div>}
        {frames.length>0&&working&&!isPreparing&&<span className="cs-rendering" role="status">Updating preview…</span>}
      </div>
      <aside className="cs-tools" aria-label="Current roll controls">
      <div className="cs-upload-strip" {...dropHandlers}><span>{frames.length?`${frames.length} frames loaded`:'No scans loaded'}</span><div><button disabled={working||!included||!rolls.length} onClick={()=>inputRef.current.click()}>{frames.length?'Replace scans':'Choose scans'}</button><button disabled={working||!included||!rolls.length} onClick={()=>folderInputRef.current.click()}>Choose folder</button></div><label><input type="checkbox" checked={included} disabled={working||!rolls.length} onChange={e=>includeRoll?.(selectedRoll,e.target.checked)}/> Include this roll</label></div>
      <div className="cs-settings"><label className="cs-sauce"><img src="scansauce-white.png" alt="scanSAUce"/><select aria-label="scanSAUce style" value={scanStyle} disabled={working} onChange={e=>{setScanStyle(e.target.value);setConfirmed(false)}}><option>Classic</option><option>Isle Punch</option><option>Flat</option></select></label><div><span className="cs-setting-label">FRAME FORMAT</span><div className="cs-segments"><button disabled={working} aria-pressed={format==='full'} className={format==='full'?'active':''} onClick={()=>setFormat('full')}>Full frame</button><button disabled={working} aria-pressed={format==='half'} className={format==='half'?'active':''} onClick={()=>setFormat('half')}>Half frame</button></div></div><label className="cs-numbering"><input type="checkbox" checked={numbered} disabled={working} onChange={e=>setNumbered(e.target.checked)}/> Frame numbers</label></div>
      <footer className="cs-footer"><div className="cs-finalize-film"><span>ROLL {String(selectedRoll+1).padStart(2,'0')}</span><strong>{filmName||'Add a film roll'}</strong></div><button type="button" className={`cs-confirm ${confirmed?'checked':''}`} aria-pressed={confirmed} disabled={working||!frames.length||!included||Boolean(readyRolls[selectedRoll])} onClick={()=>setConfirmed(!confirmed)}><span className="cs-check-box" aria-hidden="true">{confirmed?'✓':''}</span> Scans checked</button><button type="button" className="cs-create" disabled={!included||!frames.length||!confirmed||working||Boolean(readyRolls[selectedRoll])} onClick={preparePair}>{readyRolls[selectedRoll]?'✓ Finalized':'Finalize contact sheets'}</button></footer>
      </aside>
    </div>
    <div className={`cs-feedback ${allDone?'complete':''}`} role="status" aria-live="polite">{error?<span role="alert">{error}</span>:allDone?<><span aria-hidden="true">✓</span> All done. You can publish and generate the link.</>:progress||' '}</div>
    <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,image/jpeg,image/tiff" hidden onChange={e=>{prepare(e.target.files);e.target.value=''}}/>
    <input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={e=>{prepare(e.target.files,e.target.files[0]?.webkitRelativePath?.split('/')[0]||'');e.target.value=''}}/>
  </section>;
}
