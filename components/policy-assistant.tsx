"use client";
import {useEffect,useState} from "react";

type Consent={id:string;agentId:string;agent:{name:string};currency:string;spendingCap:string;expiresAt:string;status:string};
type Agent={id:string;name:string;status:string};
type Policy={id:string;name:string;maxPerTx:string;dailyCap:string;currency:string;requireApprovalAbove:string|null;enabled:boolean;version:number;aiGenerated:boolean;consent?:{agent?:{name:string}}};
type Draft={draftId:string;policy:{name:string;summary:string;currency:string;maxPerTx:string|null;dailyCap:string|null;requireApprovalAbove:string|null;requireVerifiedAgents:true;blockExpiredAgents:true;clarifications:string[]};canActivate:boolean;validationError:string|null;expiresAt:string;consent:{agentName:string;currency:string;spendingCap:string}};
type Risk={level:"LOW"|"MEDIUM"|"HIGH";summary:string;factors:{label:string;impact:string;explanation:string}[];missingInformation:string[];recommendation:string};
const money=(v:string|null|undefined)=>v?Number(v).toLocaleString("en-US",{style:"currency",currency:"USD"}):"Not specified";
export function PolicyAssistant({onChanged}:{onChanged?:()=>void}){
 const [consents,setConsents]=useState<Consent[]>([]),[agents,setAgents]=useState<Agent[]>([]),[policies,setPolicies]=useState<Policy[]>([]);
 const [consentId,setConsentId]=useState(""),[description,setDescription]=useState("Allow verified agents to purchase up to $50 per transaction, with a maximum daily budget of $150. Require human approval for anything above $30. Block expired agents.");
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [agentId,setAgentId]=useState(""),[amount,setAmount]=useState("35"),[currency,setCurrency]=useState("USD"),[transactionDescription,setTransactionDescription]=useState("Office supplies"),[risk,setRisk]=useState<Risk|null>(null);
 const [editing,setEditing]=useState<Policy|null>(null),[history,setHistory]=useState<any[]>([]);
 async function load(){const r=await fetch("/api/dashboard",{cache:"no-store"});if(r.ok){const d=await r.json();setConsents(d.consents??[]);setAgents(d.agents??[]);setPolicies(d.policies??[]);if(!consentId){const active=(d.consents??[]).find((x:Consent)=>x.status==="ACTIVE"&&new Date(x.expiresAt)>new Date());if(active)setConsentId(active.id);}if(!agentId&&d.agents?.[0])setAgentId(d.agents[0].id);}}
 useEffect(()=>{void load();},[]);
 async function preview(){setBusy(true);setError("");setNotice("");setDraft(null);try{const r=await fetch("/api/ai/policy/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({consentId,description})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Unable to create preview.");setDraft(d);}catch(e){setError(e instanceof Error?e.message:"Unable to create preview.");}finally{setBusy(false);}}
 async function activate(){if(!draft)return;setBusy(true);setError("");setNotice("");try{const r=await fetch("/api/ai/policy/activate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draftId:draft.draftId})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Activation failed.");setNotice(`Policy “${d.name}” activated as version ${d.version}. Deterministic enforcement is now active.`);setDraft(null);await load();onChanged?.();}catch(e){setError(e instanceof Error?e.message:"Activation failed.");}finally{setBusy(false);}}
 async function assess(){setBusy(true);setError("");setRisk(null);try{const r=await fetch("/api/ai/risk/assess",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({agentId,amount,currency,description:transactionDescription})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Risk assessment failed.");setRisk(d.assessment);setNotice(`Deterministic gateway result: ${d.deterministicDecision} — ${d.deterministicReason}`);}catch(e){setError(e instanceof Error?e.message:"Risk assessment failed.");}finally{setBusy(false);}}
 async function showHistory(id:string){setError("");const r=await fetch(`/api/policies/${id}`);const d=await r.json();if(!r.ok){setError(d.error??"Unable to load history.");return;}setHistory(d.versions??[]);setEditing(null);}
 async function saveEdit(){if(!editing)return;setBusy(true);setError("");try{const r=await fetch(`/api/policies/${editing.id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:editing.name,maxPerTx:editing.maxPerTx,dailyCap:editing.dailyCap,requireApprovalAbove:editing.requireApprovalAbove,enabled:editing.enabled})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Update failed.");setNotice(`Saved policy version ${d.version}.`);setEditing(null);await load();onChanged?.();}catch(e){setError(e instanceof Error?e.message:"Update failed.");}finally{setBusy(false);}}
 const field=(label:string,value:string,onChange:(v:string)=>void)=><label style={{display:"flex",flexDirection:"column",gap:5,fontSize:11,color:"#64728a"}}>{label}<input value={value} onChange={e=>onChange(e.target.value)} style={inputStyle}/></label>;
 return <section className="panel" id="ai-policy-assistant" style={{marginBottom:18}}>
  <div className="panel-head"><div><div className="panel-title">AI policy assistant</div><div className="panel-meta">Describe rules in plain language. Review the structured proposal, then explicitly activate it.</div></div><span className="pill" style={{background:"#edf2ff",color:"#2855bb"}}>OpenAI · Structured output</span></div>
  {error&&<div className="notice" style={{background:"#fff0f1",color:"#ae3444"}}>{error}</div>}{notice&&<div className="notice">{notice}</div>}
  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.2fr) minmax(260px,.8fr)",gap:18}}>
   <div>
    <label style={labelStyle}>Human consent / agent scope</label>
    <select value={consentId} onChange={e=>{setConsentId(e.target.value);setDraft(null);}} style={inputStyle}><option value="">Select active consent</option>{consents.filter(c=>c.status==="ACTIVE"&&new Date(c.expiresAt)>new Date()).map(c=><option key={c.id} value={c.id}>{c.agent.name} · {c.spendingCap} {c.currency}</option>)}</select>
    <label style={{...labelStyle,marginTop:12}}>Describe your agent security and spending rules</label>
    <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={5} style={{...inputStyle,resize:"vertical",lineHeight:1.55}} placeholder="Example: Allow verified agents up to $50 per transaction, $150 per day. Require human approval above $30. Block expired agents."/>
    <div className="inline-note" style={{marginTop:9}}>Agent signature verification and expired-agent blocking are mandatory gateway invariants. The AI cannot weaken them or perform payment operations.</div>
    <button className="btn" disabled={busy||!consentId||description.trim().length<12} onClick={preview} style={{marginTop:12}}>{busy?"Working…":"Generate policy preview"}</button>
   </div>
   <div style={{background:"#f7f9fc",border:"1px solid #e7ebf2",borderRadius:9,padding:14}}>
    <div className="panel-title">How activation works</div>
    <ol style={{paddingLeft:18,color:"#64728a",fontSize:12,lineHeight:1.8}}><li>OpenAI converts the description to a strict policy schema.</li><li>AgentTrust validates limits against the selected human consent.</li><li>You inspect the JSON and clarification warnings.</li><li>Only your explicit confirmation saves and activates the policy.</li></ol>
    <div className="event-sub">No AI-generated action can call PayPal create, authorize, capture, or void endpoints.</div>
   </div>
  </div>
  {draft&&<div style={{marginTop:18,borderTop:"1px solid #e9edf3",paddingTop:16}}>
   <div className="panel-head"><div><div className="panel-title">Policy preview · {draft.consent.agentName}</div><div className="panel-meta">Expires {new Date(draft.expiresAt).toLocaleTimeString()}</div></div><span className="pill" style={{background:draft.canActivate?"#eaf6f0":"#fff6e7",color:draft.canActivate?"#13734e":"#9d6917"}}>{draft.canActivate?"Ready for confirmation":"Needs clarification"}</span></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
    <Metric label="Per transaction" value={money(draft.policy.maxPerTx)}/><Metric label="Daily budget" value={money(draft.policy.dailyCap)}/><Metric label="Human approval above" value={money(draft.policy.requireApprovalAbove)}/>
   </div>
   <p style={{fontSize:12,lineHeight:1.6,color:"#56647a"}}>{draft.policy.summary}</p>
   <pre style={{whiteSpace:"pre-wrap",overflowX:"auto",background:"#111e35",color:"#dce7fb",padding:14,borderRadius:8,fontSize:11,lineHeight:1.5}}>{JSON.stringify(draft.policy,null,2)}</pre>
   {draft.validationError&&<div className="notice" style={{background:"#fff0f1",color:"#ae3444"}}>{draft.validationError}</div>}
   {draft.policy.clarifications.map((v,i)=><div className="event-sub" key={i}>• {v}</div>)}
   <div className="modal-actions"><button className="btn secondary" onClick={()=>setDraft(null)}>Discard preview</button><button className="btn" disabled={busy||!draft.canActivate} onClick={activate}>I confirm — activate policy</button></div>
  </div>}
  <div style={{borderTop:"1px solid #e9edf3",marginTop:20,paddingTop:16}}>
   <div className="panel-title">AI transaction risk assessment</div><div className="panel-meta" style={{marginTop:4,marginBottom:12}}>Advisory analysis of supplied transaction data alongside the authoritative deterministic gateway decision.</div>
   <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 2fr",gap:9,alignItems:"end"}}>
    <label style={labelStyle}>Agent<select value={agentId} onChange={e=>setAgentId(e.target.value)} style={inputStyle}><option value="">Select agent</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name} · {a.status}</option>)}</select></label>
    {field("Amount",amount,setAmount)}
    <label style={labelStyle}>Currency<select value={currency} onChange={e=>setCurrency(e.target.value)} style={inputStyle}>{["USD","EUR","GBP","INR","CAD","AUD"].map(c=><option key={c}>{c}</option>)}</select></label>
    {field("Transaction description",transactionDescription,setTransactionDescription)}
   </div>
   <button className="btn secondary" disabled={busy||!agentId||!amount} onClick={assess} style={{marginTop:10}}>Assess transaction risk</button>
   {risk&&<div style={{marginTop:12,padding:14,background:"#f7f9fc",borderRadius:8}}>
    <div className="panel-head"><b>AI risk: {risk.level}</b><span className="pill" style={{background:"#edf2ff",color:"#2855bb"}}>Advisory only</span></div>
    <p style={{fontSize:12,lineHeight:1.6}}>{risk.summary}</p>
    {risk.factors.map((f,i)=><div className="event" key={i}><span className="event-dot"/><div><b className="event-title">{f.label} · {f.impact}</b><div className="event-sub">{f.explanation}</div></div></div>)}
    {risk.missingInformation.length>0&&<div className="event-sub" style={{marginTop:8}}>Missing: {risk.missingInformation.join("; ")}</div>}
    <div className="inline-note" style={{marginTop:9}}>Recommendation: {risk.recommendation}. This assessment cannot override the deterministic decision shown above.</div>
   </div>}
  </div>
  <div style={{borderTop:"1px solid #e9edf3",marginTop:20,paddingTop:16}}>
   <div className="panel-title">Active policies · edit and version history</div>
   {policies.map(p=><div key={p.id} style={{padding:"12px 0",borderBottom:"1px solid #edf0f4"}}>
    {editing?.id===p.id?<div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:9}}>
      {field("Name",editing.name,v=>setEditing({...editing,name:v}))}
      {field("Max per transaction",editing.maxPerTx,v=>setEditing({...editing,maxPerTx:v}))}
      {field("Daily cap",editing.dailyCap,v=>setEditing({...editing,dailyCap:v}))}
      {field("Approval threshold (blank = none)",editing.requireApprovalAbove??"",v=>setEditing({...editing,requireApprovalAbove:v||null}))}
      <label style={{fontSize:11}}><input type="checkbox" checked={editing.enabled} onChange={e=>setEditing({...editing,enabled:e.target.checked})}/> Enabled</label>
      <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}><button className="btn secondary" onClick={()=>setEditing(null)}>Cancel</button><button className="btn" disabled={busy} onClick={saveEdit}>Save new version</button></div>
     </div>:<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
      <div><b style={{fontSize:12}}>{p.name}</b><div className="event-sub">{p.consent?.agent?.name??"Agent"} · {p.maxPerTx} / tx · {p.dailyCap} / day · v{p.version} · {p.enabled?"Enabled":"Disabled"}</div></div>
      <div style={{display:"flex",gap:7}}><button className="btn secondary" style={{padding:"6px 9px",fontSize:11}} onClick={()=>setEditing({...p,requireApprovalAbove:p.requireApprovalAbove??null})}>Edit</button><button className="btn secondary" style={{padding:"6px 9px",fontSize:11}} onClick={()=>showHistory(p.id)}>History</button></div>
     </div>}
   </div>)}
   {history.length>0&&<div style={{marginTop:12,padding:12,background:"#f7f9fc",borderRadius:8}}><div className="panel-head"><b>Immutable version history</b><button className="btn secondary" onClick={()=>setHistory([])}>Close</button></div>{history.map(v=><div key={v.id} className="event"><div><b className="event-title">Version {v.version}</b><div className="event-sub">{new Date(v.createdAt).toLocaleString()} · actor {v.actorUserId}</div><pre style={{whiteSpace:"pre-wrap",fontSize:10}}>{v.snapshot}</pre></div></div>)}</div>}
  </div>
 </section>;
}
function Metric({label,value}:{label:string;value:string}){return <div style={{background:"#f7f9fc",border:"1px solid #e7ebf2",borderRadius:8,padding:12}}><div className="event-sub">{label}</div><b style={{display:"block",fontSize:16,marginTop:5}}>{value}</b></div>}
const labelStyle:React.CSSProperties={display:"flex",flexDirection:"column",gap:5,fontSize:11,color:"#64728a"};
const inputStyle:React.CSSProperties={width:"100%",border:"1px solid #dfe5ee",borderRadius:7,padding:"10px 11px",background:"#fff",color:"#1b2940",outline:"none",fontSize:12};
