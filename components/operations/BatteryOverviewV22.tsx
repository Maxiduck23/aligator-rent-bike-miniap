"use client";
import { useEffect, useMemo, useState } from "react";

type Props = { showToast: (text: string) => void };
function initData(){ return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || ""; }
async function get<T>(url:string):Promise<T>{ const r=await fetch(url,{headers:{"x-telegram-init-data":initData()}}); const j=await r.json(); if(!r.ok||!j.ok) throw new Error(typeof j.error==="string"?j.error:j.error?.message||"API error"); return j.data; }

const FILTERS = [
  ["all","Все"],["assigned","На великах"],["free","Свободные"],["problem","Проблемные"]
] as const;

export default function BatteryOverviewV22({showToast}:Props){
  const [rows,setRows]=useState<any[]>([]); const [filter,setFilter]=useState("all"); const [q,setQ]=useState(""); const [loading,setLoading]=useState(false);
  async function load(){setLoading(true);try{setRows(await get<any[]>("/api/admin/operations/batteries"));}catch(e:any){showToast(e.message);}finally{setLoading(false)}}
  useEffect(()=>{load().catch(()=>null)},[]);
  const visible=useMemo(()=>rows.filter((r:any)=>{
    const problem=Array.isArray(r.warnings)&&r.warnings.length>0;
    if(filter==="assigned"&&r.overview_status!=="assigned")return false;
    if(filter==="free"&&!['free','legacy_link'].includes(r.overview_status))return false;
    if(filter==="problem"&&!problem)return false;
    const hay=[r.battery_id,r.effective_bike_id,r.bike_label,r.client_name,r.brand,r.capacity,r.generation].filter(Boolean).join(" ").toLowerCase();
    return !q.trim()||hay.includes(q.trim().toLowerCase());
  }),[rows,filter,q]);
  const byBike=useMemo(()=>{
    const m=new Map<string,any[]>(); for(const r of visible){const key=r.effective_bike_id?String(r.effective_bike_id):"free"; if(!m.has(key))m.set(key,[]);m.get(key)!.push(r)} return [...m.entries()].sort((a,b)=>a[0]==="free"?1:b[0]==="free"?-1:Number(a[0])-Number(b[0]));
  },[visible]);
  return <div className="grid">
    <div className="card wide"><div className="space"><div><h2>🔋 Карта батарей</h2><div className="small muted">Один экран: какая батарея на каком велосипеде, у какого клиента и что свободно</div></div><button className="btn" onClick={load} disabled={loading}>↻</button></div>
      <div className="row" style={{marginTop:12,flexWrap:"wrap"}}>{FILTERS.map(([v,l])=><button key={v} className={`btn ${filter===v?"primary":""}`} onClick={()=>setFilter(v)}>{l}</button>)}<input className="input" style={{minWidth:220,flex:1}} placeholder="бат # / вел # / клиент / модель" value={q} onChange={e=>setQ(e.target.value)}/></div>
    </div>
    <div className="card wide"><div className="battery-map-v22">
      {byBike.map(([key,items])=>{const first=items[0]; const free=key==="free"; return <div className={`battery-bike-v22 ${free?"free":""}`} key={key}>
        <div className="battery-head-v22"><div><b>{free?"🟢 Свободные / без велика":`🚲 ${first.bike_label||`#${key}`}`}</b>{!free&&<div className="small muted">{first.client_name||"без клиента"}</div>}</div><span className="pill">{items.length} бат.</span></div>
        <div className="battery-chips-v22">{items.map((r:any)=>{const problem=Array.isArray(r.warnings)&&r.warnings.length; return <div className={`battery-chip-v22 ${problem?"problem":r.overview_status==="assigned"?"assigned":"free"}`} key={r.battery_id} title={(r.warnings||[]).join("\n")}>
          <b>🔋 #{r.battery_id}</b><span>{[r.brand,r.capacity,r.generation].filter(Boolean).join(" · ")||r.overview_status}</span>{problem?<small>⚠️ {(r.warnings||[]).join(", ")}</small>:<small>{r.overview_status}</small>}
        </div>})}</div>
      </div>})}
      {!visible.length&&<p className="muted">Ничего не найдено.</p>}
    </div></div>
    <style>{`
      .battery-map-v22{display:grid;gap:12px}.battery-bike-v22{border:1px solid rgba(80,190,120,.2);border-radius:17px;padding:13px;background:rgba(3,28,17,.42)}.battery-bike-v22.free{border-style:dashed}.battery-head-v22{display:flex;justify-content:space-between;gap:10px;align-items:center}.battery-chips-v22{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:8px;margin-top:10px}.battery-chip-v22{padding:10px;border-radius:13px;border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:2px}.battery-chip-v22.assigned{background:rgba(38,170,90,.1)}.battery-chip-v22.free{background:rgba(80,140,200,.08)}.battery-chip-v22.problem{background:rgba(220,80,70,.1);border-color:rgba(230,90,80,.3)}.battery-chip-v22 span,.battery-chip-v22 small{opacity:.7;font-size:12px}
    `}</style>
  </div>;
}
