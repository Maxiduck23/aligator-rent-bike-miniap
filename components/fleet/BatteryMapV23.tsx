"use client";

import { useEffect, useMemo, useState } from "react";
import { roleTestHeaders } from "@/lib/clientRoleTest";

type Props = { showToast: (text: string) => void; onOpenBike?: (bikeId: number) => void };
function initData(){ return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || ""; }
async function get<T>(url:string):Promise<T>{
  const r=await fetch(url,{headers:{"x-telegram-init-data":initData(),...roleTestHeaders()}});
  const j=await r.json().catch(()=>({ok:false,error:`HTTP ${r.status}`}));
  if(!r.ok||!j.ok) throw new Error(typeof j.error==="string"?j.error:j.error?.message||j.error?.details||"API error");
  return j.data;
}
function arr(v:any){return Array.isArray(v)?v:[]}

const FILTERS = [["all","Все"],["assigned","На великах"],["free","Свободные"],["problem","Проблемные"]] as const;

export default function BatteryMapV23({showToast,onOpenBike}:Props){
  const [rows,setRows]=useState<any[]>([]);
  const [filter,setFilter]=useState("all");
  const [q,setQ]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");

  async function load(){
    setLoading(true); setError("");
    try{setRows(await get<any[]>("/api/admin/operations/batteries"));}
    catch(e:any){const msg=e?.message||"Не удалось загрузить батареи";setError(msg);showToast(msg);}
    finally{setLoading(false)}
  }
  useEffect(()=>{load().catch(()=>null)},[]);

  const totals=useMemo(()=>({
    total:rows.length,
    assigned:rows.filter(r=>r.overview_status==="assigned").length,
    free:rows.filter(r=>["free","legacy_link"].includes(r.overview_status)).length,
    problem:rows.filter(r=>arr(r.warnings).length>0).length,
  }),[rows]);

  const visible=useMemo(()=>rows.filter((r:any)=>{
    const problem=arr(r.warnings).length>0;
    if(filter==="assigned"&&r.overview_status!=="assigned")return false;
    if(filter==="free"&&!["free","legacy_link"].includes(r.overview_status))return false;
    if(filter==="problem"&&!problem)return false;
    const hay=[r.battery_id,r.effective_bike_id,r.bike_label,r.client_name,r.brand,r.capacity,r.generation,r.overview_status].filter(Boolean).join(" ").toLowerCase();
    return !q.trim()||hay.includes(q.trim().toLowerCase().replace(/^#/,""));
  }),[rows,filter,q]);

  const byBike=useMemo(()=>{
    const m=new Map<string,any[]>();
    for(const r of visible){const key=r.effective_bike_id?String(r.effective_bike_id):"free";if(!m.has(key))m.set(key,[]);m.get(key)!.push(r)}
    return [...m.entries()].sort((a,b)=>a[0]==="free"?1:b[0]==="free"?-1:Number(a[0])-Number(b[0]));
  },[visible]);

  return <div className="grid">
    <div className="card wide">
      <div className="space"><div><h2>🔋 Батареи</h2><div className="small muted">Источник назначения — active battery_rentals. Раздел доступен администратору и работнику.</div></div><button className="btn" onClick={load} disabled={loading}>{loading?"...":"↻"}</button></div>
      {error&&<div className="item critical" style={{marginTop:10}}><b>Не удалось загрузить батареи</b><div className="dangerText small">{error}</div><button className="btn" onClick={load} style={{marginTop:8}}>Повторить</button></div>}
      <div className="v27-bat-kpis"><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}><span>Всего</span><b>{totals.total}</b></button><button className={filter==="assigned"?"active":""} onClick={()=>setFilter("assigned")}><span>На великах</span><b>{totals.assigned}</b></button><button className={filter==="free"?"active":""} onClick={()=>setFilter("free")}><span>Свободно</span><b>{totals.free}</b></button><button className={filter==="problem"?"active":""} onClick={()=>setFilter("problem")}><span>Проблемы</span><b>{totals.problem}</b></button></div>
      <div className="row" style={{marginTop:12,flexWrap:"wrap"}}>{FILTERS.map(([v,l])=><button key={v} className={`btn ${filter===v?"primary":""}`} onClick={()=>setFilter(v)}>{l}</button>)}<input className="input" style={{minWidth:220,flex:1}} placeholder="бат # / вел # / клиент / модель" value={q} onChange={e=>setQ(e.target.value)}/></div>
    </div>
    <div className="card wide"><div className="battery-map-v27">
      {byBike.map(([key,items])=>{const first=items[0];const free=key==="free";return <div className={`battery-bike-v27 ${free?"free":""}`} key={key}>
        <div className="battery-head-v27"><div><b>{free?"🟢 Свободные / без велика":`🚲 ${first.bike_label||`#${key}`}`}</b>{!free&&<div className="small muted">{first.client_name||"без клиента"}</div>}</div><div className="row"><span className="pill">{items.length} бат.</span>{!free&&onOpenBike&&<button className="btn" onClick={()=>onOpenBike(Number(key))}>Открыть велик</button>}</div></div>
        <div className="battery-chips-v27">{items.map((r:any)=>{const problem=arr(r.warnings).length>0;return <div className={`battery-chip-v27 ${problem?"problem":r.overview_status==="assigned"?"assigned":"free"}`} key={r.battery_id} title={arr(r.warnings).join("\n")}>
          <div className="space"><b>🔋 #{r.battery_id}</b><span className="pill">{r.overview_status}</span></div><span>{[r.brand,r.capacity,r.generation].filter(Boolean).join(" · ")||"тип не указан"}</span>{r.rental_id&&<small>rental #{r.rental_id}</small>}{problem?<small className="dangerText">⚠️ {arr(r.warnings).join(", ")}</small>:<small className="okText">✓ assignment OK</small>}
        </div>})}</div>
      </div>})}
      {!loading&&!error&&!visible.length&&<p className="muted">Батарей по фильтру нет.</p>}
    </div></div>
    <style>{`
      .v27-bat-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.v27-bat-kpis button{border:1px solid rgba(100,200,140,.16);background:rgba(5,30,20,.45);border-radius:13px;padding:10px;text-align:left;color:inherit;display:flex;flex-direction:column}.v27-bat-kpis button.active{box-shadow:inset 0 0 0 1px rgba(60,220,120,.45)}.v27-bat-kpis span{font-size:12px;opacity:.7}.v27-bat-kpis b{font-size:20px}
      .battery-map-v27{display:grid;gap:12px}.battery-bike-v27{border:1px solid rgba(80,190,120,.2);border-radius:17px;padding:13px;background:rgba(3,28,17,.42)}.battery-bike-v27.free{border-style:dashed}.battery-head-v27{display:flex;justify-content:space-between;gap:10px;align-items:center}.battery-chips-v27{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:8px;margin-top:10px}.battery-chip-v27{padding:10px;border-radius:13px;border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;gap:4px}.battery-chip-v27.assigned{background:rgba(38,170,90,.1)}.battery-chip-v27.free{background:rgba(80,140,200,.08)}.battery-chip-v27.problem{background:rgba(220,80,70,.1);border-color:rgba(230,90,80,.3)}.battery-chip-v27 span,.battery-chip-v27 small{font-size:12px}.battery-chip-v27>span{opacity:.75}@media(max-width:700px){.v27-bat-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.battery-head-v27{align-items:flex-start;flex-direction:column}}
    `}</style>
  </div>;
}
