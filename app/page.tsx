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
  "bikes" | "balances" | "debts" | "requests" | "exceptions" | "clients";

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
  payments: Payment[];
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

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-telegram-init-data": initData(),
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || "API error");
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
          <div className="sub">
            Админка + клиентский кабинет. Бот только показывает быстрые данные,
            все вводы идут через Mini App.
          </div>
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
          className={`tab ${tab === "balances" ? "active" : ""}`}
          onClick={() => setTab("balances")}
        >
          💰 Балансы
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
      {tab === "balances" && <BalancesTab showToast={showToast} />}
      {tab === "debts" && <DebtsTab showToast={showToast} />}
      {tab === "requests" && <RuleRequestsTab showToast={showToast} />}
      {tab === "exceptions" && <ExceptionsTab />}
      {tab === "clients" && <ClientsTab showToast={showToast} />}
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
  async function closePlan() {
    if (!selected.length) return showToast("Ничего не выбрано");
    if (!confirm(`Закрыть выбранные плановые долги по аренде на ${money(total)}? Реальные долги будут пропущены.`)) return;
    const createPayment = confirm(
      `Создать реальные client_payments на дату ${today()} для закрытых планов?\n\nОК = создать оплату.\nОтмена = закрыть только план без оплаты.`,
    );
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
        <button className="btn ok" onClick={closePlan}>
          ✅ Закрыть план
        </button>
        <button className="btn primary" onClick={paid}>
          💵 Реальная оплата
        </button>
        <button className="btn warn" onClick={remind}>
          📢 Напомнить
        </button>
        <button className="btn danger" onClick={exclude}>
          🙈 Исключить
        </button>
      </div>
      <p className="small muted">
        При ручном закрытии плана Mini App спросит, создавать ли реальную оплату.
        Автоматическая смена правила оплаты оплаты не создаёт.
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
  async function link() {
    if (!active) return showToast("Нет active клиента");
    await api("/api/admin/link-telegram", {
      method: "POST",
      body: JSON.stringify({
        client_id: active.client_id,
        telegram_id: Number(telegramId),
      }),
    });
    showToast("Telegram привязан");
    await reload();
  }
  async function createInvite(clientId: number | null) {
    const data = await api<any>("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        notes: clientId ? "link existing client" : "create new client",
      }),
    });
    setInvite(data);
    await navigator.clipboard?.writeText(data.link).catch(() => null);
    showToast("Ссылка создана и скопирована");
  }
  return (
    <div className="card">
      <h3 className="section-title">🔗 Telegram / ключ клиента</h3>
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
          className="btn"
          disabled={!active}
          onClick={() => createInvite(active?.client_id || null)}
        >
          Ключ для active клиента
        </button>
        <button className="btn" onClick={() => createInvite(null)}>
          Ключ для нового клиента
        </button>
      </div>
      {invite && (
        <div className="item" style={{ marginTop: 10 }}>
          <div>
            Ключ: <span className="code">{invite.invite_key}</span>
          </div>
          <div className="small muted">{invite.link}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => navigator.clipboard?.writeText(invite.link)}
            >
              Скопировать ссылку
            </button>
            <button
              className="btn"
              onClick={() => navigator.clipboard?.writeText(invite.invite_key)}
            >
              Скопировать ключ
            </button>
            <a className="btn" href={invite.link}>
              Открыть
            </a>
          </div>
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
                {c.phone || "-"} · bikes{" "}
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
      </div>
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
    await api("/api/admin/payments/manual", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        amount: Number(amount),
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
  const [text, setText] = useState("");
  const [paymentDate, setPaymentDate] = useState(today());
  const [method, setMethod] = useState("manual_chat");
  const [note, setNote] = useState("quick payment from miniapp");
  async function submit() {
    const res = await api<any>("/api/admin/payments/quick-text", {
      method: "POST",
      body: JSON.stringify({ text, payment_date: paymentDate, method, note }),
    });
    showToast(`Быстрый ввод: обработано ${res.parsed_count || 0} строк`);
    setText("");
    await reload();
  }
  return (
    <div className="card">
      <h3>⚡ Быстрый ввод реальных оплат</h3>
      <p className="small muted">
        Формат по строкам: <span className="code">24 велик 2000 оплата</span>.
        Это создаёт client_payments и закрывает старые rent-долги active аренды
        по этому велику. Если долгов нет — сумма остаётся авансом.
      </p>
      <div className="formgrid">
        <label>
          Дата оплаты
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
            <option value="manual_chat">manual_chat</option>
            <option value="cash">cash</option>
            <option value="bank">bank</option>
            <option value="revolut">revolut</option>
            <option value="other">other</option>
          </select>
        </label>
      </div>
      <label>
        Строки оплат
        <textarea
          className="textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"24 велик 2000 оплата\n25 велик 5000 оплата"}
        />
      </label>
      <label>
        Заметка
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <button className="btn primary" disabled={!text.trim()} onClick={submit}>
        Записать оплаты
      </button>
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
  async function closePlan() {
    if (!selected.length) return showToast("Ничего не выбрано");
    if (!confirm(`Закрыть выбранные плановые долги по аренде на ${money(total)}? Реальные долги будут пропущены.`)) return;
    const createPayment = confirm(
      `Создать реальные client_payments на дату ${today()} для закрытых планов?\n\nОК = создать оплату.\nОтмена = закрыть только план без оплаты.`,
    );
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
          <button className="btn ok" onClick={closePlan}>
            ✅ Закрыть план
          </button>
          <button className="btn primary" onClick={realPaid}>
            💵 Реальная оплата
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
  const [status, setStatus] = useState("pending");
  async function load() {
    setRows(
      await api<RuleRequest[]>(
        `/api/admin/payment-rule-requests?status=${status}`,
      ),
    );
  }
  useEffect(() => {
    load().catch((e) => showToast(e.message));
  }, [status]);
  async function decide(id: number, decision: "approve" | "reject") {
    const note = prompt(
      decision === "approve" ? "Комментарий к подтверждению" : "Причина отказа",
      "",
    );
    await api("/api/admin/payment-rule-requests", {
      method: "POST",
      body: JSON.stringify({ request_id: id, decision, admin_note: note }),
    });
    showToast(
      decision === "approve" ? "Запрос подтверждён" : "Запрос отклонён",
    );
    await load();
  }
  return (
    <div className="card">
      <div className="space">
        <h3>📝 Запросы клиентов на изменение правила оплаты</h3>
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="pending">pending</option>
          <option value="all">all</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
      </div>
      <p className="muted">
        Клиент может только отправить запрос. Новое правило вступает в силу
        только после подтверждения админом. Старые начисления и оплаты не
        удаляются.
      </p>
      <div className="list">
        {rows.map((r) => (
          <div className="item" key={r.id}>
            <div className="space">
              <b>
                Запрос #{r.id}: client #{r.client_id}, bike #{r.bike_id}
              </b>
              <span
                className={`pill ${r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : "danger"}`}
              >
                {r.status}
              </span>
            </div>
            <div className="small muted">
              rental #{r.rental_id} · {new Date(r.created_at).toLocaleString()}
            </div>
            <p>
              Новая сумма: <b>{money(r.requested_monthly_amount)}</b>
            </p>
            <p className="small">Части: {JSON.stringify(r.requested_parts)}</p>
            <p>{r.reason || "Без причины"}</p>
            {r.status === "pending" && (
              <div className="row">
                <button
                  className="btn ok"
                  onClick={() => decide(r.id, "approve")}
                >
                  ✅ Подтвердить
                </button>
                <button
                  className="btn danger"
                  onClick={() => decide(r.id, "reject")}
                >
                  ❌ Отклонить
                </button>
              </div>
            )}
          </div>
        ))}
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
      body: JSON.stringify({ name, phone }),
    });
    setName("");
    setPhone("");
    showToast("Клиент создан");
    await load();
  }
  async function invite(clientId: number) {
    const data = await api<any>("/api/admin/invites", {
      method: "POST",
      body: JSON.stringify({ client_id: clientId }),
    });
    await navigator.clipboard?.writeText(data.link).catch(() => null);
    showToast(`Ключ скопирован: ${data.link}`);
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
                {c.phone || "-"} · bikes{" "}
                {(c.active_bike_ids || []).join(", ") || "-"}
              </div>
              <button
                className="btn"
                style={{ marginTop: 8 }}
                onClick={() => invite(c.id)}
              >
                🔑 Ключ привязки
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>Создать клиента</h3>
        <label>
          Имя
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Телефон
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <button className="btn primary" disabled={!name} onClick={create}>
          Создать
        </button>
      </div>
    </div>
  );
}

function ClientApp({ showToast }: { showToast: (s: string) => void }) {
  const [data, setData] = useState<ClientPayload | null>(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try {
      setData(await api<ClientPayload>("/api/client/me"));
    } catch (e: any) {
      showToast(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  if (loading)
    return <div className="card">Загрузка клиентского кабинета...</div>;
  if (!data)
    return (
      <div className="card">
        <h3 className="dangerText">Клиент не найден</h3>
        <p>Попроси админа выдать ключ привязки или привязать Telegram ID.</p>
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
      </div>
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
          {data.requests.map((r) => (
            <div className="item" key={r.id}>
              <div className="space">
                <b>Запрос #{r.id}</b>
                <span
                  className={`pill ${r.status === "pending" ? "warn" : r.status === "approved" ? "ok" : "danger"}`}
                >
                  {r.status}
                </span>
              </div>
              <p>
                {money(r.requested_monthly_amount)} · {r.reason}
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
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
