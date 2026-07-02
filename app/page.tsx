"use client";

import { useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        ready: () => void;
        expand: () => void;
        close: () => void;
      };
    };
  }
}

type BikeCard = {
  id: number;
  bike_label: string;
  brand: string;
  model: string;
  status: string;
  active_rental_id: number | null;
  active_client_id: number | null;
  client_name: string | null;
  client_telegram_id: number | null;
  private_telegram_id: number | null;
  active_price: number | null;
  debt_total: number;
  open_debts: number;
  active_payment_rules: number;
  warnings: string[] | null;
};

type Client = {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  notes?: string | null;
  telegram_id?: number | null;
  active_bike_ids?: number[];
};
type Debt = {
  charge_id: number;
  client_id: number;
  client_name: string;
  bike_id: number | null;
  bike_label: string | null;
  category?: string;
  category_label?: string;
  charge_origin?: string;
  charge_origin_label?: string;
  debt_left: number;
  amount: number;
  paid_amount: number;
  due_date: string;
  status: string;
  is_excluded: boolean;
  overdue_days: number;
  private_telegram_id?: number | null;
  client_telegram_id?: number | null;
  charge_type?: string;
  period_start?: string | null;
  period_end?: string | null;
};
type ExceptionRow = {
  severity: string;
  exception_type: string;
  entity_id: number;
  title: string;
  description: string;
};
type BalanceRow = {
  client_id: number;
  client_name?: string;
  category?: string;
  category_label?: string;
  charged_total: number;
  paid_total?: number;
  paid_on_charges?: number;
  payments_total?: number;
  unallocated_advance?: number;
  open_total?: number;
  open_debt_total?: number;
  overdue_total?: number;
  net_balance?: number;
};
type RuleRequest = {
  id: number;
  client_id: number;
  rental_id: number;
  bike_id: number;
  current_rule_id?: number | null;
  requested_monthly_amount: number;
  requested_parts: Part[];
  reason?: string | null;
  status: string;
  admin_note?: string | null;
  created_at: string;
};

type ClientRequest = {
  id: number;
  client_id: number;
  telegram_id?: number | null;
  request_type: string;
  status: string;
  title?: string | null;
  description?: string | null;
  preferred_date?: string | null;
  admin_note?: string | null;
  created_at: string;
  updated_at?: string | null;
};

type Payment = {
  id: number;
  client_id: number;
  charge_id?: number | null;
  amount: number;
  payment_date: string;
  method?: string | null;
  notes?: string | null;
};

type BikeContext = {
  bike: BikeCard;
  active_rentals: any[];
  charges: Debt[];
  payment_rules: any[];
  batteries: any[];
};

type Part = { due_day: number; amount: number };
type AdminTab =
  "bikes" | "assets" | "health" | "balances" | "finance" | "debts" | "requests" | "exceptions" | "clients";

type AuthMe = {
  telegram_id: number;
  is_admin: boolean;
  user: any;
  client: null | {
    client_id: number;
    client_name: string;
    telegram_id: number;
  };
};

type ClientPayload = {
  client: any;
  active_rentals: any[];
  debts: Debt[];
  balances: BalanceRow[];
  payment_rules: any[];
  requests: RuleRequest[];
  general_requests?: ClientRequest[];
  payments: Payment[];
  finance_stats?: any;
};

type BikeHealth = {
  bike_id: number;
  bike_label: string;
  brand?: string | null;
  model?: string | null;
  bike_status?: string | null;
  active_rental_id?: number | null;
  client_id?: number | null;
  client_name?: string | null;
  current_km: number;
  last_odometer_at?: string | null;
  last_service_km: number;
  last_service_date?: string | null;
  last_service_title?: string | null;
  km_since_service: number;
  km_to_service: number;
  health_status: string;
  health_status_label: string;
  open_task_count: number;
};

type BikeBatteryHealth = {
  bike_id: number;
  battery_id: number;
  brand?: string | null;
  capacity?: string | null;
  generation?: string | null;
  status?: string | null;
  first_used_at?: string | null;
  age_days?: number | null;
  health_status?: string | null;
  health_notes?: string | null;
  attached_at?: string | null;
};

type BikeServiceEvent = {
  id: number;
  bike_id: number;
  event_type: string;
  title: string;
  description?: string | null;
  odometer_km?: number | null;
  cost?: number | null;
  performed_at: string;
};

type BikeMaintenanceTask = {
  id: number;
  bike_id: number;
  task_type: string;
  status: string;
  priority: string;
  current_km?: number | null;
  due_km?: number | null;
  title: string;
  description?: string | null;
};

type BikeHealthPayload = {
  bikes: BikeHealth[];
  batteries: BikeBatteryHealth[];
  service_events: BikeServiceEvent[];
  tasks: BikeMaintenanceTask[];
  odometer_reports?: any[];
};

const CATEGORIES = [
  ["auto", "Авто"],
  ["rent", "Аренда"],
  ["deposit", "Депозит"],
  ["repair", "Ремонт"],
  ["parts", "Запчасти"],
  ["battery", "Батарея"],
  ["charger", "Зарядка"],
  ["fine", "Штраф / компенсация"],
  ["manual", "Ручное"],
  ["other", "Другое"],
];

const ORIGINS = [
  ["all", "Все типы"],
  ["planned", "Фиктивные планы аренды"],
  ["real", "Реальные долги / ручные начисления"],
];

function initData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData || "";
}

function telegramStatus(): string {
  if (typeof window === "undefined") return "server";
  const tg = window.Telegram?.WebApp;
  if (!tg) return "telegram-web-app.js не загружен";
  if (!tg.initData) return "initData нет: открой через кнопку бота в Telegram";
  return "Telegram OK";
}

function apiErrorToText(value: any): string {
  if (!value) return "API error";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "object") {
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": initData(),
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || !json.ok) throw new Error(apiErrorToText(json.error || json));
  return json.data as T;
}

function money(value: unknown) {
  const n = Number(value || 0);
  return `${Math.round(n)} Kč`;
}

