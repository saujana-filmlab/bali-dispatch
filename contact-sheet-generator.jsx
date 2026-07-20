const CSG_COLLATOR = new Intl.Collator(undefined, { numeric:true, sensitivity:"base" });
const CSG_ALLOWED = /\.(jpe?g|tiff?)$/i;
const CSG_LOGOS = {};

function csgFileName(file) {
  return file.webkitRelativePath || file.name || "";
}

function csgSupportedFile(file) {
  return CSG_ALLOWED.test(csgFileName(file)) || /image\/(jpeg|tiff)/i.test(file.type);
}

function csgSortFiles(files) {
  return Array.from(files).filter(csgSupportedFile).sort((a,b)=>CSG_COLLATOR.compare(csgFileName(a),csgFileName(b)));
}

function csgReadDirectory(reader) {
  return new Promise((resolve,reject) => {
    const entries = [];
    const readBatch = () => reader.readEntries(batch => {
      if (!batch.length) { resolve(entries); return; }
      entries.push(...batch);
      readBatch();
    },reject);
    readBatch();
  });
}

function csgEntryFile(entry) {
  return new Promise((resolve,reject) => entry.file(resolve,reject));
}

async function csgFilesFromEntry(entry) {
  if (entry.isFile) return [await csgEntryFile(entry)];
  if (!entry.isDirectory) return [];
  const children = await csgReadDirectory(entry.createReader());
  const files = [];
  for (const child of children.sort((a,b)=>CSG_COLLATOR.compare(a.name,b.name))) {
    files.push(...await csgFilesFromEntry(child));
  }
  return files;
}

async function csgDroppedFolders(dataTransfer) {
  const entries = Array.from(dataTransfer.items || [])
    .map(item => typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  const folders = entries.filter(entry=>entry.isDirectory).sort((a,b)=>CSG_COLLATOR.compare(a.name,b.name));
  if (!folders.length) return [];
  const groups = [];
  for (const folder of folders) {
    groups.push({name:folder.name,files:csgSortFiles(await csgFilesFromEntry(folder))});
  }
  return groups;
}

function csgLoadImage(src) {
  const url = new URL(src, document.baseURI).href;
  if (CSG_LOGOS[url]) return CSG_LOGOS[url];
  CSG_LOGOS[url] = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      delete CSG_LOGOS[url];
      reject(new Error(`Required contact-sheet logo could not load: ${src}`));
    };
    image.src = url;
  });
  return CSG_LOGOS[url];
}

let CSG_BRAND_READY = null;

function csgLoadBrandAssets() {
  if (!CSG_BRAND_READY) {
    CSG_BRAND_READY = Promise.all([
      csgLoadImage("saujana-white.png"),
      csgLoadImage("scansauce-white.png")
    ]).catch(error => {
      CSG_BRAND_READY = null;
      throw error;
    });
  }
  return CSG_BRAND_READY;
}

// Load mandatory branding while staff completes the order form, before scans are prepared.
csgLoadBrandAssets().catch(()=>{});

function csgGrid(count, output, format) {
  if (format === "full") {
    if (count === 24) return output === "delivery" ? [6,4] : [3,8];
    if (count === 36) return output === "delivery" ? [6,6] : [4,9];
    if (count === 37) return output === "delivery" ? [6,7] : [4,10];
  }
  if (format === "half" && count === 72) return output === "delivery" ? [12,6] : [8,9];

  const target = output === "delivery" ? (format === "full" ? 6 : 12) : (format === "full" ? 4 : 8);
  let best = [Math.min(target, count), Math.ceil(count / Math.min(target, count))];
  let bestScore = Infinity;
  const limit = Math.min(format === "half" ? 14 : 10, count);
  for (let columns = 1; columns <= limit; columns += 1) {
    const rows = Math.ceil(count / columns);
    const empty = columns * rows - count;
    const score = Math.abs(columns - target) * .22 + empty / Math.max(1, count);
    if (score < bestScore) { best = [columns, rows]; bestScore = score; }
  }
  return best;
}

