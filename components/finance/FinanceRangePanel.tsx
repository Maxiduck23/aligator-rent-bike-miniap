"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = { showToast: (text: string) => void };

type RangeValue = { from: string; to: string };

function tgInitData() {
  if (typeof window === "undefined") return "";
  return (window as any).Telegram?.WebApp?.initData || "";
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
    const err = json?.error;
    throw new Error(typeof err === "string" ? err : err?.message || err?.details || "API error");
  }
  return json.data as T;
}

function localToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}

function addMonths(iso: string, months: number) {
  const d = new Date(`${startOfMonth(iso)}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function monthTitle(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00`));
}

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

function ordered(a: string, b: string): RangeValue {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

function money(value: unknown) {
  return `${Math.round(Number(value || 0))} Kč`;
}

function buildMonth(monthIso: string) {
  const d = new Date(`${startOfMonth(monthIso)}T12:00:00`);
  const y = d.getFullYear();
  const m = d.getMonth();
  const firstMondayOffset = (new Date(y, m, 1).getDay() + 6) % 7;
  const days = new Date(y, m + 1, 0).getDate();
  const cells: Array<string | null> = Array.from({ length: firstMondayOffset }, () => null);
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

function RangeCalendar({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [cursor, setCursor] = useState(startOfMonth(value.from || localToday()));
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tapStart, setTapStart] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const preview = dragStart && hover ? ordered(dragStart, hover) : tapStart ? ordered(tapStart, hover || tapStart) : value;

  useEffect(() => {
    function up() {
      if (dragStart && hover && dragMovedRef.current) {
        onChange(ordered(dragStart, hover));
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 180);
      }
      setDragStart(null);
      if (dragMovedRef.current) setHover(null);
      dragMovedRef.current = false;
    }
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragStart, hover, onChange]);

  function pick(iso: string) {
    if (suppressClickRef.current) return;
    // Click/tap mode: first date = start, second date = end.
    // This also allows selecting ranges longer than the two currently visible months:
    // choose start, navigate months, choose end.
    if (!tapStart) {
      setTapStart(iso);
      setHover(iso);
    } else {
      onChange(ordered(tapStart, iso));
      setTapStart(null);
      setHover(null);
    }
  }

  function renderMonth(monthIso: string) {
    const cells = buildMonth(monthIso);
    return (
      <div className="v2cal-month" key={monthIso}>
        <div className="v2cal-title">{monthTitle(monthIso)}</div>
        <div className="v2cal-weekdays">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((x) => <span key={x}>{x}</span>)}</div>
        <div className="v2cal-grid">
          {cells.map((iso, idx) => {
            if (!iso) return <span className="v2cal-empty" key={`e-${idx}`} />;
            const inside = iso >= preview.from && iso <= preview.to;
            const edge = iso === preview.from || iso === preview.to;
            const today = iso === localToday();
            return (
              <button
                type="button"
                key={iso}
                className={`v2cal-day ${inside ? "range" : ""} ${edge ? "edge" : ""} ${today ? "today" : ""}`}
                onPointerDown={(e) => {
                  if (e.pointerType === "mouse") {
                    dragMovedRef.current = false;
                    setDragStart(iso);
                    setHover(iso);
                  }
                }}
                onPointerEnter={() => {
                  if (dragStart) {
                    if (iso !== dragStart) {
                      dragMovedRef.current = true;
                      setTapStart(null);
                    }
                    setHover(iso);
                  } else if (tapStart) {
                    setHover(iso);
                  }
                }}
                onClick={() => pick(iso)}
                title={iso}
              >
                {Number(iso.slice(8, 10))}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="v2cal-shell">
      <div className="v2cal-nav">
        <button className="btn" type="button" onClick={() => setCursor(addMonths(cursor, -1))}>←</button>
        <div className="small muted">Зажми мышь и протяни или кликни начало → кликни конец. На телефоне: тап начало → тап конец.</div>
        <button className="btn" type="button" onClick={() => setCursor(addMonths(cursor, 1))}>→</button>
      </div>
      <div className="v2cal-months">{renderMonth(cursor)}{renderMonth(addMonths(cursor, 1))}</div>
      <style>{`
        .v2cal-shell{border:1px solid rgba(80,180,120,.25);border-radius:18px;padding:12px;background:rgba(4,25,16,.55);user-select:none}
        .v2cal-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
        .v2cal-months{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
        .v2cal-title{text-align:center;font-weight:800;text-transform:capitalize;margin:2px 0 8px}
        .v2cal-weekdays,.v2cal-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
        .v2cal-weekdays span{text-align:center;font-size:11px;opacity:.65;padding:4px 0}
        .v2cal-day{border:0;border-radius:10px;background:transparent;color:inherit;min-height:38px;cursor:pointer;transition:transform .11s ease,background .13s ease,box-shadow .13s ease;touch-action:manipulation}
        .v2cal-day:hover{transform:translateY(-1px);background:rgba(35,180,95,.12)}
        .v2cal-day.range{background:rgba(31,190,100,.18);border-radius:3px}
        .v2cal-day.edge{background:rgba(31,190,100,.78);color:#04150c;border-radius:11px;box-shadow:0 0 0 2px rgba(31,190,100,.18)}
        .v2cal-day.today{outline:1px solid rgba(120,220,160,.55)}
        .v2cal-empty{min-height:38px}
        @media(max-width:760px){.v2cal-months{grid-template-columns:1fr}.v2cal-months>.v2cal-month:nth-child(2){display:none}.v2cal-day{min-height:42px}.v2cal-nav .small{max-width:60%;text-align:center}}
      `}</style>
    </div>
  );
}

function PaymentTokenAdmin({ showToast, onDone }: { showToast: (s: string) => void; onDone: () => void }) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);

  async function check() {
    const clean = code.replace(/\D/g, "");
    if (clean.length !== 8) return showToast("Нужно 8 цифр кода оплаты");
    setBusy(true);
    try {
      setPreview(await request<any>(`/api/admin/payment-tokens?code=${clean}`));
    } catch (e: any) {
      showToast(e.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function redeem() {
    if (!preview || preview.status !== "issued") return;
    setBusy(true);
    try {
      const result = await request<any>("/api/admin/payment-tokens/redeem", {
        method: "POST",
        body: JSON.stringify({ code: code.replace(/\D/g, ""), method }),
      });
      showToast(result?.already_redeemed ? `Код уже использован: payment #${result.payment_id}` : `Оплата #${result.payment_id} подтверждена`);
      setCode("");
      setPreview(null);
      onDone();
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>🔐 Подтвердить оплату по коду</h3>
      <p className="small muted">Клиент создаёт 8-значный код в боте. Код живёт 24 часа и используется один раз. Повторный ввод не создаст второй платёж.</p>
      <div className="row">
        <input className="input" style={{ maxWidth: 220, letterSpacing: 3, fontWeight: 800 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00000000" inputMode="numeric" />
        <button className="btn" disabled={busy || code.length !== 8} onClick={check}>Проверить</button>
      </div>
      {preview && (
        <div className={`item ${preview.status === "issued" ? "ok" : "warn"}`} style={{ marginTop: 10 }}>
          <div className="space"><b>Код ••••{preview.last4}</b><span className={`pill ${preview.status === "issued" ? "ok" : "warn"}`}>{preview.status}</span></div>
          <div className="kv">
            <div>Клиент</div><div>#{preview.client_id} {preview.client_name || ""}</div>
            <div>Велик</div><div>{preview.bike_id ? `#${preview.bike_id}` : "-"}</div>
            <div>Назначение</div><div>{preview.purpose}</div>
            <div>Сумма</div><div><b>{preview.amount == null ? "задаётся при оплате" : money(preview.amount)}</b></div>
            <div>Истекает</div><div>{new Date(preview.expires_at).toLocaleString()}</div>
          </div>
          {preview.status === "issued" && (
            <div className="row" style={{ marginTop: 10 }}>
              <select className="select" style={{ maxWidth: 180 }} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">наличные</option>
                <option value="card">карта / POS</option>
                <option value="bank">банк</option>
                <option value="other">другое</option>
              </select>
              <button className="btn primary" disabled={busy} onClick={redeem}>✅ Деньги получены</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FinanceRangePanel({ showToast }: Props) {
  const today = localToday();
  const [range, setRange] = useState<RangeValue>({ from: addDays(today, -6), to: today });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function load(next = range) {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ date_from: next.from, date_to: next.to });
      setData(await request<any>(`/api/admin/bot-finance?${qs}`));
    } catch (e: any) {
      showToast(e.message || "Не получилось загрузить статистику");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(() => null); }, []);

  function preset(kind: "today" | "7" | "30" | "month") {
    let next: RangeValue;
    if (kind === "today") next = { from: today, to: today };
    else if (kind === "7") next = { from: addDays(today, -6), to: today };
    else if (kind === "30") next = { from: addDays(today, -29), to: today };
    else next = { from: startOfMonth(today), to: today };
    setRange(next);
    load(next).catch(() => null);
  }

  const totals = data?.totals || { income: 0, expense: 0, debt_created: 0, count: 0 };
  const profit = Number(totals.income || 0) - Number(totals.expense || 0);
  const selectedDays = useMemo(() => dayDiff(range.from, range.to) + 1, [range]);

  return (
    <div className="grid">
      <div className="card wide">
        <div className="space"><h3>📊 Финансы за произвольный период</h3><span className="pill">{selectedDays} дн.</span></div>
        <p className="muted">Выдели мышкой любой отрезок календаря: два дня, неделю, несколько месяцев. Быстрые кнопки только переставляют диапазон.</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={() => preset("today")}>Сегодня</button>
          <button className="btn" onClick={() => preset("7")}>7 дней</button>
          <button className="btn" onClick={() => preset("30")}>30 дней</button>
          <button className="btn" onClick={() => preset("month")}>Текущий месяц</button>
          <button className="btn primary" onClick={() => load()} disabled={loading}>{loading ? "Загрузка..." : "Применить диапазон"}</button>
        </div>
        <RangeCalendar value={range} onChange={setRange} />
        <div className="small muted" style={{ marginTop: 8 }}>Выбрано: <b>{range.from}</b> → <b>{range.to}</b></div>
        <hr className="hr" />
        <div className="kpi-grid">
          <div className="kpi"><div>Реальный доход</div><b>{money(totals.income)}</b></div>
          <div className="kpi"><div>Реальный расход</div><b>{money(totals.expense)}</b></div>
          <div className="kpi"><div>Денежный итог</div><b>{money(profit)}</b></div>
          <div className="kpi"><div>Создано долгов</div><b>{money(totals.debt_created)}</b></div>
          <div className="kpi"><div>Записей</div><b>{data?.total_rows ?? totals.count ?? 0}</b></div>
        </div>
      </div>

      <PaymentTokenAdmin showToast={showToast} onDone={() => load().catch(() => null)} />

      <div className="card">
        <h3>По категориям</h3>
        <div className="list">
          {(data?.by_category || []).map((r: any, idx: number) => (
            <div className="item" key={`${r.sign}-${r.category}-${idx}`}>
              <div className="space"><b>{r.kind === "debt_created" ? "📌 долг" : r.sign === "income" ? "🟢 +" : "🔴 -"} {r.category_label || r.category}</b><span className="pill">{r.count}</span></div>
              <div>{money(r.total)}</div>
            </div>
          ))}
          {data && !data.by_category?.length && <p className="muted">За выбранный период записей нет.</p>}
        </div>
      </div>

      <div className="card wide">
        <h3>Записи диапазона</h3>
        <div className="tableWrap">
          <table className="table">
            <thead><tr><th>Дата</th><th>Тип</th><th>Сумма</th><th>Категория</th><th>Велик</th><th>Клиент</th><th>Проверка</th><th>Текст</th></tr></thead>
            <tbody>
              {(data?.recent || []).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.event_date || "-"}</td>
                  <td>{r.stats_kind === "debt_created" ? "📌 долг" : r.sign === "income" ? "🟢 +" : "🔴 -"}</td>
                  <td>{money(r.amount)}</td>
                  <td>{r.category_label || r.category}</td>
                  <td>{r.bike_id ? `#${r.bike_id}` : "-"}</td>
                  <td>{r.client_id ? `#${r.client_id}` : "-"}</td>
                  <td>{r.verification_status || "-"}</td>
                  <td className="small">{r.line_text || r.raw_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
