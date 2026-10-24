export async function rollCallBackupFile(db) {
  const backup=await db.rpc('rc_backup');
  if(backup?.format!=='saujana-bali-roll-call'||backup.schemaVersion!==1||Object.keys(backup.tables||{}).length!==8)throw Error('Roll Call backup is incomplete. Export stopped.');
  return {
    label:'Roll Call backup',fileName:`saujana-bali-roll-call-${backup.exportedAt.slice(0,10)}.json`,mimeType:'application/json;charset=utf-8',
    rowCount:Object.values(backup.tables).reduce((total,rows)=>total+rows.length,0),content:JSON.stringify(backup,null,2)
  };
}

export async function readExportRows(db,table,columns,order) {
  const rows=[];
  for(let page=0;page<10000;page++){
    const batch=await db.select(table,`?select=${columns}&order=${order}&limit=500&offset=${rows.length}`);
    if(!Array.isArray(batch))throw Error(`Could not export ${table}.`);
    if(!batch.length)return rows;
    rows.push(...batch);
  }
  throw Error(`Export too large for ${table}. Use a database dump instead.`);
}
