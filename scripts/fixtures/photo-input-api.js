export const getSession=async()=>({data:{session:{user:{id:'owner'}}}});
export const fetchMyJobPhotos=async()=>({data:[],error:null});
export async function uploadPhoto(file,opts){window.qaRequests.push({name:file.name,opts});await window.qaBeforeUpload?.();if(window.qaReject)throw Error('rejected');return {url:'https://photos.test/'+file.name};}
