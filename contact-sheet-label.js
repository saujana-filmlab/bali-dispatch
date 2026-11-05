(function(root){
 async function sourceBlob(sheet,variant,signal){
  const blob=variant==='delivery'?sheet.deliveryBlob:sheet.storyBlob;if(blob instanceof Blob)return blob;
  const url=variant==='delivery'?sheet.deliveryUrl:sheet.storyUrl;if(!url)throw Error('Both saved sheet formats are needed.');
  const response=await fetch(url,{signal,cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Could not load the saved contact sheet. Try again.');return response.blob();
 }
 async function relabel(blob,variant,filmName,customerName,signal){
  const image=await createImageBitmap(blob),width=variant==='delivery'?1600:1080,height=variant==='delivery'?1200:1920;
  try{
   if(signal?.aborted)throw Error('Label correction cancelled.');
   if(image.width!==width||image.height!==height)throw Error('This older sheet size needs Replace with prepared JPEGs instead.');
   const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});ctx.drawImage(image,0,0);
   const margin=variant==='delivery'?54:38,header=variant==='delivery'?132:260;
   // Only the known generator's empty caption band may be changed; never guess over a photo grid.
   for(let i=1;i<=8;i++){
    const x=Math.round(margin+(width-2*margin)*i/9),pixel=ctx.getImageData(x,header-17,1,1).data;
    if(pixel[0]<100||pixel[1]<60||pixel[2]>160||pixel[0]-pixel[1]<15||pixel[1]-pixel[2]<15)throw Error('This sheet layout is not recognised. Use Replace with prepared JPEGs instead.');
    const background=ctx.getImageData(x,header-19,1,1).data;
    if(Math.max(background[0],background[1],background[2])>45)throw Error('This sheet layout needs a full replacement.');
   }
   const baseSize=variant==='delivery'?14:13,spacing=variant==='delivery'?1.8:1.5;
   ctx.font=`600 ${baseSize}px Arial`;ctx.letterSpacing=spacing+'px';
   const counterWidth=Math.max(ctx.measureText('200 FRAMES · FULL FRAME').width,ctx.measureText('200 FRAMES · HALF FRAME').width);
   const titleWidth=width-2*margin-counterWidth-24,title=[filmName.trim(),customerName.trim()].filter(Boolean).join(' · ');
   let size=baseSize,tracking=spacing;
   while(ctx.measureText(title).width>titleWidth&&size>9){size--;tracking=Math.max(0,tracking-.3);ctx.font=`600 ${size}px Arial`;ctx.letterSpacing=tracking+'px';}
   if(ctx.measureText(title).width>titleWidth)throw Error('The new label is too long. Shorten the film or sheet name.');
   ctx.fillStyle='#070707';ctx.fillRect(margin-2,header-45,titleWidth+4,25);
   ctx.fillStyle='#b7b0a5';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillText(title,margin,header-27);
   if(signal?.aborted)throw Error('Label correction cancelled.');
   return new Promise((resolve,reject)=>canvas.toBlob(result=>result?resolve(result):reject(Error('Could not export the corrected sheet.')),'image/jpeg',.98));
  }finally{image.close();}
 }
 async function prepare({sheet,filmName,customerName,signal}){
  if(!String(filmName||'').trim()||String(filmName).length>120)throw Error('Enter a film name up to 120 characters.');
  filmName=String(filmName);customerName=String(customerName||'');
  const deliveryBlob=await relabel(await sourceBlob(sheet,'delivery',signal),'delivery',filmName,customerName,signal);
  const storyBlob=await relabel(await sourceBlob(sheet,'story',signal),'story',filmName,customerName,signal);
  if(signal?.aborted)throw Error('Label correction cancelled.');
  return {...sheet,filmName:filmName.trim(),deliveryBlob,storyBlob,deliveryPreviewUrl:URL.createObjectURL(deliveryBlob),storyPreviewUrl:URL.createObjectURL(storyBlob),labelOnly:true};
 }
 root.SaujanaContactSheetLabel={prepare};
})(window);
