"use client";

import { useEffect, useMemo, useState } from "react";

type Props = { showToast: (text: string) => void };

function initData() {
  return typeof window === "undefined" ? "" : (window as any).Telegram?.WebApp?.initData || "";
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...options, headers: { "Content-Type": "application/json", "x-telegram-init-data": initData(), ...(options.headers || {}) } });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) throw new Error(typeof json.error === "string" ? json.error : json.error?.message || "API error");
  return json.data as T;
}
function money(v: unknown) { return `${Math.round(Number(v || 0)).toLocaleString("ru-RU")} Kč`; }

function SparkBars({ rows }: { rows: any[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.income || 0), Number(r.expense || 0))));
  return (
    <div className="op22-chart" title="30 дней: зелёная колонка — доход, красная — расход">
      {rows.map((r) => (
        <div className="op22-day" key={r.date} title={`${r.date}\n+${money(r.income)}\n-${money(r.expense)}\n=${money(r.profit)}`}>
          <span className="op22-bar income" style={{ height: `${Math.max(2, Number(r.income || 0) / max * 100)}%` }} />
          <span className="op22-bar expense" style={{ height: `${Math.max(2, Number(r.expense || 0) / max * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

function CashRedeem({ showToast, onDone }: { showToast: (s: string) => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [received, setReceived] = useState("");
  const [busy, setBusy] = useState(false);

  async function check() {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 8) return showToast("Нужно 8 цифр cash-кода");
    setBusy(true);
    try {
      const p = await api<any>(`/api/admin/cash-tokens?code=${clean}`);
      setPreview(p);
      setReceived(String(p.amount || ""));
    } catch (e: any) { showToast(e.message); setPreview(null); }
    finally { setBusy(false); }
  }
  async function redeem() {
    if (!preview || preview.status !== "issued") return;
    const amount = Number(received);
    if (!Number.isFinite(amount) || amount <= 0) return showToast("Укажи фактически полученную сумму");
    setBusy(true);
    try {
      const result = await api<any>("/api/admin/cash-tokens", { method: "POST", body: JSON.stringify({ code: code.replace(/\D/g, ""), received_amount: amount }) });
      showToast(`Наличные ${money(result.received_amount)} подтверждены · payment #${result.payment_id}`);
      setCode(""); setPreview(null); setReceived(""); onDone();
    } catch (e: any) { showToast(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="space"><h3>💵 Принять наличные</h3><span className="pill">cash-code</span></div>
      <p className="small muted">Код подтверждает именно передачу наличных. Банк/Fio сюда не относится.</p>
      <div className="row">
        <input className="input" style={{ maxWidth: 210, letterSpacing: 3, fontWeight: 800 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00000000" inputMode="numeric" />
        <button className="btn" disabled={busy || code.length !== 8} onClick={check}>Проверить</button>
      </div>
      {preview && (
        <div className="item" style={{ marginTop: 10 }}>
          <div className="space"><b>{preview.client_name || `client #${preview.client_id}`}</b><span className={`pill ${preview.status === "issued" ? "ok" : "warn"}`}>{preview.status}</span></div>
          <div className="small muted">Код ••••{preview.last4} · ожидается {money(preview.amount)}</div>
          {(preview.allocations || []).map((a: any) => <div className="small" key={a.charge_id}>#{a.charge_id} {a.charge_type} · план {money(a.planned_amount)} · осталось {money(a.remaining)}</div>)}
          {preview.status === "issued" && <>
            <label style={{ display: "block", marginTop: 10 }}>Фактически получил, Kč<input className="input" type="number" min="1" value={received} onChange={(e) => setReceived(e.target.value)} /></label>
            {received && Number(received) !== Number(preview.amount) && <div className="small" style={{ marginTop: 6 }}>⚠️ Сумма отличается от ожидаемой. Будет записано ровно {money(received)}; остаток долга останется открытым.</div>}
            <button className="btn primary" style={{ marginTop: 10 }} disabled={busy} onClick={redeem}>✅ Получил наличные</button>
          </>}
        </div>
      )}
    </div>
  );
}

export default function OperationsDashboardV22({ showToast }: Props) {
  const [data, setData] = useState<any>(null);
  const [integrity, setIntegrity] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState<number | null>(null);
  async function load() {
    setLoading(true);
    try {
      const [dashboard, integrityData] = await Promise.all([
        api<any>("/api/admin/operations/dashboard"),
        api<any>("/api/admin/operations/integrity"),
      ]);
      setData(dashboard);
      setIntegrity(integrityData);
    } catch (e: any) { showToast(e.message || "Не удалось загрузить dashboard"); }
    finally { setLoading(false); }
  }
  async function repairCharge(chargeId: number) {
    if (!confirm(`Пересчитать charge #${chargeId} строго по существующим payment allocations?`)) return;
    setRepairing(chargeId);
    try {
      const result = await api<any>("/api/admin/operations/integrity", {
        method: "POST",
        body: JSON.stringify({ action: "recalculate_charge", charge_id: chargeId }),
      });
      showToast(`Charge #${chargeId}: ${money(result.old_paid_amount)} → ${money(result.new_paid_amount)} (${result.new_status})`);
      await load();
    } catch (e: any) { showToast(e.message || "Не удалось исправить charge"); }
    finally { setRepairing(null); }
  }
  useEffect(() => { load().catch(() => null); }, []);
  const k = data?.kpi || {};
  const profitPositive = Number(k.today_profit || 0) >= 0;
  const requestTop = useMemo(() => Object.entries(data?.request_types || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 6), [data]);

  return (
    <div className="grid">
      <div className="card wide">
        <div className="space"><div><h2 style={{ marginBottom: 2 }}>⚡ Операционный центр</h2><div className="small muted">Велики, батареи, заявки, долги и деньги одним взглядом</div></div><button className="btn" onClick={load} disabled={loading}>↻</button></div>
        <div className="op22-kpis">
          <div className="op22-kpi"><span>🚲 Велики</span><b>{k.bikes_rented || 0}/{k.bikes_total || 0}</b><small>🟢 {k.bikes_free || 0} свободно · 🛠 {k.bikes_service || 0} сервис · ⚪ {k.bikes_unassigned_other || 0} прочих</small><small>⚠️ {k.bikes_warnings || 0} предупреждений учёта</small></div>
          <div className="op22-kpi"><span>🔋 Батареи</span><b>{k.batteries_assigned || 0}/{k.batteries_total || 0}</b><small>{k.batteries_free || 0} свободно · {k.batteries_problem || 0} проблем</small></div>
          <div className="op22-kpi"><span>📝 Заявки</span><b>{k.requests_new || 0}</b><small>{k.requests_in_progress || 0} в работе</small></div>
          <div className="op22-kpi"><span>⚠️ Просрочка</span><b>{money(k.overdue_total)}</b><small>{k.overdue_count || 0} начислений</small></div>
          <div className={`op22-kpi ${profitPositive ? "good" : "bad"}`}><span>💰 Сегодня</span><b>{money(k.today_profit)}</b><small>+{money(k.today_income)} · −{money(k.today_expense)}</small></div>
        </div>
      </div>

      <div className="card wide"><div className="space"><h3>📈 Денежный поток · 30 дней</h3><span className="pill">cash only</span></div><SparkBars rows={data?.finance_30d || []} /></div>

      <div className="card wide">
        <div className="space">
          <div><h3>🛡 Finance Integrity · v2.2.1</h3><div className="small muted">Сверяет client_charges с реальными allocations и проверяет, что платежи/долги не пересекают клиентов и rental.</div></div>
          <span className={`pill ${Number(integrity?.critical || 0) ? "danger" : Number(integrity?.warning || 0) ? "warn" : "ok"}`}>
            {integrity?.total ?? 0} проблем
          </span>
        </div>
        <div className="op22-integrity-kpis">
          <div><b>{integrity?.critical || 0}</b><span>критических</span></div>
          <div><b>{integrity?.warning || 0}</b><span>предупреждений</span></div>
          <div><b>{integrity?.repairable || 0}</b><span>можно пересчитать</span></div>
        </div>
        {(integrity?.rows || []).length ? <div className="list" style={{ marginTop: 10 }}>
          {(integrity.rows || []).slice(0, 20).map((r: any) => (
            <div className="item" key={r.issue_key}>
              <div className="space"><b>{r.title}</b><span className={`pill ${r.severity === "critical" ? "danger" : "warn"}`}>{r.severity}</span></div>
              <div className="small muted">{r.description}</div>
              <div className="small">{r.client_id ? `client #${r.client_id}` : ""}{r.rental_id ? ` · rental #${r.rental_id}` : ""}{r.bike_id ? ` · bike #${r.bike_id}` : ""}</div>
              {r.repair_action === "recalculate_charge" && <button className="btn" style={{ marginTop: 8 }} disabled={repairing === r.entity_id} onClick={() => repairCharge(Number(r.entity_id))}>↻ Исправить по allocations</button>}
            </div>
          ))}
        </div> : <div className="notice" style={{ marginTop: 10 }}>✅ Проверки v2.2.1 не нашли несостыковок.</div>}
        {(integrity?.rows || []).length > 20 && <div className="small muted" style={{ marginTop: 8 }}>Показаны первые 20 из {integrity.rows.length}.</div>}
      </div>

      <CashRedeem showToast={showToast} onDone={() => load().catch(() => null)} />

      <div className="card"><h3>📝 Открытые заявки</h3>{requestTop.length ? <div className="list">{requestTop.map(([type, count]: any) => <div className="item space" key={type}><span>{type}</span><b>{count}</b></div>)}</div> : <p className="muted">Открытых заявок нет.</p>}</div>

      <style>{`
        .op22-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-top:14px}
        .op22-kpi{border:1px solid rgba(110,210,150,.18);border-radius:16px;padding:13px;background:rgba(6,35,22,.5);display:flex;flex-direction:column;gap:3px}
        .op22-kpi>b{font-size:24px}.op22-kpi small{opacity:.66}.op22-kpi.good{box-shadow:inset 0 0 0 1px rgba(40,200,100,.18)}.op22-kpi.bad{box-shadow:inset 0 0 0 1px rgba(230,80,80,.23)}
        .op22-integrity-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.op22-integrity-kpis>div{border:1px solid rgba(110,210,150,.16);border-radius:12px;padding:10px;display:flex;flex-direction:column}.op22-integrity-kpis b{font-size:20px}.op22-integrity-kpis span{font-size:12px;opacity:.68}
        .op22-chart{height:190px;display:flex;align-items:flex-end;gap:3px;padding:12px 4px 3px;border-bottom:1px solid rgba(255,255,255,.09)}
        .op22-day{height:100%;flex:1;display:flex;align-items:flex-end;justify-content:center;gap:1px;min-width:3px}.op22-bar{width:43%;border-radius:4px 4px 1px 1px;opacity:.85;transition:height .25s ease}.op22-bar.income{background:#2fc873}.op22-bar.expense{background:#e05b60}
        @media(max-width:900px){.op22-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.op22-kpi:last-child{grid-column:1/-1}.op22-chart{height:150px;gap:2px}}
      `}</style>
    </div>
  );
}
