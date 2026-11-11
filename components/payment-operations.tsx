"use client";
import {useEffect,useState} from "react";
type Auth={id:string;paypalAuthorizationId:string;status:string;amount:string;currency:string};
type Order={id:string;paypalOrderId:string|null;status:string;amount:string;currency:string;approvalUrl:string|null;authorizations:Auth[];transitions:{toStatus:string;source:string}[];agent:{name:string}};
const money=(v:string,c:string)=>Number(v).toLocaleString("en-US",{style:"currency",currency:c});
export function PaymentOperations(){
 const [orders,setOrders]=useState<Order[]>([]);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 async function load(){const r=await fetch("/api/orders",{cache:"no-store"});if(r.ok)setOrders(await r.json());}
 useEffect(()=>{void load();},[]);
 async function post(path:string,body:unknown){setBusy(true);setError("");setNotice("");try{const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error??"Payment operation failed.");setNotice(d.approvalId?"Capture approval issued.":`Payment operation returned ${d.status??"success"}.`);await load();}catch(e){setError(e instanceof Error?e.message:"Payment operation failed.");}finally{setBusy(false);}}
 return <section className="panel"><div className="panel-head"><div><div className="panel-title">PayPal authorization &amp; capture</div><div className="panel-meta">Sandbox payment state and separately approved captures</div></div><button className="btn secondary" onClick={()=>load()}>Refresh</button></div>
 {error&&<div className="notice" style={{background:"#fff0f1",color:"#ae3444"}}>{error}</div>}{notice&&<div className="notice">{notice}</div>}
 {orders.length===0&&<div className="empty">No PayPal orders yet. An ALLOW agent checkout creates an approval link.</div>}
 {orders.map(order=><div key={order.id} style={{borderTop:"1px solid #edf0f4",padding:"14px 0"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="event-title">{order.agent.name} · {money(order.amount,order.currency)}</div><div className="event-sub">{order.paypalOrderId??order.id} · <b>{order.status}</b> · {order.currency}</div></div>{order.approvalUrl&&order.status==="CREATED"&&<a className="btn" href={order.approvalUrl} target="_blank" rel="noreferrer">Buyer approval at PayPal</a>}</div>
  {order.authorizations.map(auth=><div key={auth.id} style={{marginTop:12,padding:12,background:"#f7f9fc",borderRadius:8}}>
   <div className="event-title">Authorization {auth.paypalAuthorizationId}</div><div className="event-sub">{auth.status} · {money(auth.amount,auth.currency)}</div>
   {(auth.status==="CREATED"||auth.status==="AUTHORIZED")&&order.status==="AUTHORIZED"&&<CaptureForm order={order} auth={auth} busy={busy} onPost={post}/ >}
   {order.status==="AUTHORIZED"&&<button className="btn danger" style={{marginTop:8}} disabled={busy} onClick={()=>post("/api/payments/void",{orderId:order.paypalOrderId,authorizationId:auth.paypalAuthorizationId,reason:"Merchant voided authorization"})}>Void authorization</button>}
  </div>)}
  <div className="event-sub" style={{marginTop:8}}>History: {order.transitions.map(t=>`${t.toStatus} (${t.source})`).join(" → ")||"—"}</div>
 </div>)}
 </section>;
}
function CaptureForm({order,auth,busy,onPost}:{order:Order;auth:Auth;busy:boolean;onPost:(path:string,body:unknown)=>Promise<void>}){
 const [approval,setApproval]=useState("");
 return <div style={{marginTop:10}}>
  <div className="inline-note">Buyer approval and authorization are complete. A merchant must explicitly issue a separate capture approval. The approval is valid for 10 minutes and checks current consent, policy, amount, currency and merchant ownership.</div>
  {!approval?<button className="btn" style={{marginTop:9}} disabled={busy} onClick={async()=>{const r=await fetch("/api/payments/capture-approval",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:order.id,authorizationId:auth.paypalAuthorizationId,amount:order.amount,currency:order.currency,reason:"Merchant approved fulfillment"})});const d=await r.json();if(!r.ok)alert(d.error??"Approval failed.");else setApproval(d.approvalId);}}>Approve capture as merchant</button>:
  <button className="btn" style={{marginTop:9}} disabled={busy} onClick={async()=>{await onPost("/api/payments/capture",{approvalId:approval});setApproval("");}}>Confirm capture</button>}
 </div>;
}
