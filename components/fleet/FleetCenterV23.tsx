"use client";

import { useEffect, useMemo, useState } from "react";
import ClientAvatarV23 from "@/components/media/ClientAvatarV23";

type Props = {
  showToast: (text: string) => void;
  initialBikeId?: number | null;
  onOpenClient?: (clientId: number) => void;
};

type FleetRow = any;
type DetailTab = "overview" | "finance" | "batteries" | "service" | "history";

function initData() { return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || ""; }
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", "x-telegram-init-data": initData(), ...(options.headers || {}) },
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : json.error?.message || "API error");
  return json.data as T;
}
function money(v: unknown) { return `${Math.round(Number(v || 0)).toLocaleString("ru-RU")} Kč`; }
function date(v: unknown) { if (!v) return "—"; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("ru-RU"); }
function dt(v: unknown) { if (!v) return "—"; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("ru-RU"); }
function arr(v: any) { return Array.isArray(v) ? v : []; }
function fleetPill(status: string) {
  if (status === "rented") return "ok";
  if (status === "free") return "";
  if (status === "service") return "warn";
  if (status === "inactive") return "danger";
  return "warn";
}

function WarnGroup({ title, icon, rows, cls }: { title: string; icon: string; rows: string[]; cls: string }) {
  if (!rows.length) return null;
  return <div className={`v23-warn-group ${cls}`}><b>{icon} {title}</b><div className="small">{rows.join(" · ")}</div></div>;
}

