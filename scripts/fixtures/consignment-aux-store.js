export function createOperationStore(dbName){
 const key=dbName;window.qaPending||={};window.qaPending[key]||={};const data=window.qaPending[key];
 return {read:async k=>{if(window.qaOptions.storageError)throw Error('blocked');return data[k]||null;},acquire:async(k,p)=>{if(window.qaOptions.storageError)throw Error('blocked');return data[k]||(data[k]=JSON.parse(JSON.stringify(p)));},clear:async(k,id)=>{if(data[k]?.requestId===id)delete data[k];}};
}
