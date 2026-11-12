export function parseCSV(input:string):Record<string,string>[] {
  const rows:string[][]=[]; let row:string[]=[],cell='',quoted=false;
  const s=input.replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++) {
    const c=s[i];
    if(c==='"') { if(quoted&&s[i+1]==='"') {cell+='"';i++;} else quoted=!quoted; }
    else if(c===','&&!quoted) {row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted) {if(c==='\r'&&s[i+1]==='\n')i++; row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted) throw new Error('CSV has an unclosed quote.');
  row.push(cell);if(row.some(Boolean))rows.push(row);
  const headers=rows.shift()?.map(h=>h.trim())??[];
  if(new Set(headers).size!==headers.length) throw new Error('CSV has duplicate column names.');
  return rows.map(r=>{if(r.length!==headers.length)throw new Error('CSV rows must match the column headers.');return Object.fromEntries(headers.map((h,i)=>[h,r[i]]));});
}
export function downloadCSV(name:string,rows:Record<string,unknown>[]) {
  if(!rows.length) throw new Error('There are no rows to export.');
  const headers=Object.keys(rows[0]);
  const escape=(value:unknown)=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  const text=[headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(escape).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
