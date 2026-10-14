import {authClient,requireOrganisationCapability} from "./auth_client.js";

const el=(id)=>document.getElementById(id);
let groups=[];
function esc(value){return String(value??"").replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function date(v){return v?esc(v):"Unknown";}
function number(v){return v===null||v===undefined?"—":Number(v).toLocaleString("en-AU",{maximumFractionDigits:3});}
function groupRows(query){
 const serial=query.trim().replace(/^0+/,"")||"0";
 const filter=query.trim()?Number(serial):null;
 const displayed=groups.filter(g=>filter===null||(Number.isInteger(filter)&&filter>=Number(g.first_serial)&&filter<=Number(g.last_serial)));
 el("historyFilterStatus").textContent=query.trim()?displayed.length+" matching QC group(s)":groups.length+" historical QC group(s)";
 el("historyGroupRows").innerHTML=displayed.length?displayed.map(g=>`<tr>
 <td>${esc(g.row)}</td><td>${date(g.original_label_date)}</td>
 <td>${esc(g.first_serial===g.last_serial?g.first_serial:g.first_serial+"–"+g.last_serial)} ${g.source_range_inferred?'<span class="history-tag">(inferred)</span>':""}</td>
 <td>${number(g.volume_l)}</td><td>${number(g.ph)}</td><td>${number(g.ec_ms_cm)}</td>
 <td>${number(g.ppt)}</td><td>${number(g.salt_ppt)}</td>
 <td class="history-muted">Unknown</td><td>${g.recall==="Yes"?'<span class="history-tag">Recall flagged</span>':g.recall==="unknown"?"Not recorded":"—"}</td></tr>`).join(""):`<tr><td colspan="10" class="history-empty">No historical QC group covers this container number. A QC group match is not evidence that the physical container was still in stock.</td></tr>`;
}
function render(data){
 groups=Array.isArray(data.groups)?data.groups:[];
 const disposals=Array.isArray(data.disposals)?data.disposals:[];
 el("historyGroupCount").textContent=groups.length;
 el("historyDisposalCount").textContent=disposals.length;
 el("historyDiscardedLitres").textContent=number(disposals.reduce((total,row)=>total+Number(row.volume_l||0),0));
 el("historyCorrectionCount").textContent=number(data.original_date_corrections);
 groupRows("");
 el("historyDisposalRows").innerHTML=disposals.length?disposals.map(d=>`<tr>
 <td>${esc(d.row)}</td><td>${date(d.original_label_date)}</td><td class="history-muted">Unknown</td>
 <td>${number(d.volume_l)}</td><td>${number(d.ph)}</td><td>${number(d.ec_ms_cm)}</td>
 <td>${number(d.ppt)}</td><td>${number(d.salt_ppt)}</td><td>Unknown</td><td>No</td></tr>`).join(""):`<tr><td colspan="10">No historical unidentified disposals for this organisation.</td></tr>`;
}
async function init(){
 const access=await requireOrganisationCapability("form_stock_record","can_submit_collection","historical_stock.html");
 if(!access)return;
 el("historySerialFilter").addEventListener("input",event=>groupRows(event.target.value));
 el("historyClearFilter").addEventListener("click",()=>{el("historySerialFilter").value="";groupRows("");});
 try{
  const {data,error}=await authClient.rpc("ag_historical_stock_reconciliation");
  if(error)throw error;
  render(Array.isArray(data)?(data[0]||{}):(data||{}));
  el("historyLoadStatus").textContent="Historical evidence loaded";
 }catch(e){el("historyLoadStatus").textContent="Unable to load historical stock: "+String(e.message||e);
  el("historyGroupRows").innerHTML='<tr><td colspan="10">Unable to load</td></tr>';
  el("historyDisposalRows").innerHTML='<tr><td colspan="10">Unable to load</td></tr>';
 }
}
document.addEventListener("DOMContentLoaded",init);