function csgContained(ctx, image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function csgRebate(ctx, x, y, width, height, frame, showNumber, compact) {
  ctx.fillStyle = "#d58d22";
  const tickWidth = compact ? 1.2 : 1.7;
  const tickGap = compact ? 4 : 6;
  const tickArea = Math.min(width * .34, compact ? 30 : 62);
  for (let offset = 0; offset < tickArea; offset += tickGap) {
    const tall = Math.round(offset / tickGap) % 3 === 0;
    ctx.fillRect(x + offset, y + (tall ? 3 : 6), tickWidth, Math.max(2, height - (tall ? 7 : 11)));
  }
  if (showNumber) {
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.font = compact ? "700 7px Arial" : "700 10px Arial";
    ctx.fillText(String(frame).padStart(2,"0"), x + width - 2, y + height / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }
}

async function csgRender(canvas, frames, output, format, numbered, filmName, customerName, scanStyle) {
  const width = output === "delivery" ? 1600 : 1080;
  const height = output === "delivery" ? 1200 : 1920;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha:false, colorSpace:"srgb" });
  ctx.fillStyle = "#070707"; ctx.fillRect(0,0,width,height);

  const margin = output === "delivery" ? 54 : 38;
  // Instagram places the poster identity over the upper-left of Stories.
  // Reserve that area and start the exported Story artwork below it.
  const header = output === "delivery" ? 132 : 260;
  const footer = output === "delivery" ? 46 : 72;
  const gapX = output === "delivery" ? 10 : 8;
  const gapY = 9;
  const rebate = output === "delivery" ? 22 : 20;
  const [columns, rows] = csgGrid(frames.length, output, format);
  const usableWidth = width - margin * 2;
  const areaHeight = height - header - footer;
  const cellWidth = (usableWidth - gapX * (columns - 1)) / columns;
  const maxHeight = (areaHeight - gapY * (rows - 1)) / rows;
  const aspect = format === "full" ? 1.5 : 2/3;
  const cellHeight = Math.min(maxHeight, cellWidth / aspect + rebate);
  const imageHeight = cellHeight - rebate;
  const gridHeight = cellHeight * rows + gapY * (rows - 1);
  const startY = header + (areaHeight - gridHeight) / 2;

  const [saujana, scansauce] = await csgLoadBrandAssets();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  csgContained(ctx, saujana, margin, output === "delivery" ? 6 : 128, output === "delivery" ? 280 : 248, output === "delivery" ? 78 : 72);
  const scanWidth = output === "delivery" ? 180 : 158;
  csgContained(ctx, scansauce, width - margin - scanWidth, output === "delivery" ? 21 : 143, scanWidth, output === "delivery" ? 40 : 42);
  ctx.fillStyle = "#f1eee7"; ctx.textAlign = "right";
  ctx.font = output === "delivery" ? "600 12px Arial" : "600 11px Arial";
  ctx.letterSpacing = output === "delivery" ? "2.6px" : "2.2px";
  ctx.fillText(scanStyle.toUpperCase(), width - margin, output === "delivery" ? 86 : 205);

  ctx.fillStyle = "#d58d22"; ctx.fillRect(margin, header - 17, usableWidth, 1.5);
  ctx.fillStyle = "#b7b0a5"; ctx.font = output === "delivery" ? "600 14px Arial" : "600 13px Arial";
  ctx.letterSpacing = output === "delivery" ? "1.8px" : "1.5px";
  ctx.textAlign = "left";
  const title = [filmName.trim() || "Saujana roll", customerName.trim()].filter(Boolean).join(" · ");
  ctx.fillText(title, margin, header - 27);
  ctx.textAlign = "right";
  ctx.fillText(`${frames.length} FRAMES · ${format === "half" ? "HALF FRAME" : "FULL FRAME"}`, width - margin, header - 27);
  ctx.letterSpacing = "0px";

  for (let row = 0; row < rows; row += 1) {
    const rowStart = row * columns;
    const rowCount = Math.min(columns, frames.length - rowStart);
    if (rowCount <= 0) break;
    const rowWidth = rowCount * cellWidth + Math.max(0,rowCount-1) * gapX;
    const rowX = margin + (usableWidth - rowWidth) / 2;
    for (let column = 0; column < rowCount; column += 1) {
      const index = rowStart + column;
      const x = rowX + column * (cellWidth + gapX);
      const y = startY + row * (cellHeight + gapY);
      ctx.fillStyle = "#151515"; ctx.fillRect(x,y,cellWidth,imageHeight);
      const bitmap = await createImageBitmap(frames[index].blob);
      csgContained(ctx, bitmap, x, y, cellWidth, imageHeight);
      bitmap.close();
      csgRebate(ctx,x,y+imageHeight,cellWidth,rebate,index+1,numbered,cellWidth<100);
    }
  }

  ctx.fillStyle = "#d58d22"; ctx.font = output === "delivery" ? "600 13px Arial" : "600 14px Arial";
  ctx.letterSpacing = "2.4px"; ctx.textAlign = "left";
  ctx.fillText("SAUJANA FILM LAB · BALI",margin,height-22);
  ctx.textAlign = "right"; ctx.fillText("CONTACT SHEET",width-margin,height-22);
  ctx.letterSpacing = "0px";
}

