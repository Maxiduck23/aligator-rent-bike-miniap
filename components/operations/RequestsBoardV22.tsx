"use client";
import { useEffect, useMemo, useState } from "react";

type Props={showToast:(s:string)=>void};
const TYPES:[string,string][]=[
  ["all","Все"],["rent_request","🚲 Аренда"],["battery_request","🔋 Батарея"],["repair_request","🛠 Ремонт"],["replace_request","🔄 Замена велика"],["return_request","↩️ Возврат"],["accessory_request","📦 Аксессуар"],["payment_request","💰 Оплата"],["contract_request","📄 Договор"],["other_request","❓ Другое"]
];
const STATUS:[string,string][]=[["open","Открытые"],["new","Новые"],["in_progress","В работе"],["approved","Одобрено"],["rejected","Отклонено"],["closed","Закрыто"],["all","Все"]];
const SUBTYPES:Record<string,[string,string][]>= {
  rent_request:[["new_rental","Новая аренда"],["other","Другое"]],
  battery_request:[["extra","Дополнительная"],["replacement","Замена"],["weak","Плохо держит"],["not_charging","Не заряжается"],["other","Другое"]],
  repair_request:[["brakes","Тормоза"],["wheel_tire","Колесо / камера / покрышка"],["drivetrain","Цепь / кассета / каретка"],["shifting","Переключение"],["fork_frame","Вилка / рама / рулевая"],["electrics","Электрика / проводка"],["motor_controller","Мотор / контроллер"],["battery","Батарея"],["diagnostics","Диагностика"],["other","Другое"]],
  replace_request:[["upgrade","На другой/новее"],["breakdown","Из-за поломки"],["other","Другое"]],
  return_request:[["normal","Обычный возврат"],["early","Досрочный возврат"],["other","Другое"]],
  accessory_request:[["charger","Зарядка"],["lock","Замок"],["phone_holder","Держатель телефона"],["gloves","Муфты/перчатки на руль"],["alarm","Сигнализация"],["gps","GPS"],["other","Другое"]],
  payment_request:[["cash","Наличка"],["debt_question","Вопрос по долгу"],["bank","Банк"],["other","Другое"]],
  contract_request:[["data_change","Изменить данные"],["document","Документ/договор"],["schedule","График/условия"],["other","Другое"]],
  other_request:[["other","Другое"]],
};
function initData(){return typeof window==="undefined"?"":(window as any).Telegram?.WebApp?.initData||""}
async function api<T>(url:string,opt:RequestInit={}):Promise<T>{const r=await fetch(url,{...opt,headers:{"Content-Type":"application/json","x-telegram-init-data":initData(),...(opt.headers||{})}});const j=await r.json().catch(()=>({ok:false,error:`HTTP ${r.status}`}));if(!r.ok||!j.ok)throw new Error(typeof j.error==="string"?j.error:j.error?.message||"API error");return j.data}
function money(v:any){return `${Math.round(Number(v||0)).toLocaleString("ru-RU")} Kč`}
function typeLabel(v:string){return TYPES.find(x=>x[0]===v)?.[1]||v}
function subtypeLabel(type:string,v:string){return SUBTYPES[type]?.find(x=>x[0]===v)?.[1]||v||"без подтипа"}

