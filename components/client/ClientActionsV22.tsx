"use client";
import { useEffect, useMemo, useState } from "react";

type Props={showToast:(s:string)=>void;reload:()=>Promise<void>};
const TYPES:[string,string][]=[["rent_request","🚲 Хочу арендовать велик"],["battery_request","🔋 Батарея"],["repair_request","🛠 Нужен ремонт"],["replace_request","🔄 Хочу заменить велик"],["return_request","↩️ Хочу вернуть велик"],["accessory_request","📦 Аксессуар / зарядка"],["payment_request","💰 Вопрос по оплате"],["contract_request","📄 Договор / данные"],["other_request","❓ Другое"]];
const SUB:Record<string,[string,string][]>= {
  rent_request:[["new_rental","Новая аренда"]],
  battery_request:[["extra","Нужна дополнительная"],["replacement","Заменить батарею"],["weak","Плохо держит"],["not_charging","Не заряжается"]],
  repair_request:[["brakes","Тормоза"],["wheel_tire","Колесо / камера / покрышка"],["drivetrain","Цепь / кассета / каретка"],["shifting","Переключение"],["fork_frame","Вилка / рама"],["electrics","Электрика"],["motor_controller","Мотор / контроллер"],["battery","Батарея"],["diagnostics","Диагностика"],["other","Другое"]],
  replace_request:[["upgrade","На другой/новее"],["breakdown","Из-за поломки"],["other","Другое"]],return_request:[["normal","Обычный возврат"],["early","Досрочно"]],
  accessory_request:[["charger","Зарядка"],["lock","Замок"],["phone_holder","Держатель телефона"],["gloves","Муфты на руль"],["alarm","Сигнализация"],["gps","GPS"],["other","Другое"]],
  payment_request:[["cash","Наличка"],["debt_question","Вопрос по долгу"],["bank","Банк"],["other","Другое"]],contract_request:[["data_change","Изменить данные"],["document","Документ"],["schedule","График/условия"]],other_request:[["other","Другое"]]
};
function initData(){return typeof window==="undefined"?"":(window as any).Telegram?.WebApp?.initData||""}
async function api<T>(url:string,opt:RequestInit={}):Promise<T>{const r=await fetch(url,{...opt,headers:{"Content-Type":"application/json","x-telegram-init-data":initData(),...(opt.headers||{})}});const j=await r.json().catch(()=>({ok:false,error:`HTTP ${r.status}`}));if(!r.ok||!j.ok)throw new Error(typeof j.error==="string"?j.error:j.error?.message||"API error");return j.data}
function money(v:any){return `${Math.round(Number(v||0)).toLocaleString("ru-RU")} Kč`}

