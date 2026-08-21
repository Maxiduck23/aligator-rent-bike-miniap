"use client";

import { useEffect, useState } from "react";

type Props = { bike: any; active: any; showToast: (text: string) => void; reload: () => Promise<void> };
type BatteryMode = "existing" | "create" | "temporary";
type BatterySlot = { mode: BatteryMode; battery_id?: number; type_id?: number; note?: string };
type Plan = any;
type OptionsPayload = { clients: any[]; battery_types: any[]; available_batteries: any[] };

function tgInitData() { if (typeof window === "undefined") return ""; return (window as any).Telegram?.WebApp?.initData || ""; }
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", "x-telegram-init-data": tgInitData(), ...(options.headers || {}) } });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) { const e = json?.error; throw new Error(typeof e === "string" ? e : e?.message || e?.details || "API error"); }
  return json.data as T;
}
function localToday() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function money(v: unknown) { return `${Math.round(Number(v || 0))} Kč`; }
function typeLabel(t: any) { return [t.brand || `Тип #${t.id}`, t.capacity, t.generation].filter(Boolean).join(" · "); }
function batteryLabel(b: any) { return `${b.inventory_code || `BAT #${b.id}`}${b.indexing_status === "temporary" ? " · временная" : ""}`; }
function modelValue(plan: any, key: string) { const o = plan?.model_price_override; return Number(o?.[key] ?? plan?.[key] ?? 0); }

export default function RentalContractForm({ bike, active, showToast, reload }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [options, setOptions] = useState<OptionsPayload>({ clients: [], battery_types: [], available_batteries: [] });
  const [equipment, setEquipment] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // New contract
  const [clientId, setClientId] = useState("");
  const [planCode, setPlanCode] = useState("monthly_2_batteries");
  const [startDate, setStartDate] = useState(localToday());
  const [extraCount, setExtraCount] = useState(0);
  const [chargerQuantity, setChargerQuantity] = useState(2);
  const [slots, setSlots] = useState<BatterySlot[]>([]);
  const [customize, setCustomize] = useState(false);
  const [customRecurring, setCustomRecurring] = useState("");
  const [customDeposit, setCustomDeposit] = useState("");
  const [customFirst, setCustomFirst] = useState("");
  const [notes, setNotes] = useState("");

  // Active edit
  const [editing, setEditing] = useState(false);
  const [editClient, setEditClient] = useState("");
  const [editRecurring, setEditRecurring] = useState("");
  const [editDeposit, setEditDeposit] = useState("");
  const [editChargers, setEditChargers] = useState("");
  const [editBillableExtra, setEditBillableExtra] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [moveHistory, setMoveHistory] = useState(false);
  const [newBikeId, setNewBikeId] = useState("");
  const [keepBatteries, setKeepBatteries] = useState(true);
  const [closeStatus, setCloseStatus] = useState("free");

  // Add battery
  const [extraSlot, setExtraSlot] = useState<BatterySlot>({ mode: "temporary" });
  const [extraChargeNow, setExtraChargeNow] = useState(false);

  const selectedPlan = plans.find((p) => p.code === planCode) || plans[0] || null;
  const included = Number(selectedPlan?.included_batteries ?? 0);
  const requiredBatteries = included + Number(extraCount || 0);

  function distinctDefaults(opts: OptionsPayload, count: number): BatterySlot[] {
    const firstType = opts.battery_types[0];
    return Array.from({ length: count }, (_, i) => {
      const b = opts.available_batteries[i];
      return b ? { mode: "existing", battery_id: b.id } : { mode: "temporary", type_id: firstType?.id };
    });
  }

  async function load() {
    setLoading(true);
    try {
      const [p, o] = await Promise.all([
        request<any[]>(`/api/admin/rental-contracts?bike_id=${encodeURIComponent(bike.id)}`),
        request<OptionsPayload>(`/api/admin/rental-contracts/options?bike_id=${encodeURIComponent(bike.id)}`),
      ]);
      setPlans(p); setOptions(o);
      const def = p.find((x: any) => x.code === planCode) || p.find((x: any) => x.code === "monthly_2_batteries") || p[0];
      if (def) {
        setPlanCode(def.code);
        const inc = Number(def.included_batteries ?? 0);
        setChargerQuantity(Number(def.included_chargers ?? 1));
        setSlots(distinctDefaults(o, inc));
        setCustomRecurring(String(modelValue(def, "recurring_rent")));
        setCustomDeposit(String(modelValue(def, "deposit_amount")));
        setCustomFirst(String(modelValue(def, "first_period_rent")));
      }
      if (o.battery_types[0]) setExtraSlot({ mode: "temporary", type_id: o.battery_types[0].id });
      if (active?.id) setEquipment(await request<any[]>(`/api/admin/rental-contracts/equipment?rental_id=${active.id}`));
      else setEquipment([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { load().catch((e) => showToast(e.message)); }, [bike.id, active?.id]);
  useEffect(() => {
    if (!selectedPlan) return;
    const chargers = Number(selectedPlan.included_chargers ?? 1);
    setChargerQuantity(chargers);
    setSlots((cur) => {
      const next = [...cur];
      const used = new Set(next.filter((s) => s.mode === "existing").map((s) => s.battery_id));
      for (const b of options.available_batteries) {
        if (next.length >= requiredBatteries) break;
        if (!used.has(b.id)) { next.push({ mode: "existing", battery_id: b.id }); used.add(b.id); }
      }
      while (next.length < requiredBatteries) next.push({ mode: "temporary", type_id: options.battery_types[0]?.id });
      return next.slice(0, requiredBatteries);
    });
    if (!customize) {
      setCustomRecurring(String(modelValue(selectedPlan, "recurring_rent")));
      setCustomDeposit(String(modelValue(selectedPlan, "deposit_amount")));
      setCustomFirst(String(modelValue(selectedPlan, "first_period_rent")));
    }
  }, [planCode, extraCount, requiredBatteries]);

  useEffect(() => {
    if (!active) return;
    setEditClient(String(active.client_id || ""));
    setEditRecurring(String(active.recurring_rent ?? active.price ?? ""));
    setEditDeposit(String(active.deposit ?? 0));
    setEditChargers(String(active.charger_quantity ?? 1));
    setEditBillableExtra(String(active.extra_batteries ?? 0));
    setEditNotes(String(active.notes || ""));
  }, [active?.id]);

  function updateSlot(i: number, patch: Partial<BatterySlot>) { setSlots((x) => x.map((s, idx) => idx === i ? { ...s, ...patch } : s)); }
  function validateSlots() {
    if (slots.length !== requiredBatteries) throw new Error(`Нужно ${requiredBatteries} батарей`);
    const ids = slots.filter((s) => s.mode === "existing").map((s) => Number(s.battery_id));
    if (new Set(ids).size !== ids.length) throw new Error("Одна батарея выбрана несколько раз");
    slots.forEach((s, i) => {
      if (s.mode === "existing" && !s.battery_id) throw new Error(`Слот ${i + 1}: выбери батарею`);
      if (s.mode !== "existing" && !s.type_id) throw new Error(`Слот ${i + 1}: выбери тип`);
    });
  }

  async function createContract() {
    if (!clientId || !selectedPlan) return showToast("Выбери клиента и тариф");
    try {
      validateSlots(); setBusy(true);
      const result = await request<any>("/api/admin/rental-contracts", {
        method: "POST",
        body: JSON.stringify({
          bike_id: bike.id, client_id: Number(clientId), plan_code: selectedPlan.code, start_date: startDate,
          batteries: slots, charger_quantity: Number(chargerQuantity), extra_battery_count: Number(extraCount),
          recurring_rent_override: customize ? Number(customRecurring) : null,
          deposit_override: customize ? Number(customDeposit) : null,
          first_period_rent_override: customize ? Number(customFirst) : null,
          notes: notes || null,
        }),
      });
      showToast(`Договор #${result?.rental?.id || "создан"}. Оплата НЕ создавалась.`);
      await reload();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  async function saveEdit() {
    if (!active?.id) return;
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/edit", {
        method: "POST",
        body: JSON.stringify({
          rental_id: active.id, client_id: Number(editClient), recurring_rent: Number(editRecurring), deposit: Number(editDeposit),
          charger_quantity: Number(editChargers), billable_extra_batteries: Number(editBillableExtra), notes: editNotes || null,
          move_financial_history: moveHistory,
        }),
      });
      showToast("Условия договора изменены. Платёж не создавался."); setEditing(false); await reload(); await load();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  async function transferBike() {
    if (!active?.id || !Number(newBikeId)) return showToast("Укажи новый bike ID");
    if (!confirm(`Пересадить rental #${active.id} с bike #${bike.id} на bike #${newBikeId}? Оплаты и месяц останутся прежними.`)) return;
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/transfer", {
        method: "POST",
        body: JSON.stringify({ rental_id: active.id, new_bike_id: Number(newBikeId), keep_current_batteries: keepBatteries, notes: "transfer from Mini App" }),
      });
      showToast(`Пересадка на bike #${newBikeId} выполнена без нового платежа/начисления`); await reload();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  async function removeBattery(id: number) {
    if (!confirm(`Убрать батарею #${id} из active договора? Это не создаёт возврат/платёж.`)) return;
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/equipment", { method: "DELETE", body: JSON.stringify({ rental_id: active.id, battery_id: id, notes: "removed from Mini App" }) });
      showToast(`Батарея #${id} снята с договора`); await load(); await reload();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  async function addBattery() {
    try {
      setBusy(true);
      await request("/api/admin/rental-contracts/add-battery", {
        method: "POST", body: JSON.stringify({ rental_id: active.id, battery: extraSlot, effective_date: localToday(), charge_now: extraChargeNow }),
      });
      showToast(extraChargeNow ? "Батарея добавлена и создано начисление" : "Батарея добавлена без текущей доплаты"); await load(); await reload();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  async function closeContract() {
    const refundRaw = prompt(`Сколько депозита реально вернули? Договор: ${money(active?.deposit)}`, "0");
    if (refundRaw === null) return;
    const refund = Number(refundRaw.replace(",", ".")); if (!Number.isFinite(refund) || refund < 0) return showToast("Некорректная сумма");
    try {
      setBusy(true);
      await request("/api/admin/rentals/close", { method: "POST", body: JSON.stringify({ bike_id: bike.id, end_date: localToday(), bike_status: closeStatus, deposit_refund: refund, notes: "closed from contract v2" }) });
      showToast("Договор закрыт"); await reload();
    } catch (e: any) { showToast(e.message); } finally { setBusy(false); }
  }

  function BatterySlotEditor({ slot, index, onChange }: { slot: BatterySlot; index?: number; onChange: (p: Partial<BatterySlot>) => void }) {
    return <div className="item"><div className="space"><b>{index == null ? "Новая батарея" : `Батарея ${index + 1}`}</b><span className="pill">{slot.mode}</span></div>
      <select className="select" value={slot.mode} onChange={(e) => onChange({ mode: e.target.value as BatteryMode, battery_id: undefined, type_id: options.battery_types[0]?.id })}>
        <option value="existing">из базы</option><option value="temporary">временная / не проиндексирована</option><option value="create">создать индексированную</option>
      </select>
      {slot.mode === "existing" ? <select className="select" value={slot.battery_id || ""} onChange={(e) => onChange({ battery_id: Number(e.target.value) })}><option value="">выбери</option>{options.available_batteries.map((b) => <option key={b.id} value={b.id}>{batteryLabel(b)}</option>)}</select>
      : <select className="select" value={slot.type_id || ""} onChange={(e) => onChange({ type_id: Number(e.target.value) })}><option value="">тип</option>{options.battery_types.map((t) => <option key={t.id} value={t.id}>{typeLabel(t)}</option>)}</select>}
    </div>;
  }

  if (loading) return <div className="card">Загрузка договора...</div>;

  if (!active) return (
    <div className="card">
      <h3>📄 Новый договор v2</h3>
      <div className="notice"><b>Важно:</b> создание договора создаёт только условия и начисления. <b>client_payment не создаётся.</b> Деньги записываются отдельно через бот, код оплаты или ручную оплату.</div>
      <div className="formgrid">
        <label>Клиент<select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">выбери</option>{options.clients.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.name}</option>)}</select></label>
        <label>Тариф<select className="select" value={planCode} onChange={(e) => setPlanCode(e.target.value)}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {money(modelValue(p,"recurring_rent"))}/мес</option>)}</select></label>
        <label>Дата начала<input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label>Доп. батарей по тарифу<input className="input" type="number" min={0} max={8} value={extraCount} onChange={(e) => setExtraCount(Math.max(0, Number(e.target.value)))} /></label>
        <label>Зарядки<input className="input" type="number" min={0} max={10} value={chargerQuantity} onChange={(e) => setChargerQuantity(Number(e.target.value))} /></label>
      </div>
      {selectedPlan?.model_price_override && <div className="notice small">Для модели <b>{bike.model}</b> применён model-specific прайс.</div>}
      <label className="row small"><input type="checkbox" checked={customize} onChange={(e) => setCustomize(e.target.checked)} /> Индивидуальные условия</label>
      {customize && <div className="formgrid">
        <label>Первый период<input className="input" type="number" value={customFirst} onChange={(e) => setCustomFirst(e.target.value)} /></label>
        <label>Далее / месяц<input className="input" type="number" value={customRecurring} onChange={(e) => setCustomRecurring(e.target.value)} /></label>
        <label>Залог по договору<input className="input" type="number" value={customDeposit} onChange={(e) => setCustomDeposit(e.target.value)} /></label>
      </div>}
      <h4>Фактически выданные батареи ({slots.length})</h4>
      <div className="list">{slots.map((s, i) => <BatterySlotEditor key={i} slot={s} index={i} onChange={(p) => updateSlot(i,p)} />)}</div>
      <label>Заметка<textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="btn primary" disabled={busy || !clientId} onClick={createContract}>{busy ? "Создаю..." : "Создать договор БЕЗ оплаты"}</button>
    </div>
  );

  const actualAssigned = equipment.length;
  const includedCount = Number(active.included_batteries || active.contract_terms_snapshot?.included_batteries || 0);

  return (
    <div className="card">
      <div className="space"><h3>📄 Active договор #{active.id}</h3><span className="pill ok">{active.plan_name || active.plan_code || "legacy"}</span></div>
      <div className="kv">
        <div>Клиент</div><div>#{active.client_id} {active.client_name || ""}</div>
        <div>Велик</div><div>#{bike.id} {bike.model || ""}</div>
        <div>Регулярно</div><div><b>{money(active.recurring_rent || active.price)}</b></div>
        <div>Залог по условию</div><div>{money(active.deposit)}</div>
        <div>Батарей включено тарифом</div><div>{includedCount || "не задано"}</div>
        <div>Фактически выдано</div><div><b>{actualAssigned}</b>{includedCount && actualAssigned !== includedCount ? <span className="pill warn" style={{ marginLeft: 6 }}>не совпадает</span> : null}</div>
        <div>Платных доп. батарей</div><div>{Number(active.extra_batteries || 0)}</div>
      </div>

      <div className="row" style={{ marginTop: 10 }}><button className="btn" onClick={() => setEditing(!editing)}>✏️ Изменить условия</button></div>
      {editing && <div className="item" style={{ marginTop: 10 }}>
        <div className="formgrid">
          <label>Клиент<select className="select" value={editClient} onChange={(e) => setEditClient(e.target.value)}>{options.clients.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.name}</option>)}</select></label>
          <label>Цена / месяц<input className="input" type="number" value={editRecurring} onChange={(e) => setEditRecurring(e.target.value)} /></label>
          <label>Залог<input className="input" type="number" value={editDeposit} onChange={(e) => setEditDeposit(e.target.value)} /></label>
          <label>Зарядки<input className="input" type="number" value={editChargers} onChange={(e) => setEditChargers(e.target.value)} /></label>
          <label>Платных доп. батарей<input className="input" type="number" value={editBillableExtra} onChange={(e) => setEditBillableExtra(e.target.value)} /></label>
        </div>
        <label>Заметка<textarea className="textarea" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></label>
        {Number(editClient) !== Number(active.client_id) && <label className="row small"><input type="checkbox" checked={moveHistory} onChange={(e) => setMoveHistory(e.target.checked)} /> Это исправление клиента: перенести charges/payments этого rental на нового клиента</label>}
        <button className="btn primary" disabled={busy} onClick={saveEdit}>Сохранить без создания оплаты</button>
      </div>}

      <hr className="hr" />
      <h4>🔄 Пересадка без нового месяца</h4>
      <p className="small muted">Меняет bike_id внутри этого же rental. Уже оплаченный период, депозит и история сохраняются. Новая оплата/начисление не создаются.</p>
      <div className="row"><input className="input" style={{ maxWidth: 180 }} inputMode="numeric" placeholder="новый bike ID" value={newBikeId} onChange={(e) => setNewBikeId(e.target.value.replace(/\D/g,""))} /><label className="row small"><input type="checkbox" checked={keepBatteries} onChange={(e) => setKeepBatteries(e.target.checked)} /> оставить текущие батареи клиенту</label><button className="btn warn" disabled={busy || !newBikeId} onClick={transferBike}>Пересадить</button></div>

      <hr className="hr" />
      <h4>🔋 Фактическая комплектация</h4>
      <div className="list">{equipment.map((r: any) => { const b = r.batteries || {}; return <div className="item" key={r.id}><div className="space"><b>{b.inventory_code || `battery #${r.battery_id}`}</b><button className="btn danger" disabled={busy} onClick={() => removeBattery(r.battery_id)}>Убрать</button></div><div className="small muted">DB #{r.battery_id} · {b.indexing_status || "-"}</div></div>; })}{!equipment.length && <p className="muted">Нет active battery_rentals.</p>}</div>
      <BatterySlotEditor slot={extraSlot} onChange={(p) => setExtraSlot((s) => ({...s,...p}))} />
      <label className="row small"><input type="checkbox" checked={extraChargeNow} onChange={(e) => setExtraChargeNow(e.target.checked)} /> создать начисление за доп. батарею сейчас</label>
      <button className="btn" disabled={busy} onClick={addBattery}>➕ Добавить батарею</button>

      <hr className="hr" />
      <div className="row"><select className="select" style={{maxWidth:180}} value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)}><option value="free">free</option><option value="repair">repair</option><option value="waiting">waiting</option><option value="sold">sold</option></select><button className="btn danger" disabled={busy} onClick={closeContract}>Закрыть договор</button></div>
      <p className="small muted">Условия договора и реальные деньги разделены. Любая оплата должна прийти отдельным payment-flow: бот, код оплаты, Fio или ручное подтверждение.</p>
    </div>
  );
}