export default function RequestsBoardV22({showToast}:Props){
  const [rows,setRows]=useState<any[]>([]);const [status,setStatus]=useState("open");const [type,setType]=useState("all");const [busy,setBusy]=useState<number|null>(null);
  async function load(){try{setRows(await api<any[]>(`/api/admin/operations/requests?status=${encodeURIComponent(status)}&type=${encodeURIComponent(type)}`))}catch(e:any){showToast(e.message)}}
  useEffect(()=>{load().catch(()=>null)},[status,type]);
  async function update(id:number,patch:any){setBusy(id);try{await api("/api/admin/operations/requests",{method:"POST",body:JSON.stringify({request_id:id,action:"update",...patch})});await load()}catch(e:any){showToast(e.message)}finally{setBusy(null)}}
  async function createCharge(r:any){const raw=prompt("Сумма начисления, Kč",String(r.quoted_amount||""));if(raw===null)return;const amount=Number(raw.replace?.(",",".")??raw);if(!Number.isFinite(amount)||amount<=0)return showToast("Некорректная сумма");setBusy(r.id);try{const x:any=await api("/api/admin/operations/requests",{method:"POST",body:JSON.stringify({request_id:r.id,action:"create_charge",amount})});showToast(`Начисление #${x.charge.id} создано на ${money(amount)}`);await load()}catch(e:any){showToast(e.message)}finally{setBusy(null)}}
  const counts=useMemo(()=>rows.reduce((a:any,r:any)=>{a[r.request_type]=(a[r.request_type]||0)+1;return a},{}),[rows]);
  return <div className="grid">
    <div className="card wide"><div className="space"><div><h2>📝 Заявки клиентов</h2><div className="small muted">Категория ≠ статус. Сначала классифицируй, потом веди по процессу.</div></div><button className="btn" onClick={load}>↻</button></div>
      <div className="request-filter-v22">{TYPES.map(([v,l])=><button key={v} className={`btn ${type===v?"primary":""}`} onClick={()=>setType(v)}>{l}{v!=="all"&&counts[v]?` · ${counts[v]}`:""}</button>)}</div>
      <div className="row" style={{marginTop:8,flexWrap:"wrap"}}>{STATUS.map(([v,l])=><button key={v} className={`btn ${status===v?"primary":""}`} onClick={()=>setStatus(v)}>{l}</button>)}</div>
    </div>
    <div className="card wide"><div className="request-board-v22">{rows.map(r=><div className={`request-card-v22 p-${r.priority||"normal"}`} key={r.id}>
      <div className="space"><div><b>#{r.id} · {typeLabel(r.request_type)}</b><div className="small muted">{r.client?.name||`client #${r.client_id}`} {r.bike_id?`· вел #${r.bike_id}`:""} · {new Date(r.created_at).toLocaleString()}</div></div><span className={`pill ${r.status==="new"?"warn":r.status==="approved"||r.status==="closed"?"ok":r.status==="rejected"?"danger":""}`}>{r.status}</span></div>
      <div className="request-meta-v22"><span>Подтип: <b>{subtypeLabel(r.request_type,r.request_subtype)}</b></span>{r.preferred_date&&<span>Дата: <b>{r.preferred_date}</b></span>}{r.quoted_amount&&<span>Цена: <b>{money(r.quoted_amount)}</b></span>}{r.resolved_charge_id&&<span>Начисление: <b>#{r.resolved_charge_id}</b></span>}</div>
      <div className="formgrid" style={{marginTop:10}}>
        <label>Категория<select className="select" value={r.request_type||"other_request"} onChange={e=>update(r.id,{request_type:e.target.value,request_subtype:null})}>{TYPES.filter(x=>x[0]!=="all").map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
        <label>Подтип<select className="select" value={r.request_subtype||""} onChange={e=>update(r.id,{request_subtype:e.target.value||null})}><option value="">—</option>{(SUBTYPES[r.request_type]||SUBTYPES.other_request).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
        <label>Приоритет<select className="select" value={r.priority||"normal"} onChange={e=>update(r.id,{priority:e.target.value})}><option value="low">низкий</option><option value="normal">обычный</option><option value="high">высокий</option><option value="urgent">срочно</option></select></label>
        <label>Статус<select className="select" value={r.status||"new"} onChange={e=>update(r.id,{status:e.target.value})}>{STATUS.filter(x=>!['open','all'].includes(x[0])).map(([v,l])=><option value={v} key={v}>{l}</option>)}</select></label>
      </div>
      <div className="row" style={{marginTop:10,flexWrap:"wrap"}}><button className="btn" disabled={busy===r.id} onClick={()=>update(r.id,{status:"in_progress",assign_to_me:true})}>👤 Взять в работу</button>{['repair_request','battery_request','accessory_request','payment_request','contract_request','other_request'].includes(r.request_type)&&!r.resolved_charge_id&&<button className="btn primary" disabled={busy===r.id} onClick={()=>createCharge(r)}>💰 Выставить начисление</button>}<button className="btn" disabled={busy===r.id} onClick={()=>update(r.id,{status:"closed"})}>✓ Закрыть</button></div>
    </div>)}{!rows.length&&<p className="muted">Заявок по фильтру нет.</p>}</div></div>
    <style>{`.request-filter-v22{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.request-board-v22{display:grid;gap:11px}.request-card-v22{border:1px solid rgba(255,255,255,.09);border-left:4px solid rgba(120,180,145,.45);border-radius:16px;padding:13px;background:rgba(4,28,18,.45)}.request-card-v22.p-high{border-left-color:#e3a333}.request-card-v22.p-urgent{border-left-color:#e35c5c}.request-meta-v22{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;opacity:.75;margin-top:7px}`}</style>
  </div>
}