export default function ClientActionsV22({showToast,reload}:Props){
  const [me,setMe]=useState<any>(null);const [tokens,setTokens]=useState<any[]>([]);const [requestType,setRequestType]=useState("battery_request");const [subtype,setSubtype]=useState("extra");const [bikeId,setBikeId]=useState("");const [date,setDate]=useState("");const [busy,setBusy]=useState(false);const [cashCode,setCashCode]=useState<any>(null);const [partial,setPartial]=useState<Record<number,string>>({});const [advance,setAdvance]=useState("");
  async function load(){try{const [m,t]=await Promise.all([api<any>("/api/client/me"),api<any[]>("/api/client/cash-tokens")]);setMe(m);setTokens(t)}catch(e:any){showToast(e.message)}}
  useEffect(()=>{load().catch(()=>null)},[]);
  useEffect(()=>{setSubtype((SUB[requestType]||[["other","Другое"]])[0][0])},[requestType]);
  const rentals=me?.active_rentals||[];const debts=(me?.debts||[]).filter((d:any)=>!d.is_excluded&&Number(d.debt_left||0)>0);
  const needsBike=!['rent_request','other_request'].includes(requestType);
  async function makeCode(charge:any,amount:number){if(!Number.isFinite(amount)||amount<=0)return showToast("Сумма должна быть больше 0");setBusy(true);try{const x=await api<any>("/api/client/cash-tokens",{method:"POST",body:JSON.stringify({mode:"charge",charge_id:charge.charge_id,amount})});setCashCode(x);await load()}catch(e:any){showToast(e.message)}finally{setBusy(false)}}
  async function makeAdvance(){const amount=Number(advance);if(!Number.isFinite(amount)||amount<=0)return showToast("Укажи сумму аванса");setBusy(true);try{const x=await api<any>("/api/client/cash-tokens",{method:"POST",body:JSON.stringify({mode:"advance",amount})});setCashCode(x);setAdvance("");await load()}catch(e:any){showToast(e.message)}finally{setBusy(false)}}
  async function makeAllCode(){const allocations=debts.map((d:any)=>({charge_id:d.charge_id,amount:Number(d.debt_left||0)})).filter((x:any)=>x.amount>0);const amount=allocations.reduce((s:number,x:any)=>s+x.amount,0);if(!allocations.length||amount<=0)return;setBusy(true);try{const x=await api<any>("/api/client/cash-tokens",{method:"POST",body:JSON.stringify({mode:"multi",amount,allocations})});setCashCode(x);await load()}catch(e:any){showToast(e.message)}finally{setBusy(false)}}
  async function cancelToken(id:number){setBusy(true);try{await api("/api/client/cash-tokens",{method:"PATCH",body:JSON.stringify({token_id:id})});showToast("Код отменён");if(cashCode?.id===id)setCashCode(null);await load()}catch(e:any){showToast(e.message)}finally{setBusy(false)}}
  async function sendRequest(){if(needsBike&&!bikeId)return showToast("Выбери велосипед");setBusy(true);try{await api("/api/client/requests",{method:"POST",body:JSON.stringify({request_type:requestType,request_subtype:subtype,bike_id:bikeId?Number(bikeId):null,preferred_date:date||null})});showToast("Запрос отправлен админу");setDate("");await Promise.all([load(),reload()])}catch(e:any){showToast(e.message)}finally{setBusy(false)}}

  const openTokens=useMemo(()=>tokens.filter((t:any)=>t.status==="issued"),[tokens]);
  return <div className="grid">
    <div className="card wide"><div className="space"><div><h3>💵 Наличная оплата</h3><div className="small muted">Cash-код нужен именно для передачи наличных. Банковские переводы позже будут подтверждаться через Fio API.</div></div><span className="pill">24 часа</span></div>
      {debts.length>1&&<button className="btn primary" style={{marginTop:12}} disabled={busy} onClick={makeAllCode}>💵 Один cash-код на все открытые начисления · {money(debts.reduce((s:number,d:any)=>s+Number(d.debt_left||0),0))}</button>}
      <div className="list" style={{marginTop:12}}>{debts.map((d:any)=><div className="item" key={d.charge_id}><div className="space"><div><b>{d.category_label||d.charge_type} · {d.bike_label||""}</b><div className="small muted">Осталось {money(d.debt_left)} из {money(d.amount)}</div></div><button className="btn primary" disabled={busy} onClick={()=>makeCode(d,Number(d.debt_left))}>💵 Код на всё</button></div><div className="row" style={{marginTop:8}}><input className="input" type="number" min="1" max={Number(d.debt_left)} placeholder="Оплатить часть" value={partial[d.charge_id]||""} onChange={e=>setPartial(x=>({...x,[d.charge_id]:e.target.value}))}/><button className="btn" disabled={busy||!partial[d.charge_id]} onClick={()=>makeCode(d,Number(partial[d.charge_id]))}>Код на часть</button></div></div>)}</div>
      {!debts.length&&<p className="muted">Открытых начислений нет. Для сервиса/аксессуара сначала отправь структурированную заявку — админ выставит цену. Для денег вперёд можно создать аванс.</p>}
      <div className="row" style={{marginTop:10}}><input className="input" type="number" min="1" placeholder="Аванс / другая наличная оплата" value={advance} onChange={e=>setAdvance(e.target.value)}/><button className="btn" disabled={busy||!advance} onClick={makeAdvance}>Создать cash-код</button></div>
      {cashCode&&<div className="cash-code-v22"><div className="small">Покажи этот код человеку, которому передаёшь наличные</div><b>{String(cashCode.code||"").replace(/(\d{4})(\d{4})/,"$1 $2")}</b><div>{money(cashCode.amount)}</div><div className="small muted">Создание кода НЕ является оплатой. Оплата появится только после «Получил наличные» у админа.</div><button className="btn" onClick={()=>cancelToken(Number(cashCode.id))}>Отменить код</button></div>}
      {!!openTokens.length&&!cashCode&&<div className="small muted" style={{marginTop:8}}>Есть активные cash-коды: {openTokens.map((t:any)=>`••••${t.token_last4}`).join(", ")}. Полный код хранится только у тебя в момент создания; если потерял — отмени и создай новый.</div>}
    </div>

    <div className="card wide"><h3>📝 Новый запрос</h3><p className="small muted">Без свободного комментария: выбери категорию, подтип, свой велосипед и дату. Так админ сразу получает структурированную заявку.</p><div className="formgrid">
      <label>Что нужно<select className="select" value={requestType} onChange={e=>setRequestType(e.target.value)}>{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Тип<select className="select" value={subtype} onChange={e=>setSubtype(e.target.value)}>{(SUB[requestType]||SUB.other_request).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {needsBike&&<label>Велосипед<select className="select" value={bikeId} onChange={e=>setBikeId(e.target.value)}><option value="">Выбери</option>{rentals.map((r:any)=><option key={r.id} value={r.bike_id}>{r.bike_label||`#${r.bike_id}`}</option>)}</select></label>}
      <label>Желаемая дата<input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    </div><button className="btn primary" disabled={busy} onClick={sendRequest}>Отправить запрос</button></div>
    <style>{`.cash-code-v22{margin-top:12px;padding:16px;border:1px solid rgba(50,210,110,.35);border-radius:18px;text-align:center;background:rgba(28,160,80,.1);display:grid;gap:7px}.cash-code-v22>b{font-size:31px;letter-spacing:5px}`}</style>
  </div>
}
