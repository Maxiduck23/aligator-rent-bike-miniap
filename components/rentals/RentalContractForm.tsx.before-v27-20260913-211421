"use client";

import { useEffect, useState } from "react";

type Props = {
  bike: any;
  active: any;
  showToast: (text: string) => void;
  reload: () => Promise<void>;
  workerMode?: boolean;
};
type BatteryMode = "existing" | "create" | "temporary";
type BatterySlot = { mode: BatteryMode; battery_id?: number; type_id?: number; note?: string };
type OptionsPayload = { clients: any[]; battery_types: any[]; available_batteries: any[] };

function tgInitData() {
  return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || "";
}
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": tgInitData(),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) {
    const e = json?.error;
    throw new Error(typeof e === "string" ? e : e?.message || e?.details || "API error");
  }
  return json.data as T;
}
function localToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
function money(v: unknown) { return `${Math.round(Number(v || 0))} Kč`; }
function typeLabel(t: any) { return [t.brand || `Тип #${t.id}`, t.capacity, t.generation].filter(Boolean).join(" · "); }
function batteryLabel(b: any) { return `${b.inventory_code || `BAT #${b.id}`}${b.indexing_status === "temporary" ? " · временная" : ""}`; }

export default function RentalContractForm({ bike, active, showToast, reload, workerMode = false }: Props) {
  const [options, setOptions] = useState<OptionsPayload>({ clients: [], battery_types: [], available_batteries: [] });
  const [equipment, setEquipment] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // New contract: exact amount is always entered explicitly. Plan is only an internal DB template.
  const [clientId, setClientId] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("6000");
  const [deposit, setDeposit] = useState("1500");
  const [startDate, setStartDate] = useState(localToday());
  const [chargerQuantity, setChargerQuantity] = useState(2);
  const [slots, setSlots] = useState<BatterySlot[]>([]);
  const [notes, setNotes] = useState("");

  // Active edit.
  const [editing, setEditing] = useState(false);
  const [editRecurring, setEditRecurring] = useState("");
  const [editDeposit, setEditDeposit] = useState("");
  const [editChargers, setEditChargers] = useState("");
  const [editNotes, setEditNotes] = useState("");

  // Bike transfer.
  const [newBikeId, setNewBikeId] = useState("");
  const [keepBatteries, setKeepBatteries] = useState(true);

  // Battery replacement/add.
  const [extraSlot, setExtraSlot] = useState<BatterySlot>({ mode: "temporary" });
  const [extraChargeNow, setExtraChargeNow] = useState(false);

  // Admin-only close.
  const [closeStatus, setCloseStatus] = useState("free");

  function defaultSlot(index: number, opts: OptionsPayload): BatterySlot {
    const b = opts.available_batteries[index];
    if (b) return { mode: "existing", battery_id: Number(b.id) };
    return { mode: "temporary", type_id: opts.battery_types[0]?.id };
  }

  async function load() {
    setLoading(true);
    try {
      const o = await request<OptionsPayload>(`/api/admin/rental-contracts/options?bike_id=${encodeURIComponent(bike.id)}`);
      setOptions(o);
      if (!active && slots.length === 0) {
        setSlots([defaultSlot(0, o), defaultSlot(1, o)]);
      }
      if (o.battery_types[0] && !extraSlot.type_id && !extraSlot.battery_id) {
        setExtraSlot({ mode: "temporary", type_id: o.battery_types[0].id });
      }
      if (active?.id) {
        setEquipment(await request<any[]>(`/api/admin/rental-contracts/equipment?rental_id=${active.id}`));
      } else {
        setEquipment([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch((e) => showToast(e.message)); }, [bike.id, active?.id]);
  useEffect(() => {
    if (!active) return;
    setEditRecurring(String(active.recurring_rent ?? active.price ?? ""));
    setEditDeposit(String(active.deposit ?? 0));
    setEditChargers(String(active.charger_quantity ?? 1));
    setEditNotes(String(active.notes || ""));
  }, [active?.id]);

  function updateSlot(i: number, patch: Partial<BatterySlot>) {
    setSlots((x) => x.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }
  function validateSlot(s: BatterySlot, label: string) {
    if (s.mode === "existing" && !s.battery_id) throw new Error(`${label}: выбери батарею`);
    if (s.mode !== "existing" && !s.type_id) throw new Error(`${label}: выбери тип батареи`);
  }

  async function createContract() {
    try {
      const amount = Number(monthlyRent);
      const dep = Number(deposit || 0);
      if (!clientId) throw new Error("Выбери клиента");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Сумма аренды / месяц должна быть больше 0");
      if (!Number.isFinite(dep) || dep < 0) throw new Error("Залог должен быть 0 или больше");
      if (slots.length < 1 || slots.length > 10) throw new Error("Укажи от 1 до 10 батарей");
      const existingIds = slots.filter((s) => s.mode === "existing").map((s) => Number(s.battery_id));
      if (new Set(existingIds).size !== existingIds.length) throw new Error("Одна батарея выбрана несколько раз");
      slots.forEach((s, i) => validateSlot(s, `Батарея ${i + 1}`));

      setBusy(true);
      const result = await request<any>("/api/admin/rental-contracts", {
        method: "POST",
        body: JSON.stringify({
          contract_mode: "manual_v26",
          bike_id: Number(bike.id),
          client_id: Number(clientId),
          monthly_rent: amount,
          deposit: dep,
          start_date: startDate,
          batteries: slots,
          charger_quantity: Number(chargerQuantity),
          notes: notes || null,
        }),
      });
      showToast(`Договор #${result?.rental?.id || "создан"} · ${money(amount)}/мес. Оплата НЕ создавалась.`);
      await reload();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!active?.id) return;
    const recurring = Number(editRecurring);
    if (!Number.isFinite(recurring) || recurring <= 0) return showToast("Цена / месяц должна быть больше 0");
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/edit", {
        method: "POST",
        body: JSON.stringify({
          rental_id: active.id,
          client_id: Number(active.client_id),
          recurring_rent: recurring,
          deposit: workerMode ? null : Number(editDeposit || 0),
          charger_quantity: Number(editChargers || 0),
          billable_extra_batteries: null,
          notes: editNotes || null,
          move_financial_history: false,
        }),
      });
      showToast("Условия договора изменены. Платёж не создавался.");
      setEditing(false);
      await reload();
      await load();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function transferBike() {
    if (!active?.id || !Number(newBikeId)) return showToast("Укажи новый bike ID");
    if (!confirm(`Пересадить rental #${active.id} с bike #${bike.id} на bike #${newBikeId}? Клиент, оплаты и текущий месяц сохранятся.`)) return;
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/transfer", {
        method: "POST",
        body: JSON.stringify({
          rental_id: active.id,
          new_bike_id: Number(newBikeId),
          keep_current_batteries: keepBatteries,
          notes: workerMode ? "worker transfer v26" : "admin transfer v26",
        }),
      });
      showToast(`Клиент пересажен на bike #${newBikeId} без нового платежа/начисления`);
      setNewBikeId("");
      await reload();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeBattery(id: number) {
    if (!active?.id) return;
    if (!confirm(`Убрать батарею #${id} из active договора? Денежная операция не создаётся.`)) return;
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/equipment", {
        method: "DELETE",
        body: JSON.stringify({ rental_id: active.id, battery_id: id, notes: workerMode ? "worker battery replace v26" : "admin battery replace v26" }),
      });
      showToast(`Батарея #${id} снята с договора`);
      await load();
      await reload();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addBattery() {
    if (!active?.id) return;
    try {
      validateSlot(extraSlot, "Новая батарея");
      setBusy(true);
      await request("/api/admin/rental-contracts/add-battery", {
        method: "POST",
        body: JSON.stringify({
          rental_id: active.id,
          battery: extraSlot,
          effective_date: localToday(),
          charge_now: workerMode ? false : extraChargeNow,
        }),
      });
      showToast(!workerMode && extraChargeNow ? "Батарея добавлена и создано начисление" : "Батарея добавлена без начисления");
      await load();
      await reload();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function closeContract() {
    const refundRaw = prompt(`Сколько депозита реально вернули? Договор: ${money(active?.deposit)}`, "0");
    if (refundRaw === null) return;
    const refund = Number(refundRaw.replace(",", "."));
    if (!Number.isFinite(refund) || refund < 0) return showToast("Некорректная сумма");
    try {
      setBusy(true);
      await request("/api/admin/rentals/close", {
        method: "POST",
        body: JSON.stringify({ bike_id: bike.id, end_date: localToday(), bike_status: closeStatus, deposit_refund: refund, notes: "closed from contract v26" }),
      });
      showToast("Договор закрыт");
      await reload();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  function BatterySlotEditor({ slot, index, onChange }: { slot: BatterySlot; index?: number; onChange: (p: Partial<BatterySlot>) => void }) {
    return <div className="item">
      <div className="space"><b>{index == null ? "Новая батарея" : `Батарея ${index + 1}`}</b><span className="pill">{slot.mode}</span></div>
      <select className="select" value={slot.mode} onChange={(e) => onChange({ mode: e.target.value as BatteryMode, battery_id: undefined, type_id: options.battery_types[0]?.id })}>
        <option value="existing">из базы</option>
        <option value="temporary">временная / не проиндексирована</option>
        <option value="create">создать индексированную</option>
      </select>
      {slot.mode === "existing" ?
        <select className="select" value={slot.battery_id || ""} onChange={(e) => onChange({ battery_id: Number(e.target.value) })}>
          <option value="">выбери батарею</option>
          {options.available_batteries.map((b) => <option key={b.id} value={b.id}>{batteryLabel(b)}</option>)}
        </select>
      :
        <select className="select" value={slot.type_id || ""} onChange={(e) => onChange({ type_id: Number(e.target.value) })}>
          <option value="">выбери тип</option>
          {options.battery_types.map((t) => <option key={t.id} value={t.id}>{typeLabel(t)}</option>)}
        </select>}
    </div>;
  }

  if (loading) return <div className="card">Загрузка договора...</div>;

  if (!active) return <div className="card">
    <h3>📄 Новый договор</h3>
    <div className="notice"><b>Цена вводится вручную.</b> Тариф больше не выбирается в интерфейсе. Залог — отдельное одноразовое начисление. Создание договора не создаёт client_payment.</div>
    <div className="formgrid">
      <label>Клиент<select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">выбери</option>{options.clients.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.name}</option>)}</select></label>
      <label>Сумма аренды / месяц, Kč<input className="input" type="number" min={1} value={monthlyRent} onChange={(e) => setMonthlyRent(e.target.value)} placeholder="6000 / 8000 / 10500" /></label>
      <label>Залог разово, Kč<input className="input" type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
      <label>Дата начала<input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
      <label>Зарядки<input className="input" type="number" min={0} max={10} value={chargerQuantity} onChange={(e) => setChargerQuantity(Number(e.target.value))} /></label>
    </div>
    <div className="space" style={{ marginTop: 12 }}><h4>Фактически выданные батареи ({slots.length})</h4><button className="btn" disabled={slots.length >= 10} onClick={() => setSlots((x) => [...x, defaultSlot(x.length, options)])}>+ батарея</button></div>
    <div className="list">{slots.map((s, i) => <div key={i}><BatterySlotEditor slot={s} index={i} onChange={(p) => updateSlot(i, p)} /><button className="btn danger" style={{ marginTop: 4 }} onClick={() => setSlots((x) => x.filter((_, idx) => idx !== i))}>Убрать слот</button></div>)}</div>
    <label>Заметка<textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    <button className="btn primary" disabled={busy || !clientId || !monthlyRent} onClick={createContract}>{busy ? "Создаю..." : `Создать договор · ${money(monthlyRent)}/мес`}</button>
  </div>;

  return <div className="card">
    <div className="space"><h3>📄 Active договор #{active.id}</h3><span className="pill ok">индивидуальный</span></div>
    <div className="kv">
      <div>Клиент</div><div>#{active.client_id} {active.client_name || ""}</div>
      <div>Велик</div><div>#{bike.id} {bike.model || ""}</div>
      <div>Аренда / месяц</div><div><b>{money(active.recurring_rent ?? active.price)}</b></div>
      <div>Залог разово</div><div>{money(active.deposit)}</div>
      <div>Зарядки</div><div>{active.charger_quantity ?? "-"}</div>
      <div>Фактически батарей</div><div><b>{equipment.length}</b></div>
    </div>

    <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => setEditing(!editing)}>✏️ Изменить условия</button></div>
    {editing && <div className="item" style={{ marginTop: 10 }}>
      <div className="formgrid">
        <label>Клиент<input className="input" value={`#${active.client_id} ${active.client_name || ""}`} readOnly /></label>
        <label>Цена / месяц<input className="input" type="number" min={1} value={editRecurring} onChange={(e) => setEditRecurring(e.target.value)} /></label>
        {!workerMode && <label>Залог<input className="input" type="number" min={0} value={editDeposit} onChange={(e) => setEditDeposit(e.target.value)} /></label>}
        <label>Зарядки<input className="input" type="number" min={0} max={10} value={editChargers} onChange={(e) => setEditChargers(e.target.value)} /></label>
      </div>
      {workerMode && <p className="small muted">Работник может менять месячную сумму договора, но не депозит и не историю платежей.</p>}
      <label>Заметка<textarea className="textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></label>
      <button className="btn primary" disabled={busy} onClick={saveEdit}>Сохранить без создания оплаты</button>
    </div>}

    <hr className="hr" />
    <h4>🔄 Пересадка клиента на другой велик</h4>
    <p className="small muted">Меняется bike_id внутри этого же rental. Клиент, оплаты, долг и текущий период сохраняются.</p>
    <div className="row"><input className="input" style={{ maxWidth: 180 }} inputMode="numeric" placeholder="новый bike ID" value={newBikeId} onChange={(e) => setNewBikeId(e.target.value.replace(/\D/g, ""))} /><label className="row small"><input type="checkbox" checked={keepBatteries} onChange={(e) => setKeepBatteries(e.target.checked)} /> оставить текущие батареи</label><button className="btn warn" disabled={busy || !newBikeId} onClick={transferBike}>Пересадить</button></div>

    <hr className="hr" />
    <h4>🔋 Замена / комплектация батарей</h4>
    <div className="list">{equipment.map((r: any) => { const b = r.batteries || {}; return <div className="item" key={r.id}><div className="space"><b>{b.inventory_code || `battery #${r.battery_id}`}</b><button className="btn danger" disabled={busy} onClick={() => removeBattery(r.battery_id)}>Убрать</button></div><div className="small muted">DB #{r.battery_id} · {b.indexing_status || "-"}</div></div>; })}{!equipment.length && <p className="muted">Нет active battery_rentals.</p>}</div>
    <BatterySlotEditor slot={extraSlot} onChange={(p) => setExtraSlot((s) => ({ ...s, ...p }))} />
    {!workerMode && <label className="row small"><input type="checkbox" checked={extraChargeNow} onChange={(e) => setExtraChargeNow(e.target.checked)} /> создать начисление за доп. батарею сейчас</label>}
    {workerMode && <p className="small muted">Работник меняет физическую батарею без автоматического денежного начисления.</p>}
    <button className="btn" disabled={busy} onClick={addBattery}>➕ Добавить батарею</button>

    {!workerMode && <><hr className="hr" /><div className="row"><select className="select" style={{ maxWidth: 180 }} value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)}><option value="free">free</option><option value="repair">repair</option><option value="waiting">waiting</option><option value="sold">sold</option></select><button className="btn danger" disabled={busy} onClick={closeContract}>Закрыть договор</button></div></>}
    <p className="small muted">Договор и реальные деньги разделены. Изменение договора само по себе не создаёт оплату.</p>
  </div>;
}
