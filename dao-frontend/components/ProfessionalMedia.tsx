'use client';
import { useEffect,useState } from 'react';
import { Button } from './ui';
import { professionalBlob } from '../lib/professionals';
export default function ProfessionalMedia({kind,file,auto=false}:{kind:string;file:any;auto?:boolean}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  useEffect(()=>()=>{if(url) URL.revokeObjectURL(url);},[url]);
  async function open() {setLoading(true);setError('');try{const blob=await professionalBlob(kind,file.id);const next=URL.createObjectURL(blob);if(file.mime_type==='application/pdf'){const a=document.createElement('a');a.href=next;a.download=file.original_name||'document.pdf';a.click();URL.revokeObjectURL(next);}else setUrl(next);}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{if(auto) void open();},[file.id,auto]);
  return <div className="space-y-2">{url&&<img src={url} alt={file.caption||file.original_name||'Média professionnel'} className="max-h-80 w-full rounded-xl object-contain"/>}<Button type="button" disabled={loading} onClick={()=>void open()} className="bg-sand text-ink">{loading?'Chargement…':file.mime_type==='application/pdf'?`Télécharger ${file.original_name}`:`Afficher ${file.original_name}`}</Button>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
}
