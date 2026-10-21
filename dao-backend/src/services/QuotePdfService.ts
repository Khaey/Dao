import { DomainError } from '../lib/errors.js';

const PAGE_WIDTH=595;
const PAGE_HEIGHT=842;
const BOTTOM=58;
const BRAND:[number,number,number]=[0.08,0.29,0.25];
const INK:[number,number,number]=[0.12,0.16,0.18];
const MUTED:[number,number,number]=[0.39,0.43,0.44];
const LIGHT:[number,number,number]=[0.94,0.96,0.95];

const winAnsi:Record<string,number>={
  '€':0x80,'‚':0x82,'ƒ':0x83,'„':0x84,'…':0x85,'†':0x86,'‡':0x87,'ˆ':0x88,'‰':0x89,
  'Š':0x8a,'‹':0x8b,'Œ':0x8c,'Ž':0x8e,'‘':0x91,'’':0x92,'“':0x93,'”':0x94,'•':0x95,
  '–':0x96,'—':0x97,'˜':0x98,'™':0x99,'š':0x9a,'›':0x9b,'œ':0x9c,'ž':0x9e,'Ÿ':0x9f,
};

function pdfText(value:unknown) {
  let encoded='';
  for(const character of String(value??'').normalize('NFC')){
    const code=character.codePointAt(0)??63;
    const byte=winAnsi[character]??(code<=255?code:63);
    encoded+=String.fromCharCode(byte);
  }
  return encoded.replace(/([\\()])/g,'\\$1').replace(/[\r\n\t]/g,' ');
}

