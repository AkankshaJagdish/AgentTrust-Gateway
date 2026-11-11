"use client";
import { useMemo, useState } from "react";
import { AgGridReact } from "@ag-grid-community/react";
import type { ColDef, ICellRendererParams } from "@ag-grid-community/core";
import { ModuleRegistry } from "@ag-grid-community/core";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
ModuleRegistry.registerModules([ClientSideRowModelModule]);
type Row=Record<string,any>;
function Status({value}:ICellRendererParams){const color=["ACTIVE","ALLOW","VERIFIED","CAPTURED","AUTHORIZED","SUCCESS"].includes(value)?"green":["BLOCK","REJECTED","REVOKED","FAILED","SUSPENDED"].includes(value)?"red":["REQUIRE_APPROVAL","PENDING","CREATED"].includes(value)?"amber":"gray";return <span className={`pill ${color}`}>{String(value??"—").replaceAll("_"," ")}</span>}
const money=(v:any)=>v==null?"—":Number(v).toLocaleString("en-US",{style:"currency",currency:"USD"});
export function AgentGrid({kind,rows}:{kind:"agents"|"requests"|"orders"|"policies"|"audits";rows:Row[]}) {
 const [quick,setQuick]=useState("");
 const columns=useMemo<ColDef<Row>[]>(()=>{
 const shared:ColDef<Row>={sortable:true,filter:true,resizable:true};
 if(kind==="agents")return [{field:"name",headerName:"Agent",pinned:"left",minWidth:180},{field:"id",headerName:"Agent ID",minWidth:180},{field:"status",cellRenderer:Status},{field:"_count.requests",headerName:"Requests",valueGetter:p=>p.data?._count?.requests},{field:"_count.orders",headerName:"Orders",valueGetter:p=>p.data?._count?.orders},{field:"createdAt",headerName:"Registered",minWidth:170,valueFormatter:p=>p.value?new Date(p.value).toLocaleString():"—"}];
 if(kind==="requests")return [{field:"createdAt",headerName:"Timestamp",pinned:"left",minWidth:175,valueFormatter:p=>new Date(p.value).toLocaleString()},{field:"agent.name",headerName:"Agent",valueGetter:p=>p.data?.agent?.name??"Unknown"},{field:"requestId",headerName:"Request ID",minWidth:190},{field:"signatureValid",headerName:"Signature",cellRenderer:p=><Status value={p.value?"VERIFIED":"REJECTED"}/>},{field:"amount",headerName:"Amount",valueFormatter:p=>money(p.value)},{field:"currency",headerName:"Currency"},{field:"decision",cellRenderer:Status},{field:"reason",headerName:"Decision reason",minWidth:300,flex:1}];
 if(kind==="orders")return [{field:"createdAt",headerName:"Created",pinned:"left",minWidth:170,valueFormatter:p=>new Date(p.value).toLocaleString()},{field:"paypalOrderId",headerName:"PayPal order",minWidth:190},{field:"agent.name",headerName:"Agent",valueGetter:p=>p.data?.agent?.name},{field:"amount",headerName:"Amount",valueFormatter:p=>money(p.value)},{field:"currency",headerName:"Currency"},{field:"status",cellRenderer:Status},{field:"approvalUrl",headerName:"Approval link",minWidth:180,cellRenderer:p=>p.value?<a href={p.value} target="_blank" rel="noreferrer" style={{color:"#245bdb"}}>Open PayPal</a>:"—"}];
 if(kind==="policies")return [{field:"name",headerName:"Policy",pinned:"left",minWidth:160},{field:"consent.agent.name",headerName:"Agent",valueGetter:p=>p.data?.consent?.agent?.name},{field:"maxPerTx",headerName:"Per transaction",valueFormatter:p=>money(p.value)},{field:"dailyCap",headerName:"Daily cap",valueFormatter:p=>money(p.value)},{field:"currency"},{field:"enabled",headerName:"Status",cellRenderer:p=><Status value={p.value?"ACTIVE":"SUSPENDED"}/>},{field:"expiresAt",headerName:"Expiry",valueFormatter:p=>p.value?new Date(p.value).toLocaleDateString():"No expiry"}];
 return [{field:"createdAt",headerName:"Timestamp",pinned:"left",minWidth:175,valueFormatter:p=>new Date(p.value).toLocaleString()},{field:"actorType",headerName:"Actor"},{field:"action",headerName:"Action",minWidth:200},{field:"entityType",headerName:"Entity"},{field:"outcome",cellRenderer:Status},{field:"reason",headerName:"Reason",minWidth:280,flex:1}];
 },[kind]);
 const defaults={sortable:true,filter:true,resizable:true};
 return <div><div className="toolbar"><input className="search" value={quick} onChange={e=>setQuick(e.target.value)} placeholder="Search across all columns…" aria-label="Quick search"/><span className="panel-meta">{rows.length} records · sort and filter each column</span></div><div className="ag-theme-quartz grid-wrap"><AgGridReact rowData={rows} columnDefs={columns} defaultColDef={defaults} quickFilterText={quick} pagination paginationPageSize={10} animateRows suppressCellFocus/></div></div>;
}