function today() {
  // Локальная дата по настройкам устройства админа/клиента, не UTC.
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function inviteParam(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("invite")?.trim().toUpperCase() || "";
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 31;
  return new Date(y, m, 0).getDate();
}

function actualDueDate(month: string, dueDay: number) {
  const [y, m] = month.split("-").map(Number);
  const d = Math.min(Math.max(Number(dueDay || 1), 1), daysInMonth(month));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthParts(month: string) {
  const [year, monthNum] = month.split("-").map(Number);
  return { year, month: monthNum };
}

function WarningPills({ warnings }: { warnings?: string[] | null }) {
  if (!warnings?.length) return <span className="pill ok">OK</span>;
  return (
    <>
      {warnings.map((w) => (
        <span key={w} className="pill warn">
          {w}
        </span>
      ))}
    </>
  );
}

function PartsEditor({
  monthly,
  parts,
  setParts,
  previewMonth,
}: {
  monthly: number;
  parts: Part[];
  setParts: (p: Part[]) => void;
  previewMonth: string;
}) {
  const sum = parts.reduce((s, p) => s + Number(p.amount || 0), 0);
  function preset(count: number) {
    const amount = Math.round(monthly / count);
    const days =
      count === 1
        ? [1]
        : count === 2
          ? [1, 15]
          : count === 4
            ? [1, 8, 15, 22]
            : Array.from({ length: count }, (_, i) =>
                Math.min(1 + i * Math.floor(28 / count), 28),
              );
    setParts(
      days.map((d, idx) => ({
        due_day: d,
        amount:
          idx === days.length - 1
            ? monthly - amount * (days.length - 1)
            : amount,
      })),
    );
  }
  return (
    <>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => preset(1)}>
          1 платёж
        </button>
        <button className="btn" onClick={() => preset(2)}>
          2 части
        </button>
        <button className="btn" onClick={() => preset(4)}>
          4 части
        </button>
        <button
          className="btn"
          onClick={() => setParts([...parts, { due_day: 1, amount: 0 }])}
        >
          + часть
        </button>
      </div>
      <hr className="hr" />
      {parts.map((p, idx) => (
        <div className="formgrid" key={idx} style={{ marginBottom: 8 }}>
          <label>
            День месяца
            <input
              className="input"
              type="number"
              min={1}
              max={31}
              value={p.due_day}
              onChange={(e) =>
                setParts(
                  parts.map((x, i) =>
                    i === idx ? { ...x, due_day: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Сумма
            <input
              className="input"
              type="number"
              value={p.amount}
              onChange={(e) =>
                setParts(
                  parts.map((x, i) =>
                    i === idx ? { ...x, amount: Number(e.target.value) } : x,
                  ),
                )
              }
            />
          </label>
          <div>
            <div className="small muted">
              Факт. дата: {actualDueDate(previewMonth, p.due_day)}
            </div>
            <button
              className="btn danger"
              style={{ marginTop: 6 }}
              onClick={() => setParts(parts.filter((_, i) => i !== idx))}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
      <div className="space">
        <span className={sum < monthly ? "dangerText" : "okText"}>
          Итого {money(sum)} / {money(monthly)}
        </span>
      </div>
      <p className="small muted">
        Дни 29/30/31 автоматически превращаются в последний день короткого
        месяца. Например, 31 февраля станет 28/29.
      </p>
    </>
  );
}

export default function Page() {
  const [toast, setToast] = useState("");
  const [tgStatus, setTgStatus] = useState("loading");
  const [auth, setAuth] = useState<AuthMe | null>(null);
  const [authError, setAuthError] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    setTgStatus(telegramStatus());
    api<AuthMe>("/api/me")
      .then(setAuth)
      .catch((e) => setAuthError(e.message))
      .finally(() => setLoadingAuth(false));
  }, []);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(""), 5200);
  }

  return (
    <main className="app">
      <div className="header">
        <div>
          <div className="title">🚲 Aligator Rent CRM</div>

        </div>
        <div className="badge" title={tgStatus}>
          {tgStatus === "Telegram OK" ? "TG OK" : "TG ?"} ·{" "}
          {auth?.is_admin ? "admin" : "client"}
        </div>
      </div>

      {loadingAuth && <div className="card">Загрузка авторизации...</div>}
      {authError && (
        <div className="card">
          <h3 className="dangerText">Ошибка авторизации</h3>
          <p>{authError}</p>
          <p className="muted">
            Открой через Telegram Mini App кнопку, не прямой ссылкой в браузере.
          </p>
        </div>
      )}
      {auth && auth.is_admin && <AdminApp showToast={showToast} />}
      {auth && !auth.is_admin && <ClientApp showToast={showToast} />}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function AdminApp({ showToast }: { showToast: (s: string) => void }) {
  const [tab, setTab] = useState<AdminTab>("bikes");
  return (
    <>
      <div className="tabs">
        <button
          className={`tab ${tab === "bikes" ? "active" : ""}`}
          onClick={() => setTab("bikes")}
        >
          🚲 Велики
        </button>
        <button
          className={`tab ${tab === "assets" ? "active" : ""}`}
          onClick={() => setTab("assets")}
        >
          🧾 Активы
        </button>
        <button
          className={`tab ${tab === "health" ? "active" : ""}`}
          onClick={() => setTab("health")}
        >
          🧰 Состояние
        </button>
        <button
          className={`tab ${tab === "balances" ? "active" : ""}`}
          onClick={() => setTab("balances")}
        >
          💰 Балансы
        </button>
        <button
          className={`tab ${tab === "finance" ? "active" : ""}`}
          onClick={() => setTab("finance")}
        >
          📊 Стата
        </button>
        <button
          className={`tab ${tab === "debts" ? "active" : ""}`}
          onClick={() => setTab("debts")}
        >
          ⚠️ Долги
        </button>
        <button
          className={`tab ${tab === "requests" ? "active" : ""}`}
          onClick={() => setTab("requests")}
        >
          📝 Запросы
        </button>
        <button
          className={`tab ${tab === "exceptions" ? "active" : ""}`}
          onClick={() => setTab("exceptions")}
        >
          🚨 Исключения
        </button>
        <button
          className={`tab ${tab === "clients" ? "active" : ""}`}
          onClick={() => setTab("clients")}
        >
          👤 Клиенты
        </button>
      </div>
      {tab === "bikes" && <BikesTab showToast={showToast} />}
      {tab === "assets" && <AssetsTab showToast={showToast} />}
      {tab === "health" && <BikeHealthTab showToast={showToast} />}
      {tab === "balances" && <BalancesTab showToast={showToast} />}
      {tab === "finance" && <FinanceLogTab showToast={showToast} />}
      {tab === "debts" && <DebtsTab showToast={showToast} />}
      {tab === "requests" && <RuleRequestsTab showToast={showToast} />}
      {tab === "exceptions" && <ExceptionsTab />}
      {tab === "clients" && <ClientsTab showToast={showToast} />}
    </>
  );
}

function AdminMenuTab({ setTab }: { setTab: (tab: AdminTab) => void }) {
  const migrated = [
    ["🚲 Велики / найти велик", "bikes", "поиск, карточка велика, аренда, батареи, правило оплаты"],
    ["🧰 Состояние велика / пробег / ТО", "health", "пробег, последние ремонты, батареи, задачи ТО"],
    ["💰 Финансы / оплаты / долги", "balances", "баланс клиента, ручная оплата, начисления"],
    ["⚠️ Должники / долги", "debts", "фильтры, rent_plan, реальные долги, закрытие планов"],
    ["🔑 Ключи / клиенты", "clients", "создание ссылки входа через Telegram-бота"],
    ["📝 Запросы клиентов", "requests", "подтверждение изменений правила оплаты"],
    ["🚨 Исключения", "exceptions", "места, где учёт может врать"],
  ] as const;
  const pending = [
    "🛠 сервисные заявки / ремонты",
    "💸 рабочие расходы и постоянные расходы",
    "🧩 прайс услуг / пакеты ТО / мойка",
    "📢 массовые уведомления",
  ];
  return (
    <div className="grid">
      <div className="card">
        <h3>🧭 Старое меню бота перенесено сюда</h3>
        <p className="muted">
          Бот теперь должен быть только входом и быстрым выводом. Основной ввод — через Mini App.
          Старые кнопки из Telegram-клавиатуры убраны из бота, чтобы не было двух разных интерфейсов.
        </p>
        <div className="list">
          {migrated.map(([label, tab, description]) => (
            <button key={label} className="item" onClick={() => setTab(tab as AdminTab)}>
              <div className="space"><b>{label}</b><span className="pill ok">в Mini App</span></div>
              <div className="small muted">{description}</div>
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>⏳ Ещё надо перенести позже</h3>
        <p className="muted">Эти блоки лучше переносить отдельным патчем, чтобы не сломать аренду и оплаты.</p>
        <div className="list">
          {pending.map((x) => <div className="item warn" key={x}>{x}</div>)}
        </div>
      </div>
    </div>
  );
}


function statusPillClass(status?: string) {
  if (status === "needs_service") return "danger";
  if (status === "soon_service" || status === "km_old" || status === "no_km") return "warn";
  return "ok";
}

function shortDate(value?: string | null) {
  if (!value) return "-";
  return String(value).slice(0, 10);
}

function roundKm(value: unknown) {
  return `${Math.round(Number(value || 0))} км`;
}

function BikeHealthTab({ showToast }: { showToast: (s: string) => void }) {
  const [payload, setPayload] = useState<BikeHealthPayload>({ bikes: [], batteries: [], service_events: [], tasks: [] });
  const [q, setQ] = useState("");
  const [health, setHealth] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (health !== "all") params.set("health", health);
      const data = await api<BikeHealthPayload>(`/api/admin/bike-health?${params.toString()}`);
      setPayload(data);
      if (!selected && data.bikes[0]) setSelected(data.bikes[0].bike_id);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [health]);

  async function saveBulk() {
    const rows = bulkText.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    if (!rows.length) return showToast("Вставь строки вида 24: 1840");
    const results: string[] = [];
    for (const row of rows.slice(0, 80)) {
      const m = row.match(/#?(\d+)\s*[:=\- ]\s*(\d+(?:[.,]\d+)?)/);
      if (!m) {
        results.push(`❌ ${row}: не понял`);
        continue;
      }
      const bike_id = Number(m[1]);
      const odometer_km = Number(m[2].replace(",", "."));
      try {
        await api("/api/admin/bike-health/report", {
          method: "POST",
          body: JSON.stringify({ bike_id, odometer_km, notes: "bulk admin km form" }),
        });
        results.push(`✅ #${bike_id}: ${odometer_km} км`);
      } catch (e: any) {
        results.push(`❌ #${bike_id}: ${e.message}`);
      }
    }
    showToast(results.slice(0, 8).join(" · ") + (results.length > 8 ? " ..." : ""));
    setBulkText("");
    await load();
  }

  const selectedBike = payload.bikes.find((b) => b.bike_id === selected) || payload.bikes[0] || null;
  const serviceEvents = selectedBike ? payload.service_events.filter((e) => e.bike_id === selectedBike.bike_id) : [];
  const batteries = selectedBike ? payload.batteries.filter((b) => b.bike_id === selectedBike.bike_id) : [];
  const tasks = selectedBike ? payload.tasks.filter((t) => t.bike_id === selectedBike.bike_id) : [];

  return (
    <div className="grid">
      <div className="card">
        <h3 className="section-title">🧰 Состояние великов</h3>
        <p className="muted small">Пока это ручной учёт: пробег, ТО, ремонты и батареи. Roapp.io можно будет подключить позже как источник ремонтов.</p>
        <div className="row">
          <input className="input" placeholder="Поиск #24, Duotts, Engwe" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load().catch((er) => showToast(er.message))} />
          <select className="select" value={health} onChange={(e) => setHealth(e.target.value)}>
            <option value="all">Все состояния</option>
            <option value="needs_service">Нужно ТО</option>
            <option value="soon_service">Скоро ТО</option>
            <option value="km_old">Пробег устарел</option>
            <option value="no_km">Нет пробега</option>
            <option value="ok">OK</option>
          </select>
          <button className="btn primary" onClick={() => load().catch((e) => showToast(e.message))}>{loading ? "..." : "Обновить"}</button>
        </div>
        <hr className="hr" />
        <div className="list">
          {payload.bikes.map((b) => (
            <button key={b.bike_id} className={`item ${selectedBike?.bike_id === b.bike_id ? "active" : ""}`} onClick={() => setSelected(b.bike_id)}>
              <div className="space"><b>{b.bike_label}</b><span className={`pill ${statusPillClass(b.health_status)}`}>{b.health_status_label}</span></div>
              <div className="small muted">{b.client_name || "без active клиента"} · {roundKm(b.current_km)} · после ТО {roundKm(b.km_since_service)}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="card">
          <h3>Массовый ввод пробега</h3>
          <p className="small muted">Формат: <span className="code">24: 1840</span> или <span className="code">25 920</span>, каждая строка отдельно.</p>
          <textarea className="textarea" value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={"24: 1840\n25: 920\n31: 3100"} />
          <button className="btn ok" onClick={saveBulk}>Сохранить пробег по списку</button>
        </div>
        {selectedBike ? (
          <BikeHealthCard
            bike={selectedBike}
            batteries={batteries}
            serviceEvents={serviceEvents}
            tasks={tasks}
            reload={load}
            showToast={showToast}
          />
        ) : (
          <div className="card">Выбери велик слева.</div>
        )}
      </div>
    </div>
  );
}

function BikeHealthCard({
  bike,
  batteries,
  serviceEvents,
  tasks,
  reload,
  showToast,
}: {
  bike: BikeHealth;
  batteries: BikeBatteryHealth[];
  serviceEvents: BikeServiceEvent[];
  tasks: BikeMaintenanceTask[];
  reload: () => Promise<void>;
  showToast: (s: string) => void;
}) {
  const [km, setKm] = useState(Math.round(Number(bike.current_km || 0)) || "");
  const [serviceTitle, setServiceTitle] = useState("Простое ТО");
  const [serviceType, setServiceType] = useState("service");
  const [serviceCost, setServiceCost] = useState(0);
  const [serviceDescription, setServiceDescription] = useState("");
  const [batteryIds, setBatteryIds] = useState("");
  const [batteryNotes, setBatteryNotes] = useState("");

  useEffect(() => {
    setKm(Math.round(Number(bike.current_km || 0)) || "");
    setBatteryIds(batteries.map((b) => b.battery_id).join(", "));
  }, [bike.bike_id, bike.current_km, batteries.map((b) => b.battery_id).join(",")]);

  async function saveKm() {
    await api("/api/admin/bike-health/report", {
      method: "POST",
      body: JSON.stringify({ bike_id: bike.bike_id, odometer_km: Number(km), notes: "admin bike health card" }),
    });
    showToast("Пробег сохранён");
    await reload();
  }

  async function saveService() {
    await api("/api/admin/bike-health/service", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.bike_id,
        odometer_km: Number(km || bike.current_km || 0),
        title: serviceTitle,
        event_type: serviceType,
        cost: serviceCost,
        description: serviceDescription,
      }),
    });
    showToast("Сервис/ремонт сохранён");
    setServiceDescription("");
    await reload();
  }

  async function linkBatteries() {
    await api("/api/admin/bike-health/battery", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.bike_id,
        battery_ids: batteryIds,
        health_status: "unknown",
        notes: batteryNotes || null,
      }),
    });
    showToast("Батареи привязаны к велику");
    setBatteryNotes("");
    await reload();
  }

  return (
    <>
      <div className="card">
        <div className="space">
          <h2 className="section-title">{bike.bike_label}</h2>
          <span className={`pill ${statusPillClass(bike.health_status)}`}>{bike.health_status_label}</span>
        </div>
        <div className="kv">
          <div>Пробег сейчас</div><div><b>{roundKm(bike.current_km)}</b></div>
          <div>Последний сервис</div><div>{roundKm(bike.last_service_km)} / {shortDate(bike.last_service_date)}</div>
          <div>После сервиса</div><div>{roundKm(bike.km_since_service)}</div>
          <div>До ТО осталось</div><div>{roundKm(bike.km_to_service)}</div>
          <div>Клиент</div><div>{bike.client_name || "-"}</div>
          <div>Последний пробег</div><div>{shortDate(bike.last_odometer_at)}</div>
          <div>Открытые задачи</div><div>{tasks.length ? <span className="warnText">{tasks.length}</span> : <span className="okText">нет</span>}</div>
        </div>
      </div>

      <div className="card">
        <h3>✏️ Ручное редактирование</h3>
        <div className="formgrid">
          <label>Текущий пробег, км<input className="input" type="number" value={km} onChange={(e) => setKm(e.target.value ? Number(e.target.value) : "")} /></label>
          <label>Тип события<select className="select" value={serviceType} onChange={(e) => setServiceType(e.target.value)}><option value="service">ТО / сервис</option><option value="repair">Ремонт</option><option value="brakes">Тормоза</option><option value="tire">Колесо / камера</option><option value="battery_replace">Замена батареи</option><option value="other">Другое</option></select></label>
          <label>Название<input className="input" value={serviceTitle} onChange={(e) => setServiceTitle(e.target.value)} placeholder="Простое ТО / тормоза / камера" /></label>
          <label>Стоимость<input className="input" type="number" value={serviceCost} onChange={(e) => setServiceCost(Number(e.target.value || 0))} /></label>
        </div>
        <textarea className="textarea" value={serviceDescription} onChange={(e) => setServiceDescription(e.target.value)} placeholder="Комментарий: что заменили, что проверить, состояние" />
        <div className="row">
          <button className="btn primary" onClick={saveKm}>Сохранить только пробег</button>
          <button className="btn ok" onClick={saveService}>Записать сервис/ремонт</button>
        </div>
      </div>

      <div className="card">
        <h3>Последние ремонты / сервис</h3>
        <div className="list">
          {serviceEvents.length ? serviceEvents.slice(0, 8).map((e) => (
            <div className="item" key={e.id}>
              <div className="space"><b>{shortDate(e.performed_at)} · {e.title}</b><span className="pill">{e.event_type}</span></div>
              <div className="small muted">{e.odometer_km != null ? roundKm(e.odometer_km) : "км не указан"} · {money(e.cost || 0)}</div>
              {e.description && <div className="small">{e.description}</div>}
            </div>
          )) : <p className="muted">Пока нет событий. Можно создать вручную выше.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Батареи</h3>
        <div className="formgrid">
          <label>ID батарей<input className="input" value={batteryIds} onChange={(e) => setBatteryIds(e.target.value)} placeholder="1, 2" /></label>
          <label>Заметка по батареям<input className="input" value={batteryNotes} onChange={(e) => setBatteryNotes(e.target.value)} placeholder="выданы с великом / проверить" /></label>
        </div>
        <button className="btn primary" onClick={linkBatteries}>Привязать батареи к этому велику</button>
        <hr className="hr" />
        <div className="list">
          {batteries.length ? batteries.map((b) => (
            <div className="item" key={b.battery_id}>
              <div className="space"><b>Батарея #{b.battery_id}</b><span className="pill">{b.status || "unknown"}</span></div>
              <div className="small muted">{[b.brand, b.capacity, b.generation].filter(Boolean).join(" · ") || "тип не указан"}</div>
              <div className="small muted">Возраст: {b.age_days ?? 0} дн. · дата выдачи/создания: {shortDate(b.first_used_at)}</div>
              <div className="small">Состояние: {b.health_status || "unknown"}{b.health_notes ? ` · ${b.health_notes}` : ""}</div>
            </div>
          )) : <p className="muted">Батареи пока не привязаны к этому велику.</p>}
        </div>
      </div>
    </>
  );
}

function BikesTab({ showToast }: { showToast: (s: string) => void }) {
  const [bikes, setBikes] = useState<BikeCard[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [ctx, setCtx] = useState<BikeContext | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadBikes() {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (status !== "all") params.set("status", status);
    setBikes(await api<BikeCard[]>(`/api/admin/bikes?${params.toString()}`));
  }
  async function loadContext(id: number) {
    setSelected(id);
    setLoading(true);
    try {
      setCtx(await api<BikeContext>(`/api/admin/bikes/${id}/context`));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    loadBikes().catch((e) => showToast(e.message));
  }, [status]);

  return (
    <div className="grid">
      <div className="card">
        <h3 className="section-title">Выбор велика</h3>
        <div className="row">
          <input
            className="input"
            placeholder="Поиск #id, бренд, модель"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              loadBikes().catch((er) => showToast(er.message))
            }
          />
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">Все статусы</option>
            <option value="rented">rented</option>
            <option value="free">free</option>
            <option value="sold">sold</option>
            <option value="waiting">waiting</option>
            <option value="repair">repair</option>
          </select>
          <button
            className="btn primary"
            onClick={() => loadBikes().catch((e) => showToast(e.message))}
          >
            Обновить
          </button>
        </div>
        <hr className="hr" />
        <div className="list">
          {bikes.map((b) => (
            <button
              key={b.id}
              className={`item ${selected === b.id ? "active" : ""} ${(b.warnings || []).length ? "warn" : ""}`}
              onClick={() =>
                loadContext(b.id).catch((e) => showToast(e.message))
              }
            >
              <div className="space">
                <b>{b.bike_label}</b>
                <span className="pill">{b.status}</span>
              </div>
              <div className="small muted">
                {b.client_name
                  ? `Клиент: ${b.client_name}`
                  : "Без active клиента"}{" "}
                · долг {money(b.debt_total)}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                <WarningPills warnings={b.warnings} />
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {!selected && (
          <div className="card">
            <h3>Выбери велик слева</h3>
            <p className="muted">
              После выбора Mini App подтянет аренду, клиента, долги, батареи,
              Telegram и правило оплаты.
            </p>
          </div>
        )}
        {loading && <div className="card">Загрузка...</div>}
        {ctx && !loading && (
          <BikeContextPanel
            ctx={ctx}
            reload={() => loadContext(ctx.bike.id)}
            showToast={showToast}
          />
        )}
      </div>
    </div>
  );
}

function BikeContextPanel({
  ctx,
  reload,
  showToast,
}: {
  ctx: BikeContext;
  reload: () => Promise<void>;
  showToast: (s: string) => void;
}) {
  const active = ctx.active_rentals[0];
  return (
    <>
      <div className="card">
        <div className="space">
          <h2 className="section-title">{ctx.bike.bike_label}</h2>
          <span className="pill">{ctx.bike.status}</span>
        </div>
        <div className="row">
          <WarningPills warnings={ctx.bike.warnings} />
        </div>
        <hr className="hr" />
        <div className="kv">
          <div>Active rental</div>
          <div>
            {active ? `#${active.id}` : <span className="warnText">нет</span>}
          </div>
          <div>Клиент</div>
          <div>
            {active ? `#${active.client_id} ${active.client_name}` : "-"}
          </div>
          <div>Telegram</div>
          <div>
            {active
              ? active.private_telegram_id ||
                active.client_telegram_id || (
                  <span className="dangerText">не привязан</span>
                )
              : "-"}
          </div>
          <div>Цена</div>
          <div>{active ? money(active.price) : "-"}</div>
          <div>Долг</div>
          <div className="money">
            {money(ctx.bike.debt_total)} / {ctx.bike.open_debts} начисл.
          </div>
          <div>Батареи</div>
          <div>
            {ctx.batteries.length
              ? ctx.batteries.map((b) => `#${b.id}`).join(", ")
              : "-"}
          </div>
          <div>Правила оплаты</div>
          <div>
            {ctx.payment_rules.length ? (
              ctx.payment_rules
                .map((r) => `#${r.id} ${r.is_active ? "active" : "off"}`)
                .join(", ")
            ) : (
              <span className="warnText">нет</span>
            )}
          </div>
        </div>
      </div>
      <BikeDebtBlock
        debts={ctx.charges}
        showToast={showToast}
        reload={reload}
      />
      <PaymentRuleBlock
        bike={ctx.bike}
        active={active}
        showToast={showToast}
        reload={reload}
      />
      <RentalActionsBlock
        bike={ctx.bike}
        active={active}
        showToast={showToast}
        reload={reload}
      />
      <LinkBlock active={active} showToast={showToast} reload={reload} />
    </>
  );
}

function BikeDebtBlock({
  debts,
  showToast,
  reload,
}: {
  debts: Debt[];
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(
    () =>
      setSelected(debts.filter((d) => !d.is_excluded).map((d) => d.charge_id)),
    [debts],
  );
  const total = debts
    .filter((d) => selected.includes(d.charge_id))
    .reduce((s, d) => s + Number(d.debt_left), 0);
  function toggle(id: number) {
    setSelected((x) =>
      x.includes(id) ? x.filter((i) => i !== id) : [...x, id],
    );
  }
  async function closePlan(createPayment: boolean) {
    if (!selected.length) return showToast("Ничего не выбрано");
    const res = await api<any>("/api/admin/debts/bulk-close-plan", {
      method: "POST",
      body: JSON.stringify({
        charge_ids: selected,
        create_payment: createPayment,
        payment_date: today(),
        method: createPayment ? "manual_plan_close" : "plan_only",
        note: createPayment
          ? "manual close planned rent with payment from bike card"
          : "manual close planned rent without payment from bike card",
      }),
    });
    showToast(
      createPayment
        ? `План закрыт + оплаты: ${res.paid_ids?.length || 0}, оплат ${res.payment_ids?.length || 0}, пропущено ${res.skipped_ids?.length || 0}`
        : `План закрыт без оплат: ${res.closed_ids?.length || 0}, пропущено ${res.skipped_ids?.length || 0}`,
    );
    await reload();
  }
  async function paid() {
    if (!selected.length) return showToast("Ничего не выбрано");
    if (
      !confirm(
        `Записать РЕАЛЬНУЮ оплату по выбранным долгам на ${money(total)}? Будут созданы client_payments.`,
      )
    )
      return;
    await api("/api/admin/debts/bulk-paid", {
      method: "POST",
      body: JSON.stringify({
        charge_ids: selected,
        method: "manual",
        payment_date: today(),
        note: "real payment from bike card",
      }),
    });
    showToast("Реальные оплаты записаны");
    await reload();
  }
  async function exclude() {
    if (!selected.length) return showToast("Ничего не выбрано");
    const reason = prompt(
      "Причина исключения из Mini App списка долгов",
      "дубль / ошибочное начисление / проверить вручную",
    );
    if (!reason) return;
    await api("/api/admin/debts/bulk-exclude", {
      method: "POST",
      body: JSON.stringify({ charge_ids: selected, reason }),
    });
    showToast("Исключено");
    await reload();
  }
  async function remind() {
    if (!selected.length) return showToast("Ничего не выбрано");
    const res = await api<any>("/api/admin/debts/bulk-remind", {
      method: "POST",
      body: JSON.stringify({ charge_ids: selected }),
    });
    showToast(
      `Напоминания: отправлено ${res.sent?.length || 0}, пропущено ${res.skipped?.length || 0}`,
    );
  }
  return (
    <div className="card">
      <div className="space">
        <h3 className="section-title">⚠️ Долги велика</h3>
        <span className="money">выбрано {money(total)}</span>
      </div>
      <div className="row">
        <button
          className="btn"
          onClick={() =>
            setSelected(
              debts.filter((d) => !d.is_excluded).map((d) => d.charge_id),
            )
          }
        >
          Выбрать все
        </button>
        <button className="btn" onClick={() => setSelected([])}>
          Снять все
        </button>
        <button className="btn ok" onClick={() => closePlan(false)}>
          ✅ Закрыть план без оплаты
        </button>
        <button className="btn primary" onClick={() => closePlan(true)}>
          💵 Закрыть план + создать оплату
        </button>
        <button className="btn primary" onClick={paid}>
          💵 Оплата по выбранным долгам
        </button>
        <button className="btn warn" onClick={remind}>
          📢 Напомнить
        </button>
        <button className="btn danger" onClick={exclude}>
          🙈 Исключить
        </button>
      </div>
      <p className="small muted">
        Плановые долги закрываются явным действием: отдельная кнопка без оплаты и отдельная кнопка с созданием client_payments.
        Автоматическая смена правила оплаты старые оплаты не создаёт.
      </p>
      <hr className="hr" />
      {!debts.length && <p className="muted">Открытых долгов нет.</p>}
      {debts.length > 0 && (
        <DebtTable debts={debts} selected={selected} toggle={toggle} />
      )}
    </div>
  );
}

function DebtTable({
  debts,
  selected,
  toggle,
}: {
  debts: Debt[];
  selected: number[];
  toggle: (id: number) => void;
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th>Категория</th>
          <th>Тип</th>
          <th>Дата</th>
          <th>Сумма</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {debts.map((d) => (
          <tr key={d.charge_id} className={d.is_excluded ? "muted" : ""}>
            <td>
              <input
                className="check"
                type="checkbox"
                checked={selected.includes(d.charge_id)}
                onChange={() => toggle(d.charge_id)}
                disabled={d.is_excluded}
              />
            </td>
            <td>
              #{d.charge_id}
              <br />
              <span className="small muted">{d.charge_type}</span>
            </td>
            <td>{d.category_label || d.category || "-"}</td>
            <td>
              {d.charge_origin === "planned" ? (
                <span className="pill warn">план</span>
              ) : (
                <span className="pill ok">реал</span>
              )}
              <br />
              <span className="small muted">{d.charge_origin_label || ""}</span>
            </td>
            <td>
              {d.due_date}
              <br />
              <span className="small dangerText">{d.overdue_days} дн.</span>
            </td>
            <td>
              {money(d.debt_left)}
              <br />
              <span className="small muted">из {money(d.amount)}</span>
            </td>
            <td>
              {d.is_excluded ? (
                <span className="pill warn">excluded</span>
              ) : (
                <span className="pill">{d.status}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaymentRuleBlock({
  bike,
  active,
  showToast,
  reload,
}: {
  bike: BikeCard;
  active: any;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [monthly, setMonthly] = useState<number>(
    Number(active?.price || bike.active_price || 6000),
  );
  const [parts, setParts] = useState<Part[]>([
    { due_day: 1, amount: Number(active?.price || bike.active_price || 6000) },
  ]);
  const [month, setMonth] = useState(currentMonth());
  const [allowClientEdit, setAllowClientEdit] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [note, setNote] = useState("");
  const sum = parts.reduce((s, p) => s + Number(p.amount || 0), 0);
  async function save() {
    if (!active) return showToast("У велика нет active-аренды");
    await api("/api/admin/payment-rules", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.id,
        monthly_amount: monthly,
        parts,
        allow_client_edit: allowClientEdit,
        requires_admin_approval: requiresApproval,
        note: note || "created from Mini App",
      }),
    });
    showToast(
      "Правило сохранено; старые неоплаченные фиктивные планы этой аренды удалены",
    );
    await reload();
  }
  async function generateMonth() {
    if (!active) return showToast("У велика нет active-аренды");
    const mp = monthParts(month);
    const res = await api<any>("/api/admin/payment-rules/generate-month", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.id,
        year: mp.year,
        month: mp.month,
      }),
    });
    showToast(
      `Начисления: создано ${res.created_count}, уже было ${res.existing_count}`,
    );
    await reload();
  }
  return (
    <div className="card">
      <h3 className="section-title">⚙️ Правило оплаты</h3>
      {!active && (
        <p className="dangerText">
          Нет active-аренды — правило создать нельзя.
        </p>
      )}
      <div className="formgrid">
        <label>
          Месячная сумма
          <input
            className="input"
            type="number"
            value={monthly}
            onChange={(e) => setMonthly(Number(e.target.value))}
          />
        </label>
        <label>
          Месяц предпросмотра / начисления
          <input
            className="input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      <PartsEditor
        monthly={monthly}
        parts={parts}
        setParts={setParts}
        previewMonth={month}
      />
      <label>
        Заметка / причина изменения
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="например: клиент уже оплатил 4000, остаток переносим"
        />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <label className="row small">
          <input
            type="checkbox"
            checked={allowClientEdit}
            onChange={(e) => setAllowClientEdit(e.target.checked)}
          />{" "}
          клиент может запросить изменение
        </label>
        <label className="row small">
          <input
            type="checkbox"
            checked={requiresApproval}
            onChange={(e) => setRequiresApproval(e.target.checked)}
          />{" "}
          только после подтверждения админа
        </label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!active || sum < monthly}
          onClick={save}
        >
          Сохранить план
        </button>
        <button className="btn warn" disabled={!active} onClick={generateMonth}>
          Создать фиктивные долги месяца
        </button>
      </div>
      <p className="small muted">
        Правило = план. При смене правила удаляются только старые НЕОПЛАЧЕННЫЕ
        фиктивные rent_plan-долги этой аренды. Реальные ремонты/депозиты/ручные
        начисления и уже закрытые строки не трогаются.
      </p>
    </div>
  );
}

function RentalActionsBlock({
  bike,
  active,
  showToast,
  reload,
}: {
  bike: BikeCard;
  active: any;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [price, setPrice] = useState(
    String(active?.price || bike.active_price || 6000),
  );
  const [start, setStart] = useState(today());
  const [deposit, setDeposit] = useState(String(active?.deposit || 0));
  const [chargers, setChargers] = useState(
    String(active?.charger_quantity || 1),
  );
  const [notes, setNotes] = useState("");
  const [closeStatus, setCloseStatus] = useState("free");
  useEffect(() => {
    api<Client[]>("/api/admin/clients")
      .then(setClients)
      .catch(() => null);
  }, []);
  async function create() {
    await api("/api/admin/rentals/new", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.id,
        client_id: Number(clientId),
        price: Number(price),
        start_date: start,
        deposit: Number(deposit),
        charger_quantity: Number(chargers),
        rental_type: "monthly",
        notes,
      }),
    });
    showToast("Аренда создана");
    await reload();
  }
  async function close() {
    if (!confirm(`Закрыть active-аренду велика #${bike.id}?`)) return;
    await api("/api/admin/rentals/close", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.id,
        end_date: today(),
        bike_status: closeStatus,
        notes,
      }),
    });
    showToast("Аренда закрыта");
    await reload();
  }
  async function replace() {
    if (
      !confirm(`Переоформить велик #${bike.id} на нового клиента #${clientId}?`)
    )
      return;
    await api("/api/admin/rentals/replace", {
      method: "POST",
      body: JSON.stringify({
        bike_id: bike.id,
        new_client_id: Number(clientId),
        price: Number(price),
        start_date: start,
        deposit: Number(deposit),
        charger_quantity: Number(chargers),
        rental_type: "monthly",
        notes,
      }),
    });
    showToast("Новый договор создан");
    await reload();
  }
  return (
    <div className="card">
      <h3 className="section-title">📄 Аренда</h3>
      <div className="formgrid">
        <label>
          Клиент
          <select
            className="select"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            <option value="">выбери клиента</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.id} {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Цена
          <input
            className="input"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
        <label>
          Дата начала
          <input
            className="input"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Депозит
          <input
            className="input"
            type="number"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
          />
        </label>
        <label>
          Зарядки
          <input
            className="input"
            type="number"
            value={chargers}
            onChange={(e) => setChargers(e.target.value)}
          />
        </label>
        <label>
          Статус после закрытия
          <select
            className="select"
            value={closeStatus}
            onChange={(e) => setCloseStatus(e.target.value)}
          >
            <option value="free">free</option>
            <option value="sold">sold</option>
            <option value="repair">repair</option>
            <option value="waiting">waiting</option>
          </select>
        </label>
      </div>
      <label>
        Заметка
        <textarea
          className="textarea"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!!active || !clientId}
          onClick={create}
        >
          ➕ Новая аренда
        </button>
        <button className="btn warn" disabled={!active} onClick={close}>
          📄 Закрыть аренду
        </button>
        <button
          className="btn primary"
          disabled={!active || !clientId}
          onClick={replace}
        >
          ♻️ Новый договор
        </button>
      </div>
    </div>
  );
}

function LinkBlock({
  active,
  showToast,
  reload,
}: {
  active: any;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [telegramId, setTelegramId] = useState("");
  const [invite, setInvite] = useState<any>(null);
  const [inviteError, setInviteError] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);

  async function copyText(text: string, label = "Скопировано") {
    try {
      await navigator.clipboard?.writeText(text);
      showToast(label);
    } catch {
      window.prompt("Скопируй вручную", text);
    }
  }

  async function link() {
    if (!active) return showToast("Нет active клиента");
    try {
      await api("/api/admin/link-telegram", {
        method: "POST",
        body: JSON.stringify({
          client_id: active.client_id,
          telegram_id: Number(telegramId),
        }),
      });
      showToast("Telegram привязан");
      await reload();
    } catch (e: any) {
      showToast(e.message || "Ошибка привязки Telegram");
    }
  }

  async function createInvite(clientId: number | null) {
    if (!clientId) {
      setInviteError("Нет active клиента: сначала выбери велик с активной арендой или создай аренду.");
      return;
    }
    setInvite(null);
    setInviteError("");
    setInviteLoading(true);
    try {
      const data = await api<any>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({
          client_id: clientId,
          notes: "client entry link from admin miniapp",
        }),
      });
      setInvite(data);
      await copyText(data.link, "Ссылка создана и скопирована");
    } catch (e: any) {
      const message = e.message || "Не получилось создать ключ";
      setInviteError(message);
      showToast(message);
    } finally {
      setInviteLoading(false);
    }
  }

  return (
    <div className="card">
      <h3 className="section-title">🔗 Telegram / вход клиента</h3>
      <p className="small muted">
        Ключ — это ссылка в Telegram-бота для уже существующего клиента. После перехода бот должен обработать <span className="code">/start KEY</span>, привязать Telegram ID и дать кнопку входа в клиентский Mini App.
      </p>
      {!active && <p className="dangerText">Нет active-аренды — ссылку входа создать нельзя.</p>}
      {active && (
        <p className="small muted">
          Active клиент: #{active.client_id} {active.client_name || ""}
        </p>
      )}
      <div className="formgrid">
        <label>
          Telegram ID
          <input
            className="input"
            value={telegramId}
            onChange={(e) => setTelegramId(e.target.value)}
            placeholder="123456789"
          />
        </label>
        <button
          className="btn primary"
          disabled={!active || !telegramId}
          onClick={link}
        >
          Привязать к active клиенту
        </button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!active || inviteLoading}
          onClick={() => createInvite(active?.client_id || null)}
        >
          {inviteLoading ? "Создаю..." : "🔑 Создать ссылку входа для active клиента"}
        </button>
      </div>
      {inviteError && <p className="dangerText">{inviteError}</p>}
      {invite && (
        <div className="item ok" style={{ marginTop: 10 }}>
          <div className="space">
            <b>Ссылка создана</b>
            <span className="pill ok">active</span>
          </div>
          <div>
            Клиент: <span className="code">#{invite.client_id || active?.client_id}</span>
          </div>
          <div>
            Ключ: <span className="code">{invite.invite_key}</span>
          </div>
          <div className="small muted" style={{ wordBreak: "break-all" }}>{invite.link}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => copyText(invite.link, "Ссылка скопирована")}>
              Скопировать ссылку
            </button>
            <button className="btn" onClick={() => copyText(invite.invite_key, "Ключ скопирован")}>
              Скопировать ключ
            </button>
            <a className="btn" href={invite.link} target="_blank" rel="noreferrer">
              Открыть https
            </a>
            {invite.tg_link && (
              <a className="btn" href={invite.tg_link}>
                Открыть tg://
              </a>
            )}
          </div>
          <p className="small muted">
            Если при переходе бот ничего не отвечает — это не ошибка Mini App. Нужно обновить VPS-бот: обработчик <span className="code">/start KEY</span> должен искать ключ в <span className="code">contract_invites</span> и присылать клиентскую кнопку входа.
          </p>
        </div>
      )}
    </div>
  );
}

function BalancesTab({ showToast }: { showToast: (s: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [ledger, setLedger] = useState<any>(null);
  async function loadClients() {
    setClients(
      await api<Client[]>(`/api/admin/clients?q=${encodeURIComponent(q)}`),
    );
  }
  async function loadLedger(id: number) {
    setSelected(id);
    setLedger(await api<any>(`/api/admin/clients/${id}/ledger`));
  }
  async function allocateAllAdvances() {
    const res = await api<any>("/api/admin/clients/allocate-advance-all", { method: "POST" });
    showToast(`Авансы пересчитаны: ${money(res?.allocated_amount || 0)} / клиентов ${res?.clients_count || 0}`);
    if (selected) await loadLedger(selected);
  }
  useEffect(() => {
    loadClients().catch((e) => showToast(e.message));
  }, []);
  return (
    <div className="grid">
      <div className="card">
        <h3>💰 Балансы клиентов</h3>
        <div className="row">
          <input
            className="input"
            placeholder="поиск клиента"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              loadClients().catch((er) => showToast(er.message))
            }
          />
          <button
            className="btn"
            onClick={() => loadClients().catch((e) => showToast(e.message))}
          >
            Найти
          </button>
          <button className="btn primary" onClick={() => allocateAllAdvances().catch((e) => showToast(e.message))}>
            🔁 Пересчитать авансы всем
          </button>
        </div>
        <hr className="hr" />
        <div className="list">
          {clients.map((c) => (
            <button
              className={`item ${selected === c.id ? "active" : ""}`}
              key={c.id}
              onClick={() =>
                loadLedger(c.id).catch((e) => showToast(e.message))
              }
            >
              <b>
                #{c.id} {c.name}
              </b>
              <div className="small muted">
                📞 {c.phone || "-"} · 📧 {c.email || "-"}
              </div>
              <div className="small muted">
                🏠 {c.address || "адрес не заполнен"}
              </div>
              <div className="small muted">
                🪪 {c.doc_type || "документ"}: {c.doc_number || "номер не заполнен"} · bikes{" "}
                {(c.active_bike_ids || []).join(", ") || "-"}
              </div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {ledger ? (
          <LedgerPanel
            ledger={ledger}
            showToast={showToast}
            reload={() => (selected ? loadLedger(selected) : Promise.resolve())}
          />
        ) : (
          <div className="card">
            <h3>Выбери клиента</h3>
            <p className="muted">
              Тут видно общий баланс: сколько начислено, сколько оплачено, аванс
              и долг по категориям.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LedgerPanel({
  ledger,
  showToast,
  reload,
}: {
  ledger: any;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const summary = ledger.summary || {};
  const [allocating, setAllocating] = useState(false);
  async function allocateAdvance() {
    if (!ledger.client?.id) return;
    setAllocating(true);
    try {
      const res = await api<any>(`/api/admin/clients/${ledger.client.id}/allocate-advance`, {
        method: "POST",
        body: JSON.stringify({ category: "auto" }),
      });
      showToast(`Аванс распределён: ${money(res?.allocated_amount || 0)}`);
      await reload();
    } catch (e: any) {
      showToast(e.message || "Не удалось распределить аванс");
    } finally {
      setAllocating(false);
    }
  }
  return (
    <>
      <div className="card">
        <h2 className="section-title">
          #{ledger.client?.id} {ledger.client?.name}
        </h2>
        <div className="kv">
          <div>Начислено</div>
          <div>{money(summary.charged_total)}</div>
          <div>Оплачено всего</div>
          <div>{money(summary.payments_total)}</div>
          <div>Аванс / нераспределено</div>
          <div className="okText">{money(summary.unallocated_advance)}</div>
          <div>Открытый долг</div>
          <div className="dangerText">{money(summary.open_debt_total)}</div>
          <div>Баланс</div>
          <div
            className={
              Number(summary.net_balance) >= 0 ? "okText" : "dangerText"
            }
          >
            {money(summary.net_balance)}
          </div>
        </div>
        {Number(summary.unallocated_advance || 0) > 0 && Number(summary.open_debt_total || 0) > 0 && (
          <div className="notice" style={{ marginTop: 12 }}>
            <b>Есть аванс и открытый долг одновременно.</b>
            <div className="small muted">Нажми кнопку, чтобы связать старые оплаты с открытыми начислениями и обнулить долг/аванс где возможно.</div>
            <button className="btn primary" onClick={allocateAdvance} disabled={allocating}>
              {allocating ? "Распределяю..." : "🔁 Списать долг авансом"}
            </button>
          </div>
        )}
      </div>
      <ClientFinanceStatsBlock stats={ledger.finance_stats} />
      <div className="card">
        <h3>Категории</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Начислено</th>
              <th>Оплачено</th>
              <th>Открыто</th>
              <th>Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {(ledger.categories || []).map((r: BalanceRow) => (
              <tr key={r.category}>
                <td>{r.category_label || r.category}</td>
                <td>{money(r.charged_total)}</td>
                <td>{money(r.paid_total)}</td>
                <td className={Number(r.open_total) > 0 ? "dangerText" : ""}>
                  {money(r.open_total)}
                </td>
                <td>{money(r.overdue_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ManualPaymentBlock
        clientId={ledger.client?.id}
        charges={ledger.charges || []}
        showToast={showToast}
        reload={reload}
      />
      <ManualChargeBlock
        clientId={ledger.client?.id}
        showToast={showToast}
        reload={reload}
      />
      <div className="card">
        <h3>Открытые начисления</h3>
        {(ledger.charges || []).length ? (
          <DebtTable debts={ledger.charges} selected={[]} toggle={() => null} />
        ) : (
          <p className="muted">Нет открытых начислений.</p>
        )}
      </div>
      <div className="card">
        <h3>Последние платежи</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Метод</th>
              <th>Заметка</th>
            </tr>
          </thead>
          <tbody>
            {(ledger.payments || []).map((p: Payment) => (
              <tr key={p.id}>
                <td>#{p.id}</td>
                <td>{p.payment_date}</td>
                <td>{money(p.amount)}</td>
                <td>{p.method}</td>
                <td>{p.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ClientFinanceStatsBlock({ stats }: { stats: any }) {
  if (!stats) return null;
  const current = stats.current || {};
  const all = stats.all_time || {};
  const history = stats.history || [];
  return (
    <div className="card">
      <h3>📊 Статистика клиента</h3>
      <p className="small muted">Месяц считается по due_date/period_start начислений и payment_date оплат. Долг — обязательство, оплата — реальные деньги.</p>
      <div className="kpi-grid">
        <div className="kpi"><div>Начислено за {stats.current_month}</div><b>{money(current.charged)}</b></div>
        <div className="kpi"><div>Оплачено за месяц</div><b>{money(current.paid)}</b></div>
        <div className="kpi"><div>Долг месяца</div><b className={Number(current.open_debt) > 0 ? "dangerText" : "okText"}>{money(current.open_debt)}</b></div>
        <div className="kpi"><div>Баланс месяца</div><b className={Number(current.balance) >= 0 ? "okText" : "dangerText"}>{money(current.balance)}</b></div>
        <div className="kpi"><div>Начислено всего</div><b>{money(all.charged)}</b></div>
        <div className="kpi"><div>Оплачено всего</div><b>{money(all.paid)}</b></div>
        <div className="kpi"><div>Открытый долг всего</div><b className={Number(all.open_debt) > 0 ? "dangerText" : "okText"}>{money(all.open_debt)}</b></div>
        <div className="kpi"><div>Баланс всего</div><b className={Number(all.balance) >= 0 ? "okText" : "dangerText"}>{money(all.balance)}</b></div>
      </div>
      <hr className="hr" />
      <h4>История по месяцам</h4>
      <div className="tableWrap">
        <table className="table">
          <thead><tr><th>Месяц</th><th>Начислено</th><th>Оплачено</th><th>Долг</th><th>Аванс</th><th>Баланс</th></tr></thead>
          <tbody>
            {history.map((r: any) => (
              <tr key={r.month}>
                <td>{r.month}</td>
                <td>{money(r.charged)}</td>
                <td>{money(r.paid)}</td>
                <td className={Number(r.open_debt) > 0 ? "dangerText" : ""}>{money(r.open_debt)}</td>
                <td className="okText">{money(r.advance)}</td>
                <td className={Number(r.balance) >= 0 ? "okText" : "dangerText"}>{money(r.balance)}</td>
              </tr>
            ))}
            {!history.length && <tr><td colSpan={6} className="muted">Истории пока нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManualPaymentBlock({
  clientId,
  charges,
  showToast,
  reload,
}: {
  clientId: number;
  charges: Debt[];
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [category, setCategory] = useState("auto");
  const [mode, setMode] = useState("oldest");
  const [paymentDate, setPaymentDate] = useState(today());
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return showToast("Введи сумму больше 0");
    if (mode === "selected" && !selected.length) return showToast("Выбери начисления или поставь режим 'старые долги'");
    await api("/api/admin/payments/manual", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        amount: n,
        method,
        payment_date: paymentDate,
        category,
        allocation_mode: mode,
        charge_ids: selected,
        note,
      }),
    });
    showToast("Платёж записан и распределён");
    setAmount("");
    setNote("");
    setSelected([]);
    await reload();
  }
  return (
    <div className="card">
      <h3>💵 Реальная оплата вручную</h3>
      <div className="formgrid">
        <label>
          Сумма
          <input
            className="input"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Дата
          <input
            className="input"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </label>
        <label>
          Метод
          <select
            className="select"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            <option value="cash">cash</option>
            <option value="bank">bank</option>
            <option value="revolut">revolut</option>
            <option value="other">other</option>
          </select>
        </label>
        <label>
          Категория
          <select
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Распределение
          <select
            className="select"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="oldest">Закрыть старые долги</option>
            <option value="selected">Только выбранные ниже</option>
            <option value="advance">Оставить авансом</option>
          </select>
        </label>
      </div>
      <label>
        Заметка
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="например: клиент оплатил 4000 наличкой"
        />
      </label>
      {mode === "selected" && (
        <div>
          <p className="small muted">Выбери начисления для закрытия:</p>
          {charges.map((d) => (
            <label key={d.charge_id} className="row small">
              <input
                type="checkbox"
                checked={selected.includes(d.charge_id)}
                onChange={() =>
                  setSelected((x) =>
                    x.includes(d.charge_id)
                      ? x.filter((i) => i !== d.charge_id)
                      : [...x, d.charge_id],
                  )
                }
              />{" "}
              #{d.charge_id} {d.category_label} {money(d.debt_left)} до{" "}
              {d.due_date}
            </label>
          ))}
        </div>
      )}
      <button className="btn primary" disabled={!amount} onClick={submit}>
        Записать платёж
      </button>
    </div>
  );
}

function ManualChargeBlock({
  clientId,
  showToast,
  reload,
}: {
  clientId: number;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [chargeType, setChargeType] = useState("rent");
  const [dueDate, setDueDate] = useState(today());
  const [note, setNote] = useState("");
  async function submit() {
    await api("/api/admin/charges/manual", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        amount: Number(amount),
        charge_type: chargeType,
        due_date: dueDate,
        note,
      }),
    });
    showToast("Начисление создано");
    setAmount("");
    setNote("");
    await reload();
  }
  return (
    <div className="card">
      <h3>➕ Ручное начисление</h3>
      <div className="formgrid">
        <label>
          Категория
          <select
            className="select"
            value={chargeType}
            onChange={(e) => setChargeType(e.target.value)}
          >
            {CATEGORIES.filter(([v]) => v !== "auto").map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Сумма
          <input
            className="input"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          Срок
          <input
            className="input"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
      </div>
      <label>
        Заметка
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="btn primary" disabled={!amount} onClick={submit}>
        Создать начисление
      </button>
    </div>
  );
}

function QuickPaymentBlock({
  showToast,
  reload,
}: {
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"payment" | "debt">("payment");
  const [text, setText] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [dueDate, setDueDate] = useState(today());
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [method, setMethod] = useState("manual_chat");
  const [debtCategory, setDebtCategory] = useState("rent");
  const [note, setNote] = useState("quick from miniapp");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<any>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<any>(null);

  async function submit(forceDuplicate = false) {
    setError("");
    setLastResult(null);
    if (forceDuplicate) setDuplicateWarning(null);
    if (!text.trim()) {
      setError(mode === "payment" ? "Вставь хотя бы одну строку оплаты." : "Вставь хотя бы одну строку долга.");
      return;
    }
    setLoading(true);
    try {
      const res = await api<any>("/api/admin/payments/quick-text", {
        method: "POST",
        body: JSON.stringify({
          text,
          payment_date: paymentDate,
          due_date: dueDate,
          period_start: periodStart || null,
          period_end: periodEnd || null,
          method,
          note,
          force_action: mode,
          default_charge_type: debtCategory,
          confirm_duplicate: forceDuplicate,
        }),
      });
      if (res?.duplicate_warning) {
        setDuplicateWarning(res);
        showToast("Возможный дубль — подтверди сохранение");
        return;
      }
      setLastResult(res);
      setDuplicateWarning(null);
      showToast(`${mode === "payment" ? "Оплаты" : "Долги"}: обработано ${res.parsed_count || 0} строк`);
      setText("");
      await reload();
    } catch (e: any) {
      const message = e?.message || "Быстрый ввод не сработал";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h3>⚡ Быстрый ввод</h3>
      <p className="small muted">
        Теперь режим выбирается явно. <b>Оплата</b> создаёт только <span className="code">client_payments</span>.
        <b> Долг</b> создаёт только <span className="code">client_charges</span>. Система больше не угадывает по слову “долг”.
      </p>
      <div className="row">
        <button className={`btn ${mode === "payment" ? "primary" : ""}`} onClick={() => setMode("payment")}>🟢 Записать оплату</button>
        <button className={`btn ${mode === "debt" ? "danger" : ""}`} onClick={() => setMode("debt")}>🔴 Добавить долг</button>
      </div>
      <div className="formgrid" style={{ marginTop: 10 }}>
        <label>
          {mode === "payment" ? "Дата оплаты" : "Дата начисления"}
          <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
        </label>
        {mode === "debt" && (
          <label>
            Срок оплаты / due date
            <input className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        )}
        {mode === "payment" ? (
          <label>
            Метод
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="manual_chat">manual_chat</option>
              <option value="cash">cash</option>
              <option value="bank">bank</option>
              <option value="revolut">revolut</option>
              <option value="other">other</option>
            </select>
          </label>
        ) : (
          <label>
            Категория долга
            <select className="select" value={debtCategory} onChange={(e) => setDebtCategory(e.target.value)}>
              {CATEGORIES.filter(([v]) => v !== "auto").map(([v, t]) => (
                <option key={v} value={v}>{t}</option>
              ))}
            </select>
          </label>
        )}
        {mode === "debt" && (
          <>
            <label>
              Период с
              <input className="input" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </label>
            <label>
              Период до
              <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <label>
        {mode === "payment" ? "Строки оплат" : "Строки долгов"}
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mode === "payment" ? "вел 37 3000 Паша\n8 1500 Ахмед" : "вел 37 3000 Паша\nвел 8 1500 Ахмед"}
        />
      </label>
      <label>
        Заметка
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <button className={`btn ${mode === "payment" ? "primary" : "danger"}`} disabled={!text.trim() || loading} onClick={() => submit(false)}>
        {loading ? "Записываю..." : mode === "payment" ? "Записать оплаты" : "Добавить долги"}
      </button>
      {error && (
        <div className="item critical" style={{ marginTop: 10 }}>
          <b>Ошибка быстрого ввода</b>
          <p className="dangerText">{error}</p>
        </div>
      )}
      {duplicateWarning && (
        <div className="item warn" style={{ marginTop: 10 }}>
          <b>⚠️ Возможный дубль</b>
          <p className="small muted">Похожая запись уже есть за последние 2 дня. Проверь, не добавляешь ли повторно.</p>
          <pre className="small">{JSON.stringify(duplicateWarning.duplicates || [], null, 2)}</pre>
          <div className="row">
            <button className="btn danger" onClick={() => setDuplicateWarning(null)}>Отмена</button>
            <button className="btn primary" onClick={() => submit(true)}>Добавить всё равно</button>
          </div>
        </div>
      )}
      {lastResult && (
        <div className="item ok" style={{ marginTop: 10 }}>
          <div className="space">
            <b>Строки обработаны</b>
            <span className="pill ok">{lastResult.parsed_count || 0} строк</span>
          </div>
          {(lastResult.results || []).map((r: any, idx: number) => (
            <div key={idx} className="small muted" style={{ marginTop: 6 }}>
              #{r.bike_id}: {r.action === "debt" ? "долг" : "оплата"} · {money(r.amount)} · {r.action === "debt" ? `charge #${r.result?.charge_id || r.result?.id || "?"}` : `payment #${r.result?.payment_id || "?"}`} · {r.action === "payment" ? `закрыто ${money(r.result?.allocated_amount || 0)} · аванс ${money(r.result?.advance_amount || 0)}` : r.charge_type}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function AssetsTab({ showToast }: { showToast: (s: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      setData(await api<any>("/api/admin/assets"));
    } catch (e: any) {
      showToast(e.message || "Не удалось загрузить активы");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, []);
  const rows = data?.recent || data?.transactions || [];
  return (
    <div className="grid">
      <AssetOperationsBlock showToast={showToast} reload={load} />
      <div className="card wide">
        <div className="space">
          <h3>📜 История активов</h3>
          <button className="btn" onClick={() => load()} disabled={loading}>{loading ? "Загрузка..." : "Обновить"}</button>
        </div>
        <p className="muted">Покупка велика/батареи — это расход и asset transaction. Продажа помечает актив как sold и фиксирует сделку.</p>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr><th>Дата</th><th>Актив</th><th>Операция</th><th>Сумма</th><th>Заметка</th></tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id}>
                  <td>{r.transaction_date || r.created_at?.slice?.(0, 10) || "-"}</td>
                  <td>{r.asset_type} #{r.asset_id}</td>
                  <td>{r.transaction_type}</td>
                  <td>{money(r.amount)}</td>
                  <td className="small">{r.notes || "-"}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">Записей пока нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AssetOperationsBlock({ showToast, reload }: { showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [assetType, setAssetType] = useState("bike");
  const [action, setAction] = useState("purchase");
  const [date, setDate] = useState(today());
  const [bikeId, setBikeId] = useState("");
  const [batteryId, setBatteryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [vin, setVin] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState<any>(null);

  async function submit() {
    setError("");
    setLast(null);
    setLoading(true);
    try {
      const body: any = {
        asset_type: assetType,
        action,
        date,
        amount: Number(amount),
        notes,
      };
      if (assetType === "bike") {
        body.bike_id = Number(bikeId);
        if (action === "purchase") {
          body.brand = brand;
          body.model = model;
          body.vin = vin;
        }
      } else {
        body.battery_id = batteryId ? Number(batteryId) : null;
        if (action === "purchase") {
          body.type_id = Number(typeId);
          body.bike_id = bikeId ? Number(bikeId) : null;
        }
      }
      const res = await api<any>("/api/admin/assets", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setLast(res);
      showToast(action === "purchase" ? "Покупка записана" : "Продажа записана");
      await reload();
    } catch (e: any) {
      const msg = e?.message || "Операция с активом не сработала";
      setError(msg);
      showToast(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card wide">
      <h3>🧾 Покупка / продажа великов и батарей</h3>
      <p className="small muted">
        Покупка велика/батареи создаёт запись актива и расход в <span className="code">business_expenses</span>.
        Продажа фиксируется в <span className="code">asset_transactions</span> и помечает актив как sold.
      </p>
      <div className="formgrid">
        <label>
          Актив
          <select className="select" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
            <option value="bike">Велик</option>
            <option value="battery">Батарея</option>
          </select>
        </label>
        <label>
          Операция
          <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="purchase">Покупка / расход</option>
            <option value="sale">Продажа</option>
          </select>
        </label>
        <label>
          Дата
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Сумма Kč
          <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="например 30000" />
        </label>
      </div>
      <div className="formgrid">
        {assetType === "bike" && (
          <>
            <label>
              № велика
              <input className="input" value={bikeId} onChange={(e) => setBikeId(e.target.value)} placeholder="например 93" />
            </label>
            {action === "purchase" && (
              <>
                <label>
                  Бренд
                  <input className="input" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Duotts / Engwe" />
                </label>
                <label>
                  Модель
                  <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="C29 / M20" />
                </label>
                <label>
                  VIN / серийник
                  <input className="input" value={vin} onChange={(e) => setVin(e.target.value)} />
                </label>
              </>
            )}
          </>
        )}
        {assetType === "battery" && (
          <>
            <label>
              ID батареи {action === "purchase" ? "(можно пусто)" : ""}
              <input className="input" value={batteryId} onChange={(e) => setBatteryId(e.target.value)} placeholder="например 120" />
            </label>
            {action === "purchase" && (
              <>
                <label>
                  type_id батареи
                  <input className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)} placeholder="например 2" />
                </label>
                <label>
                  Привязать к велику №
                  <input className="input" value={bikeId} onChange={(e) => setBikeId(e.target.value)} placeholder="необязательно" />
                </label>
              </>
            )}
          </>
        )}
      </div>
      <label>
        Заметка
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="поставщик, причина, детали" />
      </label>
      <button className="btn primary" disabled={loading || !amount} onClick={submit}>
        {loading ? "Записываю..." : "Записать актив"}
      </button>
      {error && <p className="dangerText">{error}</p>}
      {last && <p className="small okText">OK: {JSON.stringify(last)}</p>}
      <hr className="hr" />
      <p className="small muted">
        Категории расходов для будущей статистики: <span className="code">bike_purchase</span>, <span className="code">battery_purchase</span>, <span className="code">transport</span>, <span className="code">parts_purchase</span>, <span className="code">vehicle_parts</span>, <span className="code">vehicle_repair</span>, <span className="code">fuel</span>, <span className="code">parking</span>, <span className="code">vehicle_insurance</span>.
      </p>
    </div>
  );
}

function FinanceLogTab({ showToast }: { showToast: (s: string) => void }) {
  const [days, setDays] = useState(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function load(nextDays = days) {
    setLoading(true);
    try {
      const payload = await api<any>(`/api/admin/bot-finance?days=${nextDays}`);
      setData(payload);
    } catch (e: any) {
      showToast(e.message || "Не получилось загрузить стату");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, []);

  const totals = data?.totals || { income: 0, expense: 0, debt_created: 0, count: 0 };
  const profit = Number(totals.income || 0) - Number(totals.expense || 0);

  return (
    <div className="grid">
      <div className="card">
        <h3>📊 Стата из быстрых сообщений бота</h3>
        <p className="muted">
          Сюда попадают сообщения формата <span className="code">+ 50 сервис тест</span>, <span className="code">- 500 еда</span>, <span className="code">+ 3000 аренда вел 24</span>.
          Аренда с номером велика дополнительно создаёт оплату клиента, сервис пока только пишется в журнал.
        </p>
        <div className="row">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              className={`btn ${days === d ? "primary" : ""}`}
              onClick={() => {
                setDays(d);
                load(d);
              }}
            >
              {d === 1 ? "Сегодня" : `${d} дней`}
            </button>
          ))}
          <button className="btn" onClick={() => load()} disabled={loading}>
            {loading ? "Загрузка..." : "Обновить"}
          </button>
        </div>
        <hr className="hr" />
        <div className="kpi-grid">
          <div className="kpi"><div>Реальный доход</div><b>{money(totals.income)}</b></div>
          <div className="kpi"><div>Реальный расход</div><b>{money(totals.expense)}</b></div>
          <div className="kpi"><div>Денежный итог</div><b>{money(profit)}</b></div>
          <div className="kpi"><div>Создано долгов</div><b>{money(totals.debt_created)}</b></div>
          <div className="kpi"><div>Записей</div><b>{totals.count || 0}</b></div>
        </div>
      </div>

      <div className="card">
        <h3>По категориям</h3>
        <div className="list">
          {(data?.by_category || []).map((r: any, idx: number) => (
            <div className="item" key={`${r.sign}-${r.category}-${idx}`}>
              <div className="space">
                <b>{r.kind === "debt_created" ? "📌 долг" : r.sign === "income" ? "🟢 +" : "🔴 -"} {r.category_label || r.category}</b>
                <span className="pill">{r.count}</span>
              </div>
              <div>{money(r.total)}</div>
            </div>
          ))}
          {data && !data.by_category?.length && <p className="muted">Пока записей нет.</p>}
        </div>
      </div>

      <div className="card wide">
        <h3>Последние записи</h3>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип</th>
                <th>Сумма</th>
                <th>Категория</th>
                <th>Велик</th>
                <th>Клиент</th>
                <th>Текст</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent || []).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.event_date || "-"}</td>
                  <td>{r.stats_kind === "debt_created" ? "📌 долг" : r.sign === "income" ? "🟢 +" : "🔴 -"}</td>
                  <td>{money(r.amount)}</td>
                  <td>{r.category_label || r.category}</td>
                  <td>{r.bike_id ? `#${r.bike_id}` : "-"}</td>
                  <td>{r.client_id ? `#${r.client_id}` : "-"}</td>
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


function BusinessDebtsBlock({ showToast }: { showToast: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState("open");
  const [form, setForm] = useState({
    counterparty_name: "",
    direction: "receivable",
    amount: "",
    category: "other",
    due_date: today(),
    notes: "",
  });

  async function load() {
    setRows(await api<any[]>(`/api/admin/business-debts?status=${status}`));
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [status]);

  async function create() {
    if (!form.counterparty_name.trim() || !Number(form.amount)) return showToast("Заполни кто и сумму");
    await api("/api/admin/business-debts", { method: "POST", body: JSON.stringify(form) });
    showToast("Сторонний долг добавлен");
    setForm({ counterparty_name: "", direction: "receivable", amount: "", category: "other", due_date: today(), notes: "" });
    await load();
  }

  async function setRowStatus(id: number, next: string) {
    await api("/api/admin/business-debts", { method: "POST", body: JSON.stringify({ action: "status", id, status: next }) });
    showToast("Статус обновлён");
    await load();
  }

  const receivable = rows.filter((r) => r.direction === "receivable" && r.status === "open").reduce((s, r) => s + Number(r.amount || 0), 0);
  const payable = rows.filter((r) => r.direction === "payable" && r.status === "open").reduce((s, r) => s + Number(r.amount || 0), 0);

  return (
    <div className="card">
      <div className="space">
        <h3>🏢 Сторонние долги бизнеса</h3>
        <span className="pill">нам {money(receivable)} / мы {money(payable)}</span>
      </div>
      <p className="small muted">Это не клиентские долги. Здесь партнёры, поставщики, гости и взаимосвязанные бизнесы.</p>
      <div className="formgrid">
        <label>Кто / название
          <input className="input" value={form.counterparty_name} onChange={(e) => setForm({ ...form, counterparty_name: e.target.value })} placeholder="Влад / Wolt / поставщик" />
        </label>
        <label>Направление
          <select className="select" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
            <option value="receivable">Нам должны</option>
            <option value="payable">Мы должны</option>
          </select>
        </label>
        <label>Сумма
          <input className="input" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="9000" />
        </label>
        <label>Категория
          <select className="select" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="service">сервис</option>
            <option value="parts">запчасти</option>
            <option value="referral">рефералка</option>
            <option value="transport">транспорт</option>
            <option value="procurement">закупки</option>
            <option value="other">другое</option>
          </select>
        </label>
        <label>Срок оплаты
          <input className="input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
        </label>
        <label>Комментарий
          <input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="за что долг" />
        </label>
      </div>
      <button className="btn primary" onClick={create}>Добавить сторонний долг</button>
      <hr className="hr" />
      <div className="row">
        <select className="select" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">open</option>
          <option value="paid">paid</option>
          <option value="cancelled">cancelled</option>
          <option value="all">all</option>
        </select>
        <button className="btn" onClick={() => load().catch((e) => showToast(e.message))}>Обновить</button>
      </div>
      <div className="list">
        {rows.map((r) => (
          <div className={`item ${r.direction === "receivable" ? "ok" : "warn"}`} key={r.id}>
            <div className="space">
              <b>#{r.id} {r.counterparty_name}</b>
              <span className="money">{r.direction === "receivable" ? "+" : "-"} {money(r.amount)}</span>
            </div>
            <div className="small muted">{r.category} · due {r.due_date || "-"} · {r.status}</div>
            {r.notes && <p>{r.notes}</p>}
            {r.status === "open" && <div className="row"><button className="btn ok" onClick={() => setRowStatus(r.id, "paid")}>Закрыть как paid</button><button className="btn danger" onClick={() => setRowStatus(r.id, "cancelled")}>Отменить</button></div>}
          </div>
        ))}
        {!rows.length && <p className="muted">Сторонних долгов нет.</p>}
      </div>
    </div>
  );
}

function DebtsTab({ showToast }: { showToast: (s: string) => void }) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const [category, setCategory] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      debts.filter((d) => {
        if (category !== "all" && d.category !== category) return false;
        if (origin !== "all" && d.charge_origin !== origin) return false;
        if (q.trim()) {
          const needle = q.trim().toLowerCase();
          const hay =
            `${d.charge_id} ${d.client_id} ${d.client_name || ""} ${d.bike_id || ""} ${d.bike_label || ""}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      }),
    [debts, category, origin, q],
  );
  const total = filtered
    .filter((d) => selected.includes(d.charge_id))
    .reduce((s, d) => s + Number(d.debt_left), 0);
  async function load() {
    const data = await api<Debt[]>(
      `/api/admin/debts?include_excluded=${includeExcluded ? 1 : 0}&only_overdue=0`,
    );
    setDebts(data);
    setSelected(data.filter((d) => !d.is_excluded).map((d) => d.charge_id));
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [includeExcluded]);
  function toggle(id: number) {
    setSelected((x) =>
      x.includes(id) ? x.filter((i) => i !== id) : [...x, id],
    );
  }
  async function post(url: string, body: any, msg: string) {
    await api(url, { method: "POST", body: JSON.stringify(body) });
    showToast(msg);
    await load();
  }
  async function closePlan(createPayment: boolean) {
    if (!selected.length) return showToast("Ничего не выбрано");
    const res = await api<any>("/api/admin/debts/bulk-close-plan", {
      method: "POST",
      body: JSON.stringify({
        charge_ids: selected,
        create_payment: createPayment,
        payment_date: today(),
        method: createPayment ? "manual_plan_close" : "plan_only",
        note: createPayment
          ? "manual close planned rent with payment from debts tab"
          : "manual close planned rent without payment from debts tab",
      }),
    });
    showToast(
      createPayment
        ? `План закрыт + оплаты: ${res.paid_ids?.length || 0}, оплат ${res.payment_ids?.length || 0}, пропущено ${res.skipped_ids?.length || 0}`
        : `План закрыт без оплат: ${res.closed_ids?.length || 0}, пропущено ${res.skipped_ids?.length || 0}`,
    );
    await load();
  }
  async function realPaid() {
    if (!selected.length) return showToast("Ничего не выбрано");
    if (
      !confirm(
        `Создать реальные оплаты по выбранным долгам на ${money(total)}?`,
      )
    )
      return;
    await post(
      "/api/admin/debts/bulk-paid",
      {
        charge_ids: selected,
        method: "manual",
        payment_date: today(),
        note: "real payment from debts tab",
      },
      "Реальные оплаты записаны",
    );
  }
  return (
    <>
      <QuickPaymentBlock showToast={showToast} reload={load} />
      <BusinessDebtsBlock showToast={showToast} />
      <div className="card">
        <div className="space">
          <h3>⚠️ Все долги</h3>
          <span className="money">выбрано {money(total)}</span>
        </div>
        <div className="row">
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="поиск: велик, клиент, charge"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className="select"
            style={{ maxWidth: 240 }}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">Все категории</option>
            {CATEGORIES.filter(([v]) => !["auto"].includes(v)).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 260 }}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            {ORIGINS.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn"
            onClick={() =>
              setSelected(
                filtered.filter((d) => !d.is_excluded).map((d) => d.charge_id),
              )
            }
          >
            Выбрать видимые
          </button>
          <button className="btn" onClick={() => setSelected([])}>
            Снять все
          </button>
          <button className="btn ok" onClick={() => closePlan(false)}>
            ✅ Закрыть план без оплаты
          </button>
          <button className="btn primary" onClick={() => closePlan(true)}>
            💵 Закрыть план + создать оплату
          </button>
          <button className="btn primary" onClick={realPaid}>
            💵 Оплата по выбранным долгам
          </button>
          <button
            className="btn warn"
            onClick={() =>
              post(
                "/api/admin/debts/bulk-remind",
                { charge_ids: selected },
                "Напоминания отправлены",
              )
            }
          >
            📢 Напомнить
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const reason = prompt(
                "Причина исключения",
                "дубль / ошибка / проверить",
              );
              if (reason)
                post(
                  "/api/admin/debts/bulk-exclude",
                  { charge_ids: selected, reason },
                  "Исключено",
                );
            }}
          >
            🙈 Исключить
          </button>
          <label className="row small">
            <input
              type="checkbox"
              checked={includeExcluded}
              onChange={(e) => setIncludeExcluded(e.target.checked)}
            />{" "}
            показать исключённые
          </label>
        </div>
        <p className="small muted">
          Фиктивные rent_plan-долги нужны только как чеклист по аренде. Их можно
          закрывать без создания оплаты. Реальная оплата создаёт client_payments
          и нужна для налички/банка/Fio.
        </p>
        <hr className="hr" />
        <DebtTable debts={filtered} selected={selected} toggle={toggle} />
      </div>
    </>
  );
}

function RuleRequestsTab({ showToast }: { showToast: (s: string) => void }) {
  const [rows, setRows] = useState<RuleRequest[]>([]);
  const [clientRows, setClientRows] = useState<any[]>([]);
  const [status, setStatus] = useState("new");
  async function load() {
    const ruleStatus = status === "new" ? "pending" : status;
    const [ruleData, generalData] = await Promise.all([
      api<RuleRequest[]>(`/api/admin/payment-rule-requests?status=${ruleStatus}`),
      api<any[]>(`/api/admin/requests?status=${status}`),
    ]);
    setRows(ruleData);
    setClientRows(generalData);
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [status]);
  async function decide(id: number, decision: "approve" | "reject") {
    const note = prompt(decision === "approve" ? "Комментарий к подтверждению" : "Причина отказа", "");
    await api("/api/admin/payment-rule-requests", {
      method: "POST",
      body: JSON.stringify({ request_id: id, decision, admin_note: note }),
    });
    showToast(decision === "approve" ? "Запрос подтверждён" : "Запрос отклонён");
    await load();
  }
  async function setGeneralStatus(id: number, next: string) {
    const note = prompt("Комментарий админа", "");
    await api("/api/admin/requests", {
      method: "POST",
      body: JSON.stringify({ request_id: id, status: next, admin_note: note }),
    });
    showToast("Статус запроса обновлён");
    await load();
  }
  return (
    <div className="grid">
      <div className="card wide">
        <div className="space">
          <h3>📝 Запросы клиентов</h3>
          <select className="select" style={{ maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="new">new</option>
            <option value="all">all</option>
            <option value="in_progress">in_progress</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="closed">closed</option>
          </select>
        </div>
        <p className="muted">Общие заявки клиента: аренда, доп. батарея, ремонт, возврат, аксессуар. Пока это только заявка и статус, без автоматического создания аренды.</p>
        <div className="list">
          {clientRows.map((r: any) => (
            <div className="item" key={r.id}>
              <div className="space">
                <b>#{r.id} {r.title || r.request_type}</b>
                <span className={`pill ${r.status === "new" ? "warn" : r.status === "approved" || r.status === "closed" ? "ok" : r.status === "rejected" ? "danger" : ""}`}>{r.status}</span>
              </div>
              <div className="small muted">client #{r.client_id} {r.clients?.name ? `· ${r.clients.name}` : ""} · {new Date(r.created_at).toLocaleString()}</div>
              {r.preferred_date && <div className="small muted">Желаемая дата: {r.preferred_date}</div>}
              <p>{r.description}</p>
              {r.admin_note && <p className="small muted">Админ: {r.admin_note}</p>}
              <div className="row">
                <button className="btn" onClick={() => setGeneralStatus(r.id, "in_progress")}>В работу</button>
                <button className="btn ok" onClick={() => setGeneralStatus(r.id, "approved")}>Одобрить</button>
                <button className="btn danger" onClick={() => setGeneralStatus(r.id, "rejected")}>Отклонить</button>
                <button className="btn" onClick={() => setGeneralStatus(r.id, "closed")}>Закрыть</button>
              </div>
            </div>
          ))}
          {!clientRows.length && <p className="muted">Общих запросов пока нет.</p>}
        </div>
      </div>
      <div className="card wide">
        <h3>💰 Запросы на изменение правила оплаты</h3>
        <p className="muted">Старый тип запроса оставлен отдельно: клиент просит изменить сумму/части оплаты, подтверждает только админ.</p>
        <div className="list">
          {rows.map((r) => (
            <div className="item" key={r.id}>
              <div className="space">
                <b>Запрос #{r.id}: client #{r.client_id}, bike #{r.bike_id}</b>
                <span className={`pill ${r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : "danger"}`}>{r.status}</span>
              </div>
              <div className="small muted">rental #{r.rental_id} · {new Date(r.created_at).toLocaleString()}</div>
              <p>Новая сумма: <b>{money(r.requested_monthly_amount)}</b></p>
              <p className="small">Части: {JSON.stringify(r.requested_parts)}</p>
              <p>{r.reason || "Без причины"}</p>
              {r.status === "pending" && (
                <div className="row">
                  <button className="btn ok" onClick={() => decide(r.id, "approve")}>✅ Подтвердить</button>
                  <button className="btn danger" onClick={() => decide(r.id, "reject")}>❌ Отклонить</button>
                </div>
              )}
            </div>
          ))}
          {!rows.length && <p className="muted">Запросов оплаты нет.</p>}
        </div>
      </div>
    </div>
  );
}


function ExceptionsTab() {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  useEffect(() => {
    api<ExceptionRow[]>("/api/admin/exceptions")
      .then(setRows)
      .catch(console.error);
  }, []);
  return (
    <div className="card">
      <h3>🚨 Исключения и предупреждения</h3>
      <p className="muted">
        Это список мест, где учёт может врать или автоматизация не сработает.
      </p>
      <div className="list">
        {rows.map((r, idx) => (
          <div
            key={idx}
            className={`item ${r.severity === "critical" ? "critical" : "warn"}`}
          >
            <div className="space">
              <b>{r.title}</b>
              <span
                className={`pill ${r.severity === "critical" ? "danger" : "warn"}`}
              >
                {r.severity}
              </span>
            </div>
            <div className="small muted">{r.exception_type}</div>
            <p>{r.description}</p>
          </div>
        ))}
        {!rows.length && <p className="okText">Критичных исключений нет.</p>}
      </div>
    </div>
  );
}

function ClientsTab({ showToast }: { showToast: (s: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [docType, setDocType] = useState("ID card");
  const [docNumber, setDocNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lastInvite, setLastInvite] = useState<any>(null);
  const [inviteError, setInviteError] = useState("");
  async function load() {
    setClients(
      await api<Client[]>(`/api/admin/clients?q=${encodeURIComponent(q)}`),
    );
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, []);
  async function create() {
    await api("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify({ name, phone, email, address, doc_type: docType, doc_number: docNumber, notes }),
    });
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setDocType("ID card");
    setDocNumber("");
    setNotes("");
    showToast("Клиент создан");
    await load();
  }
  async function invite(clientId: number) {
    setLastInvite(null);
    setInviteError("");
    try {
      const data = await api<any>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ client_id: clientId, notes: "client entry link from clients tab" }),
      });
      setLastInvite(data);
      try {
        await navigator.clipboard?.writeText(data.link);
        showToast("Ссылка создана и скопирована");
      } catch {
        showToast("Ссылка создана, скопируй её из блока справа");
      }
    } catch (e: any) {
      const message = e.message || "Не получилось создать ссылку";
      setInviteError(message);
      showToast(message);
    }
  }

  async function inviteNewClient() {
    setLastInvite(null);
    setInviteError("");
    try {
      const data = await api<any>("/api/admin/invites", {
        method: "POST",
        body: JSON.stringify({ client_id: null, notes: "new client self-registration link from clients tab" }),
      });
      setLastInvite(data);
      try {
        await navigator.clipboard?.writeText(data.link);
        showToast("Ссылка для нового клиента создана и скопирована");
      } catch {
        showToast("Ссылка создана, скопируй её из блока справа");
      }
    } catch (e: any) {
      const message = e.message || "Не получилось создать ссылку для нового клиента";
      setInviteError(message);
      showToast(message);
    }
  }
  return (
    <div className="grid">
      <div className="card">
        <h3>👤 Клиенты</h3>
        <div className="row">
          <input
            className="input"
            placeholder="поиск"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="btn" onClick={load}>
            Найти
          </button>
        </div>
        <hr className="hr" />
        <div className="list">
          {clients.map((c) => (
            <div className="item" key={c.id}>
              <div className="space">
                <b>
                  #{c.id} {c.name}
                </b>
                {c.telegram_id ? (
                  <span className="pill ok">TG</span>
                ) : (
                  <span className="pill warn">no TG</span>
                )}
              </div>
              <div className="small muted">
                📞 {c.phone || "-"} · 📧 {c.email || "-"}
              </div>
              <div className="small muted">
                🏠 {c.address || "адрес не заполнен"}
              </div>
              <div className="small muted">
                🪪 {c.doc_type || "документ"}: {c.doc_number || "номер не заполнен"} · bikes{" "}
                {(c.active_bike_ids || []).join(", ") || "-"}
              </div>
              <button
                className="btn"
                style={{ marginTop: 8 }}
                onClick={() => invite(c.id)}
              >
                🔑 Ссылка входа через бота
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="space">
          <h3>Последняя ссылка входа</h3>
          <button className="btn primary" onClick={inviteNewClient}>🔑 Ссылка для нового клиента</button>
        </div>
        <p className="small muted">
          Для старого клиента нажимай кнопку у клиента слева. Для нового клиента создай общий ключ здесь: он сам откроет ссылку, заполнит форму договора и Mini App создаст карточку клиента.
        </p>
        {inviteError && <p className="dangerText">{inviteError}</p>}
        {!lastInvite && !inviteError && <p className="muted">Нажми “Ссылка входа через бота” у клиента слева или “Ссылка для нового клиента” сверху — ссылка появится здесь.</p>}
        {lastInvite && (
          <div className="item ok">
            <div>
              {lastInvite.client_id ? (
                <>Клиент: <span className="code">#{lastInvite.client_id}</span></>
              ) : (
                <><span className="pill warn">новый клиент</span> клиент заполнит форму сам</>
              )}
            </div>
            <div>Ключ: <span className="code">{lastInvite.invite_key}</span></div>
            <div className="small muted" style={{ wordBreak: "break-all" }}>{lastInvite.link}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => navigator.clipboard?.writeText(lastInvite.link)}>Скопировать ссылку</button>
              <a className="btn" href={lastInvite.link} target="_blank" rel="noreferrer">Открыть https</a>
              {lastInvite.tg_link && <a className="btn" href={lastInvite.tg_link}>Открыть tg://</a>}
            </div>
          </div>
        )}
        <hr className="hr" />
        <h3>Создать клиента / данные договора</h3>
        <p className="muted">
          Поля сделаны под бумажный договор: имя, адрес, телефон/e-mail и документ.
          Они уже соответствуют таблице <span className="code">clients</span>.
        </p>
        <label>
          Nájemce jméno a příjmení / Имя и фамилия
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mykola Roman"
          />
        </label>
        <label>
          Adresa nájemce / Адрес
          <input
            className="input"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Družstevní 1655, Praha..."
          />
        </label>
        <div className="formgrid">
          <label>
            Telefon
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+420..."
            />
          </label>
          <label>
            E-mail
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </label>
        </div>
        <div className="formgrid">
          <label>
            Typ dokladu / Тип документа
            <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
              <option value="ID card">Občanský průkaz / ID card</option>
              <option value="passport">Cestovní pas / Паспорт</option>
              <option value="driver_license">Řidičský průkaz / Права</option>
              <option value="visa">Vízum / Pobyt</option>
              <option value="other">Jiné / Другое</option>
            </select>
          </label>
          <label>
            Číslo dokladu / Номер документа
            <input
              className="input"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="001648905"
            />
          </label>
        </div>
        <label>
          Poznámka / Комментарий
          <textarea
            className="textarea"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="например: документ проверен, залог 1500 Kč..."
          />
        </label>
        <button className="btn primary" disabled={!name.trim()} onClick={create}>
          Создать
        </button>
      </div>
    </div>
  );
}

function ClientInviteRegistration({ inviteKey, showToast, reload }: { inviteKey: string; showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [docType, setDocType] = useState("ID card");
  const [docNumber, setDocNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    if (!name.trim()) {
      setError("Введи имя и фамилию клиента.");
      return;
    }
    if (!phone.trim()) {
      setError("Введи телефон клиента.");
      return;
    }
    if (!address.trim()) {
      setError("Введи адрес клиента как в договоре.");
      return;
    }
    if (!docNumber.trim()) {
      setError("Введи номер документа клиента.");
      return;
    }
    setLoading(true);
    try {
      await api<any>("/api/client/register-from-invite", {
        method: "POST",
        body: JSON.stringify({ invite_key: inviteKey, name, phone, email, address, doc_type: docType, doc_number: docNumber, notes }),
      });
      showToast("Клиентский кабинет привязан");
      await reload();
    } catch (e: any) {
      const message = e?.message || "Не получилось использовать ключ";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="card">
      <h3>🔑 Вход / регистрация по ключу</h3>
      <p className="muted">
        Ключ <span className="code">{inviteKey}</span> принят из ссылки Telegram-бота.
        Заполни данные, и Mini App привяжет твой Telegram к клиентской карточке.
      </p>
      {error && <p className="dangerText">{error}</p>}
      <p className="muted">
        Заполни данные как в договоре аренды: имя, адрес, телефон/e-mail и документ.
      </p>
      <label>Nájemce jméno a příjmení / Имя и фамилия<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ivan Petrov" /></label>
      <label>Adresa nájemce / Адрес<input className="input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Družstevní 1655, Praha..." /></label>
      <div className="formgrid">
        <label>Telefon<input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+420..." /></label>
        <label>E-mail<input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" /></label>
      </div>
      <div className="formgrid">
        <label>Typ dokladu / Тип документа
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="ID card">Občanský průkaz / ID card</option>
            <option value="passport">Cestovní pas / Паспорт</option>
            <option value="driver_license">Řidičský průkaz / Права</option>
            <option value="visa">Vízum / Pobyt</option>
            <option value="other">Jiné / Другое</option>
          </select>
        </label>
        <label>Číslo dokladu / Номер документа<input className="input" value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="001648905" /></label>
      </div>
      <label>Комментарий<textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="опционально" /></label>
      <button className="btn primary" disabled={loading || !name.trim() || !phone.trim() || !address.trim() || !docNumber.trim()} onClick={submit}>{loading ? "Сохраняю..." : "Создать / привязать кабинет"}</button>
    </div>
  );
}


function ClientBikeHealthPanel({ showToast }: { showToast: (s: string) => void }) {
  const [payload, setPayload] = useState<{ bikes: BikeHealth[]; batteries: BikeBatteryHealth[]; service_events: BikeServiceEvent[] } | null>(null);
  const [kmByBike, setKmByBike] = useState<Record<number, string>>({});
  const [notesByBike, setNotesByBike] = useState<Record<number, string>>({});

  async function load() {
    const data = await api<{ bikes: BikeHealth[]; batteries: BikeBatteryHealth[]; service_events: BikeServiceEvent[] }>("/api/client/bike-health");
    setPayload(data);
    const next: Record<number, string> = {};
    data.bikes.forEach((b) => { next[b.bike_id] = String(Math.round(Number(b.current_km || 0)) || ""); });
    setKmByBike(next);
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function submitKm(bikeId: number) {
    const value = Number(kmByBike[bikeId]);
    if (!Number.isFinite(value) || value < 0) return showToast("Введи нормальный пробег");
    await api("/api/client/bike-health", {
      method: "POST",
      body: JSON.stringify({ bike_id: bikeId, odometer_km: value, notes: notesByBike[bikeId] || null }),
    });
    showToast("Пробег отправлен админу");
    await load();
  }

  if (!payload?.bikes?.length) return null;
  return (
    <div className="card">
      <h3>🚲 Состояние моего велика</h3>
      <p className="small muted">Раз в неделю можно передать пробег. Если после ТО будет около 1000 км, админ увидит задачу на обслуживание.</p>
      <div className="list">
        {payload.bikes.map((bike) => {
          const batteries = payload.batteries.filter((b) => b.bike_id === bike.bike_id);
          const services = payload.service_events.filter((e) => e.bike_id === bike.bike_id);
          return (
            <div className="item" key={bike.bike_id}>
              <div className="space"><b>{bike.bike_label}</b><span className={`pill ${statusPillClass(bike.health_status)}`}>{bike.health_status_label}</span></div>
              <div className="kv" style={{ marginTop: 8 }}>
                <div>Пробег сейчас</div><div>{roundKm(bike.current_km)}</div>
                <div>Последний сервис</div><div>{roundKm(bike.last_service_km)} / {shortDate(bike.last_service_date)}</div>
                <div>После сервиса</div><div>{roundKm(bike.km_since_service)}</div>
                <div>До ТО</div><div>{roundKm(bike.km_to_service)}</div>
              </div>
              <hr className="hr" />
              <div className="formgrid">
                <label>Пробег на дисплее, км<input className="input" type="number" value={kmByBike[bike.bike_id] || ""} onChange={(e) => setKmByBike((x) => ({ ...x, [bike.bike_id]: e.target.value }))} /></label>
                <label>Комментарий<input className="input" value={notesByBike[bike.bike_id] || ""} onChange={(e) => setNotesByBike((x) => ({ ...x, [bike.bike_id]: e.target.value }))} placeholder="если что-то шумит / плохо тормозит" /></label>
              </div>
              <button className="btn primary" onClick={() => submitKm(bike.bike_id)}>Отправить пробег</button>
              <hr className="hr" />
              <div className="small muted">Батареи: {batteries.length ? batteries.map((b) => `#${b.battery_id} ${b.capacity || ""}`).join(", ") : "нет данных"}</div>
              <div className="small muted">Последний ремонт: {services[0] ? `${shortDate(services[0].performed_at)} · ${services[0].title}` : "нет данных"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClientApp({ showToast }: { showToast: (s: string) => void }) {
  const [data, setData] = useState<ClientPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inviteKey = useMemo(() => inviteParam(), []);
  async function load() {
    setLoading(true);
    try {
      setError("");
      setData(await api<ClientPayload>("/api/client/me"));
    } catch (e: any) {
      const message = e?.message || "Клиент не найден";
      setError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  if (loading)
    return <div className="card">Загрузка клиентского кабинета...</div>;
  if (!data && inviteKey)
    return <ClientInviteRegistration inviteKey={inviteKey} showToast={showToast} reload={load} />;
  if (!data)
    return (
      <div className="card">
        <h3 className="dangerText">Клиент не найден</h3>
        <p>{error || "Попроси админа выдать ссылку входа или привязать Telegram ID."}</p>
        <p className="muted">Если у тебя есть ссылка с ключом, открой именно её через Telegram-бота.</p>
      </div>
    );
  const summaryOpen = data.balances.reduce(
    (s, b) => s + Number(b.open_total || 0),
    0,
  );
  return (
    <>
      <div className="card">
        <h2>👤 {data.client.client_name}</h2>
        <p className="muted">
          Тут клиент видит баланс, долги, платежи и может отправить запрос на
          изменение правила оплаты. Подтверждает только админ.
        </p>
        <div className="space">
          <span>Открытый долг</span>
          <span className={summaryOpen > 0 ? "dangerText" : "okText"}>
            {money(summaryOpen)}
          </span>
        </div>
        <hr className="hr" />
        {data.finance_stats && (
          <div className="kv">
            <div>Начислено всего</div><div>{money(data.finance_stats.charged_total)}</div>
            <div>Оплачено всего</div><div>{money(data.finance_stats.payments_total)}</div>
            <div>Баланс всего</div><div className={Number(data.finance_stats.net_balance) >= 0 ? "okText" : "dangerText"}>{money(data.finance_stats.net_balance)}</div>
          </div>
        )}
        <hr className="hr" />
        <h3>Данные договора</h3>
        <div className="small muted">📞 {data.client.client_phone || "телефон не заполнен"}</div>
        <div className="small muted">📧 {data.client.client_email || "email не заполнен"}</div>
        <div className="small muted">🏠 {data.client.client_address || "адрес не заполнен"}</div>
        <div className="small muted">🪪 {data.client.client_doc_type || "документ"}: {data.client.client_doc_number || "номер не заполнен"}</div>
      </div>
      <ClientBikeHealthPanel showToast={showToast} />
      <div className="card">
        <h3>Балансы по категориям</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Начислено</th>
              <th>Оплачено</th>
              <th>Открыто</th>
            </tr>
          </thead>
          <tbody>
            {data.balances.map((b) => (
              <tr key={b.category}>
                <td>{b.category_label || b.category}</td>
                <td>{money(b.charged_total)}</td>
                <td>{money(b.paid_total)}</td>
                <td className={Number(b.open_total) > 0 ? "dangerText" : ""}>
                  {money(b.open_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ClientGeneralRequestBlock showToast={showToast} reload={load} />
      <ClientRuleRequestBlock data={data} showToast={showToast} reload={load} />
      <div className="card">
        <h3>Открытые долги</h3>
        {data.debts.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Категория</th>
                <th>Велик</th>
                <th>Дата</th>
                <th>Долг</th>
              </tr>
            </thead>
            <tbody>
              {data.debts.map((d) => (
                <tr key={d.charge_id}>
                  <td>{d.category_label}</td>
                  <td>{d.bike_label}</td>
                  <td>{d.due_date}</td>
                  <td>{money(d.debt_left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="okText">Открытых долгов нет.</p>
        )}
      </div>
      <div className="card">
        <h3>Последние платежи</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Сумма</th>
              <th>Метод</th>
              <th>Заметка</th>
            </tr>
          </thead>
          <tbody>
            {data.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.payment_date}</td>
                <td>{money(p.amount)}</td>
                <td>{p.method}</td>
                <td>{p.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Мои запросы</h3>
        <div className="list">
          {(data.general_requests || []).map((r: ClientRequest) => (
            <div className="item" key={`general-${r.id}`}>
              <div className="space"><b>{r.title || r.request_type} #{r.id}</b><span className="pill warn">{r.status}</span></div>
              <p>{r.description}</p>
              {r.preferred_date && <p className="small muted">Желаемая дата: {r.preferred_date}</p>}
            </div>
          ))}
          {data.requests.map((r) => (
            <div className="item" key={`pay-${r.id}`}>
              <div className="space">
                <b>Изменение оплаты #{r.id}</b>
                <span className={`pill ${r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : "danger"}`}>{r.status}</span>
              </div>
              <p>{money(r.requested_monthly_amount)} · {r.reason}</p>
            </div>
          ))}
          {!(data.general_requests || []).length && !data.requests.length && <p className="muted">Запросов пока нет.</p>}
        </div>
      </div>
    </>
  );
}

function ClientGeneralRequestBlock({ showToast, reload }: { showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [requestType, setRequestType] = useState("battery_request");
  const [preferredDate, setPreferredDate] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit() {
    if (!description.trim()) return showToast("Опиши запрос");
    setLoading(true);
    try {
      await api("/api/client/requests", {
        method: "POST",
        body: JSON.stringify({ request_type: requestType, preferred_date: preferredDate || null, description }),
      });
      showToast("Запрос отправлен админу");
      setDescription("");
      setPreferredDate("");
      await reload();
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="card">
      <h3>➕ Создать запрос</h3>
      <p className="small muted">Пока это заявка без автоматического создания аренды/ремонта. Админ увидит её во вкладке 📝 Запросы.</p>
      <div className="formgrid">
        <label>
          Тип
          <select className="select" value={requestType} onChange={(e) => setRequestType(e.target.value)}>
            <option value="rent_request">🚲 Хочу арендовать велик</option>
            <option value="battery_request">🔋 Нужна доп. батарея</option>
            <option value="repair_request">🛠 Нужен ремонт</option>
            <option value="payment_rule_request">💰 Хочу изменить оплату</option>
            <option value="return_request">🔁 Хочу вернуть велик</option>
            <option value="accessory_request">📦 Нужен аксессуар / зарядка</option>
            <option value="other_request">❓ Другое</option>
          </select>
        </label>
        <label>
          Желаемая дата
          <input className="input" type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
        </label>
      </div>
      <label>
        Комментарий
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="например: нужна доп. батарея на следующую неделю" />
      </label>
      <button className="btn primary" disabled={loading || !description.trim()} onClick={submit}>{loading ? "Отправляю..." : "Отправить запрос"}</button>
    </div>
  );
}

function ClientRuleRequestBlock({
  data,
  showToast,
  reload,
}: {
  data: ClientPayload;
  showToast: (s: string) => void;
  reload: () => Promise<void>;
}) {
  const rental = data.active_rentals[0];
  const currentRule =
    data.payment_rules.find((r) => r.rental_id === rental?.id) ||
    data.payment_rules[0];
  const [monthly, setMonthly] = useState(
    Number(currentRule?.monthly_amount || rental?.price || 6000),
  );
  const [month, setMonth] = useState(currentMonth());
  const [parts, setParts] = useState<Part[]>(
    currentRule?.parts?.length
      ? currentRule.parts.map((p: any) => ({
          due_day: Number(p.due_day),
          amount: Number(p.amount),
        }))
      : [
          {
            due_day: 1,
            amount: Number(
              currentRule?.monthly_amount || rental?.price || 6000,
            ),
          },
        ],
  );
  const [reason, setReason] = useState("");
  async function submit() {
    if (!rental) return showToast("Нет active аренды");
    await api("/api/client/payment-rule-requests", {
      method: "POST",
      body: JSON.stringify({
        rental_id: rental.id,
        monthly_amount: monthly,
        parts,
        reason,
      }),
    });
    showToast("Запрос отправлен админу");
    setReason("");
    await reload();
  }
  return (
    <div className="card">
      <h3>📝 Запросить изменение правила оплаты</h3>
      {!rental && <p className="dangerText">Нет active аренды.</p>}
      <div className="formgrid">
        <label>
          Месячная сумма
          <input
            className="input"
            type="number"
            value={monthly}
            onChange={(e) => setMonthly(Number(e.target.value))}
          />
        </label>
        <label>
          Месяц предпросмотра
          <input
            className="input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
      </div>
      <PartsEditor
        monthly={monthly}
        parts={parts}
        setParts={setParts}
        previewMonth={month}
      />
      <label>
        Причина
        <textarea
          className="textarea"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="например: уже оплатил 4000, остаток заплачу 15 числа"
        />
      </label>
      <button
        className="btn primary"
        disabled={!rental || !reason}
        onClick={submit}
      >
        Отправить запрос админу
      </button>
      <p className="small muted">
        Клиент не меняет правило напрямую. Он только отправляет запрос, админ
        подтверждает или отклоняет.
      </p>
    </div>
  );
}