const money=(millimes:number)=>`${(millimes/1000).toFixed(3)} TND`;
const number=(milli:number)=>{
  const result=(milli/1000).toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  return result||'0';
};
const date=(value:unknown)=>{
  if(!value)return 'Non renseignée';
  const parsed=new Date(String(value).length===10?`${value}T00:00:00Z`:String(value));
  return Number.isNaN(parsed.getTime())?'Non renseignée':new Intl.DateTimeFormat('fr-TN',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'}).format(parsed);
};
const rgb=([r,g,b]:[number,number,number])=>`${r} ${g} ${b}`;
const width=(text:string,size:number)=>[...text].length*size*.5;

class PdfLayout {
  private pages:string[][]=[];
  private y=0;
  constructor(private readonly reference:string) { this.addPage(); }

  private page(){return this.pages[this.pages.length-1];}
  private command(value:string){this.page().push(value);}
  private rect(x:number,y:number,w:number,h:number,fill?:[number,number,number],stroke?:[number,number,number]){
    if(fill)this.command(`${rgb(fill)} rg`);
    if(stroke)this.command(`${rgb(stroke)} RG 0.6 w`);
    this.command(`${x} ${y} ${w} ${h} re ${fill&&stroke?'B':fill?'f':'S'}`);
  }
  private line(x1:number,y1:number,x2:number,y2:number,color:[number,number,number]=[.78,.8,.79]){
    this.command(`${rgb(color)} RG 0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  private text(x:number,y:number,value:unknown,size=10,bold=false,color:[number,number,number]=INK,align:'left'|'right'='left'){
    const plain=String(value??'');
    const position=align==='right'?x-width(plain,size):x;
    this.command(`BT /${bold?'F2':'F1'} ${size} Tf ${rgb(color)} rg ${position.toFixed(1)} ${y.toFixed(1)} Td (${pdfText(plain)}) Tj ET`);
  }
  private wrap(value:unknown,maxWidth:number,size:number){
    const lines:string[]=[];
    for(const paragraph of String(value??'').split(/\r?\n/)){
      const words=paragraph.trim().split(/\s+/).filter(Boolean);
      if(!words.length){lines.push('');continue;}
      let current='';
      for(const sourceWord of words){
        let word=sourceWord;
        const candidate=current?`${current} ${word}`:word;
        if(width(candidate,size)<=maxWidth){current=candidate;continue;}
        if(current)lines.push(current);
        if(width(word,size)<=maxWidth){current=word;continue;}
        const limit=Math.max(1,Math.floor(maxWidth/(size*.5)));
        while(word.length>limit){lines.push(word.slice(0,limit));word=word.slice(limit);}
        current=word;
      }
      if(current)lines.push(current);
    }
    return lines;
  }
  private addPage(){
    this.pages.push([]);
    this.rect(0,PAGE_HEIGHT-82,PAGE_WIDTH,82,BRAND);
    this.text(42,788,'D.A.O',24,true,[1,1,1]);
    this.text(42,770,'Devis professionnel',9,false,[.86,.94,.91]);
    this.text(PAGE_WIDTH-42,788,'OFFRE COMMERCIALE',9,true,[1,1,1],'right');
    this.text(PAGE_WIDTH-42,770,`Réf. ${this.reference}`,8,false,[.86,.94,.91],'right');
    this.y=735;
  }
  private ensure(height:number){if(this.y-height<BOTTOM)this.addPage();}
  heading(title:string,subtitle:string){
    this.text(42,this.y,title,27,true,BRAND);this.y-=23;
    this.text(42,this.y,subtitle,10,false,MUTED);this.y-=25;
    this.line(42,this.y,PAGE_WIDTH-42,this.y,BRAND);this.y-=18;
  }
  metadata(rows:Array<[string,string]>){
    const h=rows.length*18+16;this.ensure(h);
    this.rect(42,this.y-h+5,PAGE_WIDTH-84,h,LIGHT);
    let y=this.y-14;
    for(const [label,value] of rows){this.text(54,y,label.toUpperCase(),7,true,MUTED);this.text(175,y,value,10,true,INK);y-=18;}
    this.y-=h+10;
  }
  section(title:string){
    this.ensure(34);this.rect(42,this.y-23,PAGE_WIDTH-84,27,[.89,.94,.92]);
    this.text(52,this.y-14,title,12,true,BRAND);this.y-=38;
  }
  paragraph(label:string,value:unknown){
    if(value===null||value===undefined||String(value).trim()==='')return;
    const lines=this.wrap(value,PAGE_WIDTH-104,9);
    this.ensure(20);this.text(52,this.y,label,8,true,MUTED);this.y-=13;
    for(const part of lines){this.ensure(13);this.text(52,this.y,part,9);this.y-=12;}
    this.y-=5;
  }
  keyValue(label:string,value:string,highlight=false){
    this.ensure(25);
    if(highlight)this.rect(42,this.y-19,PAGE_WIDTH-84,25,[.91,.96,.94],BRAND);
    this.text(highlight?52:46,this.y-11,label,9,highlight,MUTED);
    this.text(PAGE_WIDTH-(highlight?52:46),this.y-11,value,10,true,highlight?BRAND:INK,'right');
    this.y-=highlight?34:24;
  }
  table(rows:Array<{designation:string;unit:string;quantity:string;unitPrice:string;total:string}>){
    const x=32;const widths=[246,50,55,90,90];
    const header=()=>{
      this.ensure(28);const h=24;this.rect(x,this.y-h,531,h,BRAND);
      const labels=['Désignation','Unité','Qté','P.U. (TND)','Total (TND)'];let cursor=x;
      labels.forEach((label,index)=>{this.text(index<3?cursor+5:cursor+widths[index]-5,this.y-15,label,7,true,[1,1,1],index<3?'left':'right');cursor+=widths[index];});
      this.y-=h;
    };
    header();
    if(!rows.length){
      this.rect(x,this.y-28,531,28,[.98,.98,.97],[.8,.82,.81]);this.text(x+7,this.y-18,'Aucun poste détaillé renseigné.',8,false,MUTED);this.y-=28;return;
    }
    rows.forEach((row,rowIndex)=>{
      let designation=this.wrap(row.designation,widths[0]-12,8);
      let firstChunk=true;
      while(designation.length){
        if(this.y-24<BOTTOM){this.addPage();header();}
        const capacity=Math.max(1,Math.floor((this.y-BOTTOM-8)/10));
        const chunk=designation.splice(0,capacity);
        const h=Math.max(24,chunk.length*10+8);
        this.rect(x,this.y-h,531,h,rowIndex%2?[.97,.98,.97]:[1,1,1],[.8,.82,.81]);
        let cursor=x;for(const w of widths.slice(0,-1)){cursor+=w;this.line(cursor,this.y,cursor,this.y-h);}
        chunk.forEach((part,index)=>this.text(x+6,this.y-15-index*10,part,8));
        cursor=x+widths[0];this.text(cursor+5,this.y-15,firstChunk?row.unit:'suite',8);cursor+=widths[1];
        if(firstChunk){
          this.text(cursor+5,this.y-15,row.quantity,8);cursor+=widths[2];this.text(cursor+widths[3]-5,this.y-15,row.unitPrice,8,false,INK,'right');cursor+=widths[3];this.text(cursor+widths[4]-5,this.y-15,row.total,8,true,INK,'right');
        }
        this.y-=h;firstChunk=false;
        if(designation.length){this.addPage();header();}
      }
    });
    this.y-=8;
  }
  spacer(height=8){this.y-=height;}
  finish(){
    const total=this.pages.length;
    const objects:string[]=['<< /Type /Catalog /Pages 2 0 R >>','',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'];
    const kids:number[]=[];
    this.pages.forEach((commands,index)=>{
      const pageNo=objects.length+1;const contentNo=pageNo+1;kids.push(pageNo);
      const footer=[`${rgb(MUTED)} RG 0.5 w 42 42 m 553 42 l S`,
        `BT /F1 7 Tf ${rgb(MUTED)} rg 42 27 Td (${pdfText('Document informatif — ne vaut ni attribution, ni contrat, ni paiement.')}) Tj ET`,
        `BT /F2 7 Tf ${rgb(MUTED)} rg 525 27 Td (${pdfText(`Page ${index+1} / ${total}`)}) Tj ET`];
      const content=[...commands,...footer].join('\n');
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });
    objects[1]=`<< /Type /Pages /Kids [${kids.map(value=>`${value} 0 R`).join(' ')}] /Count ${kids.length} >>`;
    let body='%PDF-1.4\n%âãÏÓ\n';const offsets=[0];
    objects.forEach((object,index)=>{offsets.push(body.length);body+=`${index+1} 0 obj\n${object}\nendobj\n`;});
    const xref=body.length;
    body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(value=>`${String(value).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Uint8Array.from(body,character=>character.charCodeAt(0)&0xff);
  }
}

export class QuotePdfService {
  constructor(private readonly db:any) {}
  async export(versionId:string) {
    const versionResult=await this.db.from('bid_versions').select('id,project_id,version_no,submitted_at,quote_valid_until,quote_terms,material_references,contractor_profiles(business_name)').eq('id',versionId).single();
    if(versionResult.error||!versionResult.data)throw new DomainError('Quote not found','NOT_FOUND');
    const itemsResult=await this.db.from('bid_items').select('id,price_millimes,duration_days,inclusions,exclusions,project_request_versions!bid_items_request_version_id_project_id_request_id_fkey(title,scope)').eq('bid_version_id',versionId).order('created_at');
    if(itemsResult.error)throw itemsResult.error;
    const itemIds=(itemsResult.data??[]).map((item:any)=>item.id);
    const quoteResult=itemIds.length?await this.db.from('bid_quote_lines').select('bid_item_id,position,designation,unit,quantity_milli,unit_price_millimes,total_millimes').in('bid_item_id',itemIds).order('position'):{data:[],error:null};
    if(quoteResult.error)throw quoteResult.error;
    const version=versionResult.data;
    const contractor=Array.isArray(version.contractor_profiles)?version.contractor_profiles[0]:version.contractor_profiles;
    const layout=new PdfLayout(String(version.id||versionId));
    layout.heading('DEVIS',`Version ${version.version_no} — offre commerciale informative`);
    layout.metadata([
      ['Professionnel',contractor?.business_name||'Professionnel vérifié'],
      ['Date du devis',date(version.submitted_at)],
      ['Validité annoncée',date(version.quote_valid_until)],
      ['Référence chantier',String(version.project_id||'Non renseignée')],
    ]);
    let grandTotal=0;
    for(const [index,item] of (itemsResult.data??[]).entries()){
      grandTotal+=Number(item.price_millimes)||0;
      const request=Array.isArray(item.project_request_versions)?item.project_request_versions[0]:item.project_request_versions;
      layout.section(`Lot ${index+1} — ${request?.title||'Lot'}`);
      layout.paragraph('PÉRIMÈTRE',request?.scope);
      const itemQuotes=(quoteResult.data??[]).filter((quote:any)=>quote.bid_item_id===item.id);
      layout.table(itemQuotes.map((quote:any)=>({
        designation:String(quote.designation||''),unit:String(quote.unit||''),quantity:number(Number(quote.quantity_milli)||0),
        unitPrice:money(Number(quote.unit_price_millimes)||0).replace(' TND',''),total:money(Number(quote.total_millimes)||0).replace(' TND',''),
      })));
      if(itemQuotes.length)layout.keyValue('Sous-total des postes détaillés',money(itemQuotes.reduce((sum:number,quote:any)=>sum+(Number(quote.total_millimes)||0),0)));
      layout.keyValue('Montant proposé du lot',money(Number(item.price_millimes)||0),true);
      layout.keyValue('Délai annoncé',`${item.duration_days} jour${Number(item.duration_days)>1?'s':''}`);
      layout.paragraph('INCLUSIONS',item.inclusions);
      layout.paragraph('EXCLUSIONS',item.exclusions);
      layout.spacer(8);
    }
    layout.section('Récapitulatif');
    layout.keyValue('Montant total proposé',money(grandTotal),true);
    layout.paragraph('MATÉRIAUX / RÉFÉRENCES',version.material_references);
    layout.paragraph('CONDITIONS / GARANTIES ANNONCÉES',version.quote_terms);
    layout.paragraph('PORTÉE DU DOCUMENT','Ce devis présente une offre commerciale. Sa consultation ne vaut ni attribution, ni signature, ni contrat, ni constat de paiement.');
    return {bytes:layout.finish(),filename:`devis-dao-v${version.version_no}.pdf`};
  }
}