export default function FleetCenterV23({ showToast, initialBikeId, onOpenClient }: Props) {
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [kpi, setKpi] = useState<any>({});
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [problem, setProblem] = useState("all");
  const [selected, setSelected] = useState<number | null>(initialBikeId || null);
  const [detail, setDetail] = useState<any>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(false);
  const [acquisition, setAcquisition] = useState("");
  const [acquiredAt, setAcquiredAt] = useState("");
  const [financeNote, setFinanceNote] = useState("");

  async function loadList() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "all") params.set("status", status);
      if (problem !== "all") params.set("problem", problem);
      const data = await api<any>(`/api/admin/fleet?${params.toString()}`);
      setRows(data.rows || []); setKpi(data.kpi || {});
    } catch (e: any) { showToast(e.message || "Fleet Center не загрузился"); }
    finally { setLoading(false); }
  }
  async function loadDetail(id: number) {
    setSelected(id); setLoading(true);
    try {
      const d = await api<any>(`/api/admin/fleet/${id}`);
      setDetail(d);
      setAcquisition(d.financial_settings?.acquisition_cost == null ? "" : String(d.financial_settings.acquisition_cost));
      setAcquiredAt(d.financial_settings?.acquired_at || "");
      setFinanceNote(d.financial_settings?.notes || "");
    } catch (e: any) { showToast(e.message || "Карточка велика не загрузилась"); }
    finally { setLoading(false); }
  }
  async function refresh() {
    await loadList();
    if (selected) await loadDetail(selected);
  }
  async function saveAcquisition() {
    if (!selected) return;
    try {
      await api(`/api/admin/fleet/${selected}/financial-settings`, {
        method: "POST",
        body: JSON.stringify({ acquisition_cost: acquisition, acquired_at: acquiredAt || null, notes: financeNote || null }),
      });
      showToast("Стоимость велосипеда сохранена");
      await refresh();
    } catch (e: any) { showToast(e.message); }
  }

  useEffect(() => { loadList().catch(() => null); }, [status, problem]);
  useEffect(() => {
    if (initialBikeId && initialBikeId !== selected) loadDetail(initialBikeId).catch(() => null);
  }, [initialBikeId]);

  const selectedRow = useMemo(() => rows.find((r) => Number(r.bike_id) === Number(selected)) || detail?.bike || null, [rows, selected, detail]);
  const bike = detail?.bike || selectedRow;

  return <div className="v23-fleet-root">
    <div className="card wide">
      <div className="space"><div><h2 style={{ marginBottom: 2 }}>🚲 Fleet Center · v2.3</h2><div className="small muted">Текущий клиент, его rental, батареи, сервис, история и экономика велосипеда. Старые долги другого клиента сюда не попадают.</div></div><button className="btn" disabled={loading} onClick={refresh}>↻</button></div>
      <div className="v23-kpis">
        <button className={`v23-kpi ${status === "all" ? "active" : ""}`} onClick={() => setStatus("all")}><span>Всего</span><b>{kpi.total ?? 0}</b></button>
        <button className={`v23-kpi ${status === "rented" ? "active" : ""}`} onClick={() => setStatus("rented")}><span>🔵 В аренде</span><b>{kpi.rented ?? 0}</b></button>
        <button className={`v23-kpi ${status === "free" ? "active" : ""}`} onClick={() => setStatus("free")}><span>🟢 Свободно</span><b>{kpi.free ?? 0}</b></button>
        <button className={`v23-kpi ${status === "service" ? "active" : ""}`} onClick={() => setStatus("service")}><span>🛠 Сервис</span><b>{kpi.service ?? 0}</b></button>
        <button className={`v23-kpi ${status === "inactive" ? "active" : ""}`} onClick={() => setStatus("inactive")}><span>⚫ Неактивно</span><b>{kpi.inactive ?? 0}</b></button>
      </div>
      <div className="v23-kpis v23-kpis-secondary">
        <button className={`v23-kpi ${problem === "accounting" ? "active" : ""}`} onClick={() => setProblem(problem === "accounting" ? "all" : "accounting")}><span>⚠️ Учёт</span><b>{kpi.accounting ?? 0}</b></button>
        <button className={`v23-kpi ${problem === "technical" ? "active" : ""}`} onClick={() => setProblem(problem === "technical" ? "all" : "technical")}><span>🔧 Техника</span><b>{kpi.technical ?? 0}</b></button>
        <button className={`v23-kpi ${problem === "financial" ? "active" : ""}`} onClick={() => setProblem(problem === "financial" ? "all" : "financial")}><span>💰 Финансы</span><b>{kpi.financial ?? 0}</b></button>
        <div className="v23-kpi"><span>Долг active rental</span><b>{money(kpi.current_debt)}</b></div>
        <div className="v23-kpi"><span>Прибыль месяца*</span><b>{money(kpi.month_profit)}</b></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input" style={{ flex: 1, minWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadList()} placeholder="вел # / модель / клиент / телефон / батарея #" />
        <button className="btn primary" onClick={loadList}>Найти</button>
        {(q || status !== "all" || problem !== "all") && <button className="btn" onClick={() => { setQ(""); setStatus("all"); setProblem("all"); setTimeout(() => loadList(), 0); }}>Сбросить</button>}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>* Прибыль велосипеда берётся из bot_finance_events по bike_id: доход минус расход. Это журнал, а не клиентский баланс.</div>
    </div>

    <div className="v23-master-detail">
      <div className="card v23-list-card">
        <div className="space"><h3>Парк</h3><span className="pill">{rows.length}</span></div>
        <div className="list v23-bike-list">
          {rows.map((r: any) => {
            const a = arr(r.accounting_warnings), t = arr(r.technical_warnings), f = arr(r.financial_warnings);
            return <button key={r.bike_id} className={`item v23-bike-row ${selected === r.bike_id ? "active" : ""}`} onClick={() => { setTab("overview"); loadDetail(Number(r.bike_id)); }}>
              <div className="space"><b>{r.bike_label}</b><span className={`pill ${fleetPill(r.fleet_status)}`}>{r.fleet_status}</span></div>
              <div className="v23-client-line">
                {r.current_client_id ? <ClientAvatarV23 mediaId={r.avatar_media_id} name={r.client_name} size={34} /> : <div className="v23-empty-avatar">—</div>}
                <div><div>{r.client_name || "Без active клиента"}</div><div className="small muted">{r.current_rental_id ? `rental #${r.current_rental_id}` : r.db_status || ""}</div></div>
              </div>
              <div className="v23-bike-mini"><span>🔋 {arr(r.battery_ids).length ? arr(r.battery_ids).map((x: any) => `#${x}`).join(", ") : "—"}</span><span className={Number(r.current_rental_debt || 0) > 0 ? "dangerText" : "okText"}>{money(r.current_rental_debt)}</span></div>
              {(a.length || t.length || f.length) ? <div className="row" style={{ marginTop: 6 }}>{a.length ? <span className="pill warn">учёт {a.length}</span> : null}{t.length ? <span className="pill warn">техника {t.length}</span> : null}{f.length ? <span className="pill danger">финансы {f.length}</span> : null}</div> : <div className="small okText" style={{ marginTop: 5 }}>✓ без предупреждений</div>}
            </button>;
          })}
          {!rows.length && <p className="muted">Ничего не найдено.</p>}
        </div>
      </div>

      <div className="v23-detail">
        {!selected && <div className="card"><h3>Выбери велосипед</h3><p className="muted">Откроется текущий rental, история владельцев, батареи, сервис и финансы.</p></div>}
        {selected && loading && !detail && <div className="card">Загрузка...</div>}
        {selected && detail && bike && <>
          <div className="card">
            <div className="space"><div><h2 style={{ marginBottom: 2 }}>{bike.bike_label}</h2><div className="small muted">DB status: {bike.db_status} · Fleet: {bike.fleet_status}</div></div><span className={`pill ${fleetPill(bike.fleet_status)}`}>{bike.fleet_status}</span></div>
            <div className="v23-detail-tabs">
              {([['overview','Обзор'],['finance','Финансы'],['batteries','Батареи'],['service','Сервис'],['history','История']] as const).map(([v,l]) => <button className={`btn ${tab === v ? "primary" : ""}`} key={v} onClick={() => setTab(v)}>{l}</button>)}
            </div>
          </div>

          {tab === "overview" && <>
            <div className="card">
              <h3>Текущий договор</h3>
              {bike.current_rental_id ? <>
                <div className="v23-current-client">
                  <ClientAvatarV23 mediaId={bike.avatar_media_id} name={bike.client_name} size={72} />
                  <div><b style={{ fontSize: 20 }}>{bike.client_name || `client #${bike.current_client_id}`}</b><div className="small muted">client #{bike.current_client_id} · rental #{bike.current_rental_id}</div>{bike.client_phone && <div className="small">📞 {bike.client_phone}</div>}<button className="btn" style={{ marginTop: 7 }} onClick={() => bike.current_client_id && onOpenClient?.(Number(bike.current_client_id))}>Открыть профиль клиента →</button></div>
                </div>
                <div className="kv" style={{ marginTop: 12 }}>
                  <div>Начало аренды</div><div>{date(bike.rental_start_date)}</div>
                  <div>Цена договора</div><div>{money(bike.rental_price)}</div>
                  <div>Начислено в этом rental</div><div>{money(bike.current_rental_charged_total)}</div>
                  <div>Платежей в этом rental</div><div>{money(bike.current_rental_payment_total)}</div>
                  <div>Открытый долг</div><div className={Number(bike.current_rental_debt) > 0 ? "dangerText" : "okText"}><b>{money(bike.current_rental_debt)}</b></div>
                  <div>Просрочено</div><div className={Number(bike.current_overdue_debt) > 0 ? "dangerText" : ""}>{money(bike.current_overdue_debt)}</div>
                  <div>Аренда / депозит долг</div><div>{money(bike.current_rent_debt)} / {money(bike.current_deposit_debt)}</div>
                  <div>Этот месяц начислено / оплачено</div><div>{money(bike.charged_this_month)} / {money(bike.paid_this_month)}</div>
                </div>
                <div className="notice small" style={{ marginTop: 10 }}>🔒 Эти цифры выбраны строго по <b>rental #{bike.current_rental_id} + client #{bike.current_client_id}</b>. Долги предыдущего арендатора этого велосипеда здесь не суммируются.</div>
              </> : <p className="muted">Active rental отсутствует.</p>}
            </div>
            <div className="card">
              <h3>Предупреждения</h3>
              <WarnGroup title="Учёт" icon="⚠️" rows={arr(bike.accounting_warnings)} cls="accounting" />
              <WarnGroup title="Техника" icon="🔧" rows={arr(bike.technical_warnings)} cls="technical" />
              <WarnGroup title="Финансы текущего rental" icon="💰" rows={arr(bike.financial_warnings)} cls="financial" />
              {!arr(bike.accounting_warnings).length && !arr(bike.technical_warnings).length && !arr(bike.financial_warnings).length && <p className="okText">✓ Предупреждений нет.</p>}
            </div>
            <div className="card"><h3>Состояние</h3><div className="kv"><div>Пробег</div><div>{Math.round(Number(bike.current_km || 0)).toLocaleString("ru-RU")} км</div><div>После ТО</div><div>{Math.round(Number(bike.km_since_service || 0)).toLocaleString("ru-RU")} км</div><div>До ТО</div><div>{Math.round(Number(bike.km_to_service || 0)).toLocaleString("ru-RU")} км</div><div>Health</div><div>{bike.health_status_label || bike.health_status || "—"}</div><div>Открытые задачи</div><div>{bike.open_task_count || 0}</div></div></div>
          </>}

          {tab === "finance" && <>
            <div className="card"><h3>Экономика велосипеда</h3><div className="v23-fin-kpis"><div><span>Доход всего</span><b>{money(bike.lifetime_income)}</b></div><div><span>Расход всего</span><b>{money(bike.lifetime_expense)}</b></div><div><span>Прибыль</span><b className={Number(bike.lifetime_profit) >= 0 ? "okText" : "dangerText"}>{money(bike.lifetime_profit)}</b></div><div><span>Аренда</span><b>{money(bike.lifetime_rent_income)}</b></div><div><span>ROI</span><b>{bike.roi_percent == null ? "—" : `${Number(bike.roi_percent).toFixed(1)}%`}</b></div></div><p className="small muted">Статистика выше строится по финансовому журналу с bike_id. После v2.3 история assignment не переписывает старые события задним числом.</p></div>
            <div className="card"><h3>Стоимость покупки / ROI</h3><div className="formgrid"><label>Стоимость покупки, Kč<input className="input" type="number" min="0" value={acquisition} onChange={(e) => setAcquisition(e.target.value)} /></label><label>Дата покупки<input className="input" type="date" value={acquiredAt} onChange={(e) => setAcquiredAt(e.target.value)} /></label></div><label>Заметка<textarea className="textarea" value={financeNote} onChange={(e) => setFinanceNote(e.target.value)} /></label><button className="btn primary" onClick={saveAcquisition}>Сохранить</button></div>
            <div className="card"><h3>Финансовый журнал по bike #{bike.bike_id}</h3><div className="list">{(detail.finance_events || []).slice(0,80).map((e: any) => <div className="item" key={e.id}><div className="space"><b>{date(e.event_date)} · {e.category || e.sign}</b><span className={e.sign === "expense" ? "dangerText" : "okText"}>{e.sign === "expense" ? "−" : "+"}{money(Math.abs(Number(e.cash_amount ?? e.amount ?? 0)))}</span></div><div className="small muted">#{e.id} · {e.raw_text || e.notes || ""}</div></div>)}{!(detail.finance_events || []).length && <p className="muted">Событий нет.</p>}</div></div>
            <div className="card"><h3>Charges / payments ТЕКУЩЕГО rental</h3><div className="v23-two-cols"><div><h4>Начисления</h4><div className="list">{(detail.charges || []).map((c: any) => <div className="item" key={c.id}><div className="space"><b>#{c.id} {c.charge_type}</b><span className="pill">{c.effective_status || c.status}</span></div><div className="small">{money(c.effective_paid_amount ?? c.paid_amount)} / {money(c.amount)} · до {date(c.due_date)}</div></div>)}{!(detail.charges || []).length && <p className="muted">Нет.</p>}</div></div><div><h4>Платежи</h4><div className="list">{(detail.payments || []).map((p: any) => <div className="item" key={p.id}><div className="space"><b>#{p.id} · {date(p.payment_date)}</b><span>{money(p.amount)}</span></div><div className="small muted">{p.method} · {p.notes || ""}</div></div>)}{!(detail.payments || []).length && <p className="muted">Нет.</p>}</div></div></div></div>
          </>}

          {tab === "batteries" && <div className="card"><h3>🔋 Батареи велосипеда</h3><div className="list">{(detail.batteries || []).map((b: any) => <div className={`item ${arr(b.warnings).length ? "warn" : ""}`} key={b.battery_id}><div className="space"><b>Батарея #{b.battery_id}</b><span className="pill">{b.overview_status}</span></div><div className="small muted">{[b.brand,b.capacity,b.generation].filter(Boolean).join(" · ")}</div><div className="small">rental #{b.rental_id || "—"} · client {b.client_name || "—"}</div>{arr(b.warnings).length ? <div className="small dangerText">⚠️ {arr(b.warnings).join(", ")}</div> : null}</div>)}{!(detail.batteries || []).length && <p className="muted">Нет батарей, связанных с этим велосипедом.</p>}</div></div>}

          {tab === "service" && <><div className="card"><h3>🔧 Сервис / ремонты</h3><div className="list">{(detail.service_events || []).map((e: any) => <div className="item" key={e.id}><div className="space"><b>{date(e.performed_at)} · {e.title}</b><span className="pill">{e.event_type}</span></div><div className="small muted">{e.odometer_km == null ? "км —" : `${Math.round(Number(e.odometer_km))} км`} · {money(e.cost)}</div>{e.description && <div className="small">{e.description}</div>}</div>)}{!(detail.service_events || []).length && <p className="muted">Истории сервиса нет.</p>}</div></div><div className="card"><h3>Задачи</h3><div className="list">{(detail.maintenance_tasks || []).map((t: any) => <div className="item" key={t.id}><div className="space"><b>{t.title}</b><span className={`pill ${t.status === "open" ? "warn" : "ok"}`}>{t.status}</span></div><div className="small muted">{t.priority} · {t.description || ""}</div></div>)}{!(detail.maintenance_tasks || []).length && <p className="muted">Задач нет.</p>}</div></div></>}

          {tab === "history" && <><div className="card"><h3>👥 История владельцев / назначений</h3><p className="small muted">После v2.3 пересадка того же клиента на другой велосипед создаёт отдельный assignment. Строки до миграции помечены legacy_snapshot — прошлые пересадки задним числом не выдумываются.</p><div className="list">{(detail.assignment_history || []).map((a: any) => <div className="item" key={a.id}><div className="space"><b>{a.clients?.name || `client #${a.client_id}`}</b><span className={`pill ${a.ended_at ? "" : "ok"}`}>{a.ended_at ? "закрыто" : "current"}</span></div><div className="small">rental #{a.rental_id} · bike #{a.bike_id}</div><div className="small muted">{dt(a.started_at)} → {a.ended_at ? dt(a.ended_at) : "сейчас"} · {a.source}</div>{a.clients?.id && <button className="btn" style={{ marginTop: 7 }} onClick={() => onOpenClient?.(Number(a.clients.id))}>Профиль клиента</button>}</div>)}{!(detail.assignment_history || []).length && <p className="muted">Истории нет.</p>}</div></div><div className="card"><h3>📄 События договоров</h3><div className="list">{(detail.contract_events || []).map((e: any) => <div className="item" key={e.id}><div className="space"><b>{e.event_type}</b><span className="small muted">{dt(e.created_at)}</span></div><div className="small">rental #{e.rental_id} · {e.notes || ""}</div></div>)}{!(detail.contract_events || []).length && <p className="muted">Событий нет.</p>}</div></div></>}
        </>}
      </div>
    </div>

    <style>{`
      .v23-fleet-root{display:grid;gap:12px}.v23-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:12px}.v23-kpis-secondary{margin-top:8px}.v23-kpi{border:1px solid rgba(120,210,155,.16);background:rgba(8,34,22,.45);border-radius:14px;padding:10px;text-align:left;display:flex;flex-direction:column;gap:2px;color:inherit}.v23-kpi b{font-size:20px}.v23-kpi span{font-size:12px;opacity:.72}.v23-kpi.active{box-shadow:inset 0 0 0 1px rgba(80,220,130,.5);background:rgba(35,130,75,.15)}
      .v23-master-detail{display:grid;grid-template-columns:minmax(310px,.78fr) minmax(0,1.55fr);gap:12px;align-items:start}.v23-list-card{position:sticky;top:8px;max-height:calc(100vh - 20px);overflow:auto}.v23-bike-list{margin-top:8px}.v23-bike-row{text-align:left;width:100%}.v23-client-line{display:flex;gap:8px;align-items:center;margin-top:8px}.v23-empty-avatar{width:34px;height:34px;border-radius:10px;border:1px dashed rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center}.v23-bike-mini{display:flex;justify-content:space-between;gap:8px;margin-top:7px;font-size:12px}.v23-detail{min-width:0}.v23-detail-tabs{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}.v23-current-client{display:flex;align-items:center;gap:14px}.v23-warn-group{padding:10px;border-radius:12px;margin-top:8px;border:1px solid rgba(255,255,255,.08)}.v23-warn-group.accounting{background:rgba(220,170,40,.08)}.v23-warn-group.technical{background:rgba(220,120,40,.08)}.v23-warn-group.financial{background:rgba(220,60,70,.08)}.v23-fin-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.v23-fin-kpis>div{border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;display:flex;flex-direction:column}.v23-fin-kpis span{font-size:12px;opacity:.7}.v23-fin-kpis b{font-size:18px}.v23-two-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      @media(max-width:950px){.v23-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.v23-master-detail{grid-template-columns:1fr}.v23-list-card{position:static;max-height:none}.v23-fin-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.v23-two-cols{grid-template-columns:1fr}}
    `}</style>
  </div>;
}