function csgCanvasBlob(canvas, quality=.86) {
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("JPEG export failed")),"image/jpeg",quality));
}

function ContactSheetGenerator({ embedded=false, orderNumber="", customerName:linkedCustomerName="", rolls:linkedRolls=[], excludedRolls=[], onRollInclusionChange=null, onSheetsChange=null }) {
  const availableRolls = React.useMemo(() => linkedRolls.map(value=>String(value||"").trim()).filter(Boolean), [linkedRolls]);
  const [selectedRoll,setSelectedRoll] = React.useState(0);
  const [frames,setFrames] = React.useState([]);
  const [filmName,setFilmName] = React.useState(availableRolls[0] || "Kodak Ultramax 400");
  const [customerName,setCustomerName] = React.useState(linkedCustomerName || "");
  const [scanStyle,setScanStyle] = React.useState("Classic");
  const [format,setFormat] = React.useState("full");
  const [numbered,setNumbered] = React.useState(true);
  const [confirmed,setConfirmed] = React.useState(false);
  const [active,setActive] = React.useState("delivery");
  const [working,setWorking] = React.useState(false);
  const [isPreparing,setIsPreparing] = React.useState(false);
  const [prepareCount,setPrepareCount] = React.useState({current:0,total:0});
  const [progress,setProgress] = React.useState("");
  const [error,setError] = React.useState("");
  const [dragging,setDragging] = React.useState(false);
  const [rollWorkspaces,setRollWorkspaces] = React.useState({});
  const deliveryRef = React.useRef(null);
  const storyRef = React.useRef(null);
  const inputRef = React.useRef(null);
  const folderInputRef = React.useRef(null);

  React.useEffect(() => {
    if (linkedCustomerName) setCustomerName(linkedCustomerName);
  },[linkedCustomerName]);

  React.useEffect(() => {
    if (!availableRolls.length) {
      setSelectedRoll(0);
      setFrames([]);
      setRollWorkspaces({});
      setConfirmed(false);
      setProgress("");
      setError("");
      return;
    }
    const safeIndex = Math.min(selectedRoll,availableRolls.length-1);
    if (safeIndex !== selectedRoll) setSelectedRoll(safeIndex);
    setFilmName(availableRolls[safeIndex]);
  },[availableRolls,selectedRoll]);

  React.useEffect(() => {
    if (!frames.length) return;
    let live = true;
    setWorking(true); setError("");
    (async()=>{
      try {
        await csgRender(deliveryRef.current,frames,"delivery",format,numbered,filmName,customerName,scanStyle);
        if (!live) return;
        await csgRender(storyRef.current,frames,"story",format,numbered,filmName,customerName,scanStyle);
      } catch (err) { if (live) setError(err.message || "Could not render the contact sheets."); }
      finally { if (live) setWorking(false); }
    })();
    return ()=>{live=false;};
  },[frames,filmName,customerName,scanStyle,format,numbered]);

  function chooseLinkedRoll(index) {
    if (index === selectedRoll || working) return;
    const savedTarget = rollWorkspaces[index];
    setRollWorkspaces(previous => ({
      ...previous,
      [selectedRoll]: {frames,scanStyle,format,numbered,confirmed,active,progress}
    }));
    setSelectedRoll(index);
    setFilmName(availableRolls[index] || "");
    setFrames(savedTarget?.frames || []);
    setScanStyle(savedTarget?.scanStyle || "Classic");
    setFormat(savedTarget?.format || "full");
    setNumbered(savedTarget?.numbered ?? true);
    setConfirmed(savedTarget?.confirmed || false);
    setActive(savedTarget?.active || "delivery");
    setProgress(savedTarget?.progress || (savedTarget?.frames?.length ? `${savedTarget.frames.length} frames ready` : ""));
    setError("");
  }

  async function prepareFiles(files, startAt=0, total=files.length, folderName="") {
    const prepared = [];
    for (let i=0;i<files.length;i+=1) {
      const current = startAt+i+1;
      setPrepareCount({current,total});
      setProgress(`${folderName ? `${folderName} · ` : ""}Preparing frame ${i+1} of ${files.length}`);
      let bitmap;
      try { bitmap = await createImageBitmap(files[i],{imageOrientation:"from-image"}); }
      catch { throw new Error(`${files[i].name} could not be decoded. TIFF support depends on the browser; export it as JPEG if needed.`); }
      const maxSide = 1800;
      const scale = Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
      const ctx = canvas.getContext("2d",{colorSpace:"srgb"}); ctx.imageSmoothingQuality="high"; ctx.drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
      const blob = await csgCanvasBlob(canvas,.88);
      prepared.push({name:csgFileName(files[i]),blob});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return prepared;
  }

  async function prepare(fileList, folderName="") {
    const files = csgSortFiles(fileList);
    if (!files.length) { setError("Choose JPEG or TIFF scan files."); return; }
    setWorking(true); setIsPreparing(true); setPrepareCount({current:0,total:files.length}); setError(""); setFrames([]);
    try {
      const prepared = await prepareFiles(files,0,files.length,folderName);
      setFrames(prepared); setConfirmed(false); setProgress(`${folderName ? `${folderName} · ` : ""}${prepared.length} frames ready`);
    } catch(err) { setError(err.message || "The scans could not be prepared."); setProgress(""); }
    finally { setWorking(false); setIsPreparing(false); }
  }

  async function prepareFolderDrop(dataTransfer) {
    setError("");
    let groups;
    try { groups = await csgDroppedFolders(dataTransfer); }
    catch(err) { setError(err.message || "The dropped folder could not be read."); return; }
    if (!groups.length) { prepare(dataTransfer.files); return; }
    const emptyFolder = groups.find(group=>!group.files.length);
    if (emptyFolder) { setError(`${emptyFolder.name} does not contain JPEG or TIFF scan files.`); return; }
    if (groups.length === 1) { prepare(groups[0].files,groups[0].name); return; }

    const rollIndexes = availableRolls.map((_,index)=>index).filter(index=>!excludedRolls.includes(index));
    if (groups.length > rollIndexes.length) {
      setError(`You dropped ${groups.length} roll folders, but only ${rollIndexes.length} included rolls are in the order form.`);
      return;
    }

    const total = groups.reduce((sum,group)=>sum+group.files.length,0);
    setWorking(true); setIsPreparing(true); setPrepareCount({current:0,total}); setFrames([]);
    try {
      let startAt = 0;
      const preparedWorkspaces = {};
      for (let i=0;i<groups.length;i+=1) {
        const group = groups[i];
        const prepared = await prepareFiles(group.files,startAt,total,group.name);
        startAt += group.files.length;
        preparedWorkspaces[rollIndexes[i]] = {
          frames:prepared,scanStyle:"Classic",format:"full",numbered:true,confirmed:false,active:"delivery",
          progress:`${group.name} · ${prepared.length} frames ready`
        };
      }
      const firstIndex = rollIndexes[0];
      const first = preparedWorkspaces[firstIndex];
      setRollWorkspaces(previous=>({...previous,...preparedWorkspaces}));
      setSelectedRoll(firstIndex); setFilmName(availableRolls[firstIndex] || "");
      setFrames(first.frames); setScanStyle(first.scanStyle); setFormat(first.format); setNumbered(first.numbered);
      setConfirmed(false); setActive("delivery"); setProgress(first.progress);
    } catch(err) { setError(err.message || "The roll folders could not be prepared."); setProgress(""); }
    finally { setWorking(false); setIsPreparing(false); }
  }

  async function preparePair() {
    if (!frames.length || !confirmed) return;
    setWorking(true); setProgress("Preparing both contact sheets");
    try {
      const deliveryBlob = await csgCanvasBlob(deliveryRef.current);
      const storyBlob = await csgCanvasBlob(storyRef.current);
      setProgress("Pair ready for delivery");
      if (onSheetsChange) onSheetsChange({
        ready:true,
        rollIndex:selectedRoll,
        rollKey:`${selectedRoll}:${filmName}`,
        orderNumber,
        filmName,
        customerName,
        frameCount:frames.length,
        scanStyle,
        format,
        deliveryBlob,
        storyBlob,
        deliveryPreviewUrl:URL.createObjectURL(deliveryBlob),
        storyPreviewUrl:URL.createObjectURL(storyBlob)
      });
    } catch(err) { setError(err.message || "Could not prepare the contact sheets."); }
    finally { setWorking(false); }
  }

  const rollIncluded = !excludedRolls.includes(selectedRoll);

  return <div className={`csg-shell ${embedded?"embedded":""}`}>
    <style>{`
      .csg-shell{max-width:1100px;margin:0 auto;color:var(--light)}
      .csg-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:18px}.csg-title h1{font-size:18px;letter-spacing:.06em;color:var(--white);font-weight:500}.csg-title p{font-size:10px;color:var(--muted);margin-top:6px}.csg-local{font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:var(--greenT);border:1px solid var(--greenB);padding:6px 9px}
      .csg-layout{display:grid;grid-template-columns:300px 1fr;gap:16px}.csg-panel{background:var(--card);border:1px solid var(--border);padding:18px}.csg-label{display:block;font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:16px 0 7px}.csg-label:first-child{margin-top:0}.csg-panel input,.csg-panel select{width:100%;padding:10px 11px}.csg-row{display:grid;grid-template-columns:1fr 1fr;gap:7px}.csg-choice{padding:10px;background:var(--card2);color:var(--muted);border:1px solid var(--border2);font-size:9px}.csg-choice.active{border-color:var(--blue-l);color:var(--white);background:var(--blue-gl)}.csg-check{display:flex;gap:9px;align-items:flex-start;margin-top:14px;color:var(--light);font-size:10px;line-height:1.5}.csg-check input{width:auto;margin-top:2px}.csg-help{font-size:9px;color:var(--dim);line-height:1.5;margin-top:6px}
      .csg-work{min-width:0}.csg-drop{min-height:185px;border:1px dashed var(--border2);background:var(--dark);display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;transition:.2s}.csg-drop.drag{border-color:var(--gold);background:rgba(200,149,22,.06)}.csg-drop.excluded{border-style:solid;opacity:.72}.csg-drop strong{display:block;color:var(--white);font-size:13px;margin-bottom:7px}.csg-drop span{font-size:9px;color:var(--muted)}.csg-drop-actions{display:flex;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap}.csg-drop button{margin:0;padding:8px 14px;background:var(--card2);color:var(--light);border:1px solid var(--border2);font-size:9px}.csg-rollo-loading{display:flex;align-items:center;justify-content:center;gap:17px;text-align:left}.csg-rollo-sprite{width:96px;height:104px;flex:0 0 96px;background-image:url('rollo-spritesheet.png');background-repeat:no-repeat;background-size:768px 936px;background-position:0 -728px;clip-path:inset(7px 0 6px 9px);animation:csgRolloProcess .92s steps(6) infinite}.csg-rollo-loading strong{font-size:15px;margin:0 0 5px}.csg-rollo-loading span{letter-spacing:.12em;text-transform:uppercase}.csg-include{padding:10px;border:1px solid var(--border2);background:var(--dark)}@keyframes csgRolloProcess{to{background-position-x:-576px}}
      .csg-status{padding:9px 0;font-size:9px}.csg-error{color:#e68d7b}.csg-preview{background:var(--card);border:1px solid var(--border);padding:12px}.csg-tabs{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.csg-tabs div{display:flex;gap:6px}.csg-tabs button{padding:7px 10px;background:none;border:1px solid var(--border);color:var(--muted);font-size:8px;letter-spacing:.12em;text-transform:uppercase}.csg-tabs button.active{color:var(--white);border-color:var(--blue-l)}.csg-tabs span{font-size:8px;color:var(--dim)}.csg-stage{height:520px;background:#050505;display:flex;align-items:center;justify-content:center;overflow:hidden}.csg-stage.empty{color:var(--dim);font-size:10px;letter-spacing:.18em;text-transform:uppercase}.csg-stage canvas{display:block;max-width:100%;max-height:100%;object-fit:contain}.csg-stage canvas.hidden{display:none}.csg-export{display:flex;justify-content:space-between;align-items:center;margin-top:12px;gap:12px}.csg-export small{color:var(--dim);font-size:9px;line-height:1.5}.csg-export button{padding:11px 17px;border:1px solid var(--gold);background:var(--gold);color:#111;font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.csg-export button:disabled{opacity:.35;cursor:not-allowed}
      .csg-shell.embedded{max-width:none}.csg-shell.embedded .csg-title{margin-bottom:14px}.csg-shell.embedded .csg-title h1{font-size:17px}.csg-shell.embedded .csg-layout{grid-template-columns:270px 1fr;gap:18px}.csg-shell.embedded .csg-panel{padding:18px}.csg-shell.embedded .csg-stage{height:500px}.csg-shell.embedded .csg-label{font-size:9px}.csg-shell.embedded .csg-choice{font-size:10px}.csg-shell.embedded .csg-check{font-size:11px}.csg-shell.embedded .csg-help,.csg-shell.embedded .csg-status,.csg-shell.embedded .csg-export small{font-size:10px}.csg-shell.embedded .csg-tabs button,.csg-shell.embedded .csg-tabs span{font-size:9px}
      @media(max-width:800px){.csg-layout,.csg-shell.embedded .csg-layout{grid-template-columns:1fr}.csg-stage{height:390px}.csg-title{align-items:flex-start;gap:12px}}
    `}</style>
    <div className="csg-title"><div><h1>{embedded ? "Contact sheets for this order" : "Contact Sheet Generator"}</h1><p>{embedded ? `Uses the customer and film-roll data above${orderNumber ? ` · Order ${orderNumber}` : ""}.` : "Create the customer preview and Story share file directly inside Darkroom Dispatch."}</p></div><span className="csg-local">Original scans stay local</span></div>
    <div className="csg-layout">
      <aside className="csg-panel">
        {availableRolls.length > 1 && <><label className="csg-label">Film roll</label><select value={selectedRoll} disabled={working} onChange={e=>chooseLinkedRoll(Number(e.target.value))}>{availableRolls.map((roll,index)=><option key={`${roll}-${index}`} value={index}>{`Roll ${index+1} · ${roll}`}</option>)}</select></>}
        {availableRolls.length > 0 && <label className="csg-check csg-include"><input type="checkbox" checked={rollIncluded} onChange={e=>onRollInclusionChange && onRollInclusionChange(selectedRoll,e.target.checked)}/><span><strong>Include a contact sheet for this roll</strong></span></label>}
        <label className="csg-label">Film name</label><input value={filmName} onChange={e=>setFilmName(e.target.value)} placeholder="Kodak Ultramax 400" readOnly={embedded&&availableRolls.length>0}/>
        <label className="csg-label">Customer name</label><input value={customerName} onChange={e=>setCustomerName(e.target.value)} placeholder="Customer name" readOnly={embedded&&!!linkedCustomerName}/>
        <label className="csg-label">scanSAUce style</label><select value={scanStyle} onChange={e=>{setScanStyle(e.target.value);setConfirmed(false)}}><option>Classic</option><option>Isle Punch</option><option>Flat</option></select>
        <label className="csg-label">Frame format</label><div className="csg-row"><button className={`csg-choice ${format==="full"?"active":""}`} onClick={()=>setFormat("full")}>Full frame</button><button className={`csg-choice ${format==="half"?"active":""}`} onClick={()=>setFormat("half")}>Half frame</button></div>
        <label className="csg-check"><input type="checkbox" checked={numbered} onChange={e=>setNumbered(e.target.checked)}/><span>Show frame numbers</span></label>
        <label className="csg-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I confirm these scans use <strong>scanSAUce: {scanStyle}</strong></span></label>
      </aside>
      <section className="csg-work">
        <div className={`csg-drop ${dragging?"drag":""} ${rollIncluded?"":"excluded"}`} onDragOver={e=>{e.preventDefault();if(rollIncluded&&!isPreparing)setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(rollIncluded&&!isPreparing)prepareFolderDrop(e.dataTransfer)}}>
          {isPreparing ? <div className="csg-rollo-loading" role="status" aria-live="polite"><div className="csg-rollo-sprite" aria-hidden="true"/><div><strong>{prepareCount.current} of {prepareCount.total}</strong><span>Rollo is preparing this roll</span></div></div>
          : !rollIncluded ? <div><strong>Contact sheet skipped for this roll</strong><span>Tick “Include a contact sheet for this roll” to add scans.</span></div>
          : <div><strong>Drop one roll or several roll folders here</strong><span>Each top-level folder becomes one roll · JPEG or TIFF</span><div className="csg-drop-actions"><button onClick={()=>inputRef.current.click()}>Choose scan files</button><button onClick={()=>folderInputRef.current.click()}>Choose folder</button></div><input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,image/jpeg,image/tiff" hidden onChange={e=>{prepare(e.target.files);e.target.value=""}}/><input ref={folderInputRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={e=>{const folderName=e.target.files[0]?.webkitRelativePath?.split("/")[0] || "";prepare(e.target.files,folderName);e.target.value=""}}/></div>}
        </div>
        {error && <div className="csg-status csg-error">{error}</div>}
        <div className="csg-preview">
          <div className="csg-tabs"><div><button className={active==="delivery"?"active":""} onClick={()=>setActive("delivery")}>Delivery 4:3</button><button className={active==="story"?"active":""} onClick={()=>setActive("story")}>Story 9:16</button></div><span>{frames.length ? `${frames.length} frames · ${working?"working":"ready"}` : "No roll loaded"}</span></div>
          <div className={`csg-stage ${frames.length?"":"empty"}`}>
            {!frames.length && <span>Contact sheet preview</span>}
            <canvas ref={deliveryRef} className={active==="delivery"&&frames.length?"":"hidden"}/>
            <canvas ref={storyRef} className={active==="story"&&frames.length?"":"hidden"}/>
          </div>
          <div className="csg-export"><small>Prepare this pair for the delivery preview. It uploads to R2 only when you publish; nothing is downloaded here.</small><button disabled={!rollIncluded||!frames.length||!confirmed||working} onClick={preparePair}>Prepare pair</button></div>
        </div>
      </section>
    </div>
  </div>;
}
