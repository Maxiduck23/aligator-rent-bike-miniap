'use client';

import { useEffect, useMemo, useState } from 'react';

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

type Client = { id: number; name: string; phone?: string | null; telegram_id?: number | null; active_bike_ids?: number[] };
type Debt = { charge_id: number; client_id: number; client_name: string; bike_id: number | null; bike_label: string | null; debt_left: number; amount: number; paid_amount: number; due_date: string; status: string; is_excluded: boolean; overdue_days: number; private_telegram_id?: number | null; client_telegram_id?: number | null; charge_type?: string };
type ExceptionRow = { severity: string; exception_type: string; entity_id: number; title: string; description: string };

type BikeContext = {
  bike: BikeCard;
  active_rentals: any[];
  charges: Debt[];
  payment_rules: any[];
  batteries: any[];
};

type Part = { due_day: number; amount: number };

type Tab = 'bikes' | 'debts' | 'exceptions' | 'clients';

function initData(): string {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData || '';
}

function telegramStatus(): string {
  if (typeof window === 'undefined') return 'server';
  const tg = window.Telegram?.WebApp;
  if (!tg) return 'telegram-web-app.js не загружен';
  if (!tg.initData) return 'initData нет: открой через кнопку бота в Telegram';
  return 'Telegram OK';
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-init-data': initData(),
      ...(options.headers || {})
    }
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.error || 'API error');
  return json.data as T;
}

function money(value: unknown) {
  const n = Number(value || 0);
  return `${Math.round(n)} Kč`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function WarningPills({ warnings }: { warnings?: string[] | null }) {
  if (!warnings?.length) return <span className="pill ok">OK</span>;
  return <>{warnings.map((w) => <span key={w} className="pill warn">{w}</span>)}</>;
}

export default function Page() {
  const [tab, setTab] = useState<Tab>('bikes');
  const [toast, setToast] = useState('');
  const [tgStatus, setTgStatus] = useState('loading');

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    setTgStatus(telegramStatus());
  }, []);

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(''), 4200);
  }

  return (
    <main className="app">
      <div className="header">
        <div>
          <div className="title">🚲 Aligator Rent CRM</div>
          <div className="sub">Bike-centered Mini App: долги, аренды, правила оплаты, Telegram привязки</div>
        </div>
        <div className="badge" title={tgStatus}>admin only · {tgStatus === 'Telegram OK' ? 'TG OK' : 'TG ?'}</div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'bikes' ? 'active' : ''}`} onClick={() => setTab('bikes')}>🚲 Велики</button>
        <button className={`tab ${tab === 'debts' ? 'active' : ''}`} onClick={() => setTab('debts')}>⚠️ Долги</button>
        <button className={`tab ${tab === 'exceptions' ? 'active' : ''}`} onClick={() => setTab('exceptions')}>🚨 Исключения</button>
        <button className={`tab ${tab === 'clients' ? 'active' : ''}`} onClick={() => setTab('clients')}>👤 Клиенты</button>
      </div>

      {tab === 'bikes' && <BikesTab showToast={showToast} />}
      {tab === 'debts' && <DebtsTab showToast={showToast} />}
      {tab === 'exceptions' && <ExceptionsTab />}
      {tab === 'clients' && <ClientsTab showToast={showToast} />}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function BikesTab({ showToast }: { showToast: (s: string) => void }) {
  const [bikes, setBikes] = useState<BikeCard[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [ctx, setCtx] = useState<BikeContext | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadBikes() {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (status !== 'all') params.set('status', status);
    const data = await api<BikeCard[]>(`/api/admin/bikes?${params.toString()}`);
    setBikes(data);
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

  useEffect(() => { loadBikes().catch((e) => showToast(e.message)); }, [status]);

  const sorted = useMemo(() => bikes, [bikes]);

  return (
    <div className="grid">
      <div className="card">
        <h3 className="section-title">Выбор велика</h3>
        <div className="row">
          <input className="input" placeholder="Поиск #id, бренд, модель" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadBikes().catch((er) => showToast(er.message))} />
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">Все статусы</option>
            <option value="rented">rented</option>
            <option value="free">free</option>
            <option value="sold">sold</option>
            <option value="waiting">waiting</option>
            <option value="repair">repair</option>
          </select>
          <button className="btn primary" onClick={() => loadBikes().catch((e) => showToast(e.message))}>Обновить</button>
        </div>
        <hr className="hr" />
        <div className="list">
          {sorted.map((b) => (
            <button key={b.id} className={`item ${selected === b.id ? 'active' : ''} ${(b.warnings || []).length ? 'warn' : ''}`} onClick={() => loadContext(b.id).catch((e) => showToast(e.message))}>
              <div className="space"><b>{b.bike_label}</b><span className="pill">{b.status}</span></div>
              <div className="small muted">{b.client_name ? `Клиент: ${b.client_name}` : 'Без active клиента'} · долг {money(b.debt_total)}</div>
              <div className="row" style={{ marginTop: 6 }}><WarningPills warnings={b.warnings} /></div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {!selected && <div className="card"><h3>Выбери велик слева</h3><p className="muted">После выбора Mini App сам подтянет аренду, клиента, долги, батареи, Telegram и правило оплаты.</p></div>}
        {loading && <div className="card">Загрузка...</div>}
        {ctx && !loading && <BikeContextPanel ctx={ctx} reload={() => loadContext(ctx.bike.id)} showToast={showToast} />}
      </div>
    </div>
  );
}

function BikeContextPanel({ ctx, reload, showToast }: { ctx: BikeContext; reload: () => Promise<void>; showToast: (s: string) => void }) {
  const active = ctx.active_rentals[0];
  return (
    <>
      <div className="card">
        <div className="space">
          <h2 className="section-title">{ctx.bike.bike_label}</h2>
          <span className="pill">{ctx.bike.status}</span>
        </div>
        <div className="row"><WarningPills warnings={ctx.bike.warnings} /></div>
        <hr className="hr" />
        <div className="kv">
          <div>Active rental</div><div>{active ? `#${active.id}` : <span className="warnText">нет</span>}</div>
          <div>Клиент</div><div>{active ? `#${active.client_id} ${active.client_name}` : '-'}</div>
          <div>Telegram</div><div>{active ? (active.private_telegram_id || active.client_telegram_id || <span className="dangerText">не привязан</span>) : '-'}</div>
          <div>Цена</div><div>{active ? money(active.price) : '-'}</div>
          <div>Долг</div><div className="money">{money(ctx.bike.debt_total)} / {ctx.bike.open_debts} начисл.</div>
          <div>Батареи</div><div>{ctx.batteries.length ? ctx.batteries.map((b) => `#${b.id}`).join(', ') : '-'}</div>
          <div>Правила оплаты</div><div>{ctx.payment_rules.length ? ctx.payment_rules.map((r) => `#${r.id} ${r.is_active ? 'active' : 'off'}`).join(', ') : <span className="warnText">нет</span>}</div>
        </div>
      </div>

      <BikeDebtBlock debts={ctx.charges} showToast={showToast} reload={reload} />
      <PaymentRuleBlock bike={ctx.bike} active={active} showToast={showToast} reload={reload} />
      <RentalActionsBlock bike={ctx.bike} active={active} showToast={showToast} reload={reload} />
      <LinkBlock active={active} showToast={showToast} reload={reload} />
    </>
  );
}

function BikeDebtBlock({ debts, showToast, reload }: { debts: Debt[]; showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => setSelected(debts.filter((d) => !d.is_excluded).map((d) => d.charge_id)), [debts]);
  const total = debts.filter((d) => selected.includes(d.charge_id)).reduce((s, d) => s + Number(d.debt_left), 0);

  function toggle(id: number) { setSelected((x) => x.includes(id) ? x.filter((i) => i !== id) : [...x, id]); }
  async function paid() {
    if (!selected.length) return showToast('Ничего не выбрано');
    if (!confirm(`Отметить выбранные долги как оплаченные на сумму ${money(total)}?`)) return;
    await api('/api/admin/debts/bulk-paid', { method: 'POST', body: JSON.stringify({ charge_ids: selected, method: 'manual', note: 'paid from bike card' }) });
    showToast('Оплаты записаны');
    await reload();
  }
  async function exclude() {
    if (!selected.length) return showToast('Ничего не выбрано');
    const reason = prompt('Причина исключения из Mini App списка долгов', 'дубль / ошибочное начисление / проверить вручную');
    if (!reason) return;
    await api('/api/admin/debts/bulk-exclude', { method: 'POST', body: JSON.stringify({ charge_ids: selected, reason }) });
    showToast('Исключено из Mini App списка');
    await reload();
  }
  async function remind() {
    if (!selected.length) return showToast('Ничего не выбрано');
    const res = await api<any>('/api/admin/debts/bulk-remind', { method: 'POST', body: JSON.stringify({ charge_ids: selected }) });
    showToast(`Напоминания: отправлено ${res.sent?.length || 0}, пропущено ${res.skipped?.length || 0}`);
  }

  return (
    <div className="card">
      <div className="space"><h3 className="section-title">⚠️ Долги велика</h3><span className="money">выбрано {money(total)}</span></div>
      <div className="row">
        <button className="btn" onClick={() => setSelected(debts.filter((d) => !d.is_excluded).map((d) => d.charge_id))}>Выбрать все</button>
        <button className="btn" onClick={() => setSelected([])}>Снять все</button>
        <button className="btn ok" onClick={paid}>✅ Оплачено</button>
        <button className="btn warn" onClick={remind}>📢 Напомнить</button>
        <button className="btn danger" onClick={exclude}>🙈 Исключить</button>
      </div>
      <hr className="hr" />
      {!debts.length && <p className="muted">Открытых долгов нет.</p>}
      {debts.length > 0 && <table className="table"><thead><tr><th></th><th>ID</th><th>Дата</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>
        {debts.map((d) => <tr key={d.charge_id} className={d.is_excluded ? 'muted' : ''}>
          <td><input className="check" type="checkbox" checked={selected.includes(d.charge_id)} onChange={() => toggle(d.charge_id)} disabled={d.is_excluded} /></td>
          <td>#{d.charge_id}<br /><span className="small muted">{d.charge_type}</span></td>
          <td>{d.due_date}<br /><span className="small dangerText">{d.overdue_days} дн.</span></td>
          <td>{money(d.debt_left)}<br /><span className="small muted">из {money(d.amount)}</span></td>
          <td>{d.is_excluded ? <span className="pill warn">excluded</span> : <span className="pill">{d.status}</span>}</td>
        </tr>)}
      </tbody></table>}
    </div>
  );
}

function PaymentRuleBlock({ bike, active, showToast, reload }: { bike: BikeCard; active: any; showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [monthly, setMonthly] = useState<number>(Number(active?.price || bike.active_price || 6000));
  const [parts, setParts] = useState<Part[]>([{ due_day: 1, amount: Number(active?.price || bike.active_price || 6000) }]);
  const sum = parts.reduce((s, p) => s + Number(p.amount || 0), 0);

  function preset(count: number) {
    const amount = Math.round(monthly / count);
    const days = count === 1 ? [1] : count === 2 ? [1, 15] : count === 4 ? [1, 8, 15, 22] : Array.from({ length: count }, (_, i) => Math.min(1 + i * Math.floor(28 / count), 28));
    setParts(days.map((d, idx) => ({ due_day: d, amount: idx === days.length - 1 ? monthly - amount * (days.length - 1) : amount })));
  }
  async function save() {
    if (!active) return showToast('У велика нет active-аренды');
    await api('/api/admin/payment-rules', { method: 'POST', body: JSON.stringify({ bike_id: bike.id, monthly_amount: monthly, parts, note: 'created from Mini App' }) });
    showToast('Правило оплаты сохранено');
    await reload();
  }

  return (
    <div className="card">
      <h3 className="section-title">⚙️ Правило оплаты</h3>
      {!active && <p className="dangerText">Нет active-аренды — правило создать нельзя.</p>}
      <div className="formgrid">
        <label>Месячная сумма<input className="input" type="number" value={monthly} onChange={(e) => setMonthly(Number(e.target.value))} /></label>
        <label>Итого частей<input className="input" value={sum} readOnly /></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => preset(1)}>1 платёж</button>
        <button className="btn" onClick={() => preset(2)}>2 части</button>
        <button className="btn" onClick={() => preset(4)}>4 части</button>
        <button className="btn" onClick={() => setParts([...parts, { due_day: 1, amount: 0 }])}>+ часть</button>
      </div>
      <hr className="hr" />
      {parts.map((p, idx) => <div className="formgrid" key={idx} style={{ marginBottom: 8 }}>
        <label>День месяца<input className="input" type="number" min={1} max={31} value={p.due_day} onChange={(e) => setParts(parts.map((x, i) => i === idx ? { ...x, due_day: Number(e.target.value) } : x))} /></label>
        <label>Сумма<input className="input" type="number" value={p.amount} onChange={(e) => setParts(parts.map((x, i) => i === idx ? { ...x, amount: Number(e.target.value) } : x))} /></label>
        <button className="btn danger" onClick={() => setParts(parts.filter((_, i) => i !== idx))}>Удалить</button>
      </div>)}
      <div className="space"><span className={sum < monthly ? 'dangerText' : 'okText'}>Итого {money(sum)} / {money(monthly)}</span><button className="btn primary" disabled={!active || sum < monthly} onClick={save}>Сохранить</button></div>
    </div>
  );
}

function RentalActionsBlock({ bike, active, showToast, reload }: { bike: BikeCard; active: any; showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [price, setPrice] = useState(String(active?.price || bike.active_price || 6000));
  const [start, setStart] = useState(today());
  const [deposit, setDeposit] = useState(String(active?.deposit || 0));
  const [chargers, setChargers] = useState(String(active?.charger_quantity || 1));
  const [notes, setNotes] = useState('');
  const [closeStatus, setCloseStatus] = useState('free');

  useEffect(() => { api<Client[]>('/api/admin/clients').then(setClients).catch(() => null); }, []);
  async function create() {
    await api('/api/admin/rentals/new', { method: 'POST', body: JSON.stringify({ bike_id: bike.id, client_id: Number(clientId), price: Number(price), start_date: start, deposit: Number(deposit), charger_quantity: Number(chargers), rental_type: 'monthly', notes }) });
    showToast('Аренда создана'); await reload();
  }
  async function close() {
    if (!confirm(`Закрыть active-аренду велика #${bike.id}?`)) return;
    await api('/api/admin/rentals/close', { method: 'POST', body: JSON.stringify({ bike_id: bike.id, end_date: today(), bike_status: closeStatus, notes }) });
    showToast('Аренда закрыта'); await reload();
  }
  async function replace() {
    if (!confirm(`Переоформить велик #${bike.id} на нового клиента #${clientId}?`)) return;
    await api('/api/admin/rentals/replace', { method: 'POST', body: JSON.stringify({ bike_id: bike.id, new_client_id: Number(clientId), price: Number(price), start_date: start, deposit: Number(deposit), charger_quantity: Number(chargers), rental_type: 'monthly', notes }) });
    showToast('Новый договор создан'); await reload();
  }

  return (
    <div className="card">
      <h3 className="section-title">📄 Аренда</h3>
      <div className="formgrid">
        <label>Клиент<select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">выбери клиента</option>{clients.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.name}</option>)}</select></label>
        <label>Цена<input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <label>Дата начала<input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label>Депозит<input className="input" type="number" value={deposit} onChange={(e) => setDeposit(e.target.value)} /></label>
        <label>Зарядки<input className="input" type="number" value={chargers} onChange={(e) => setChargers(e.target.value)} /></label>
        <label>Статус после закрытия<select className="select" value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)}><option value="free">free</option><option value="sold">sold</option><option value="repair">repair</option><option value="waiting">waiting</option></select></label>
      </div>
      <label>Заметка<textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={!!active || !clientId} onClick={create}>➕ Новая аренда</button>
        <button className="btn warn" disabled={!active} onClick={close}>📄 Закрыть аренду</button>
        <button className="btn primary" disabled={!active || !clientId} onClick={replace}>♻️ Новый договор</button>
      </div>
    </div>
  );
}

function LinkBlock({ active, showToast, reload }: { active: any; showToast: (s: string) => void; reload: () => Promise<void> }) {
  const [telegramId, setTelegramId] = useState('');
  const [invite, setInvite] = useState('');
  async function link() {
    if (!active) return showToast('Нет active клиента');
    await api('/api/admin/link-telegram', { method: 'POST', body: JSON.stringify({ client_id: active.client_id, telegram_id: Number(telegramId) }) });
    showToast('Telegram привязан'); await reload();
  }
  async function createInvite(clientId: number | null) {
    const data = await api<any>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ client_id: clientId, notes: clientId ? 'link existing client' : 'create new client' }) });
    setInvite(data.link);
    await navigator.clipboard?.writeText(data.link).catch(() => null);
    showToast('Ссылка создана и скопирована');
  }
  return (
    <div className="card">
      <h3 className="section-title">🔗 Telegram / ключ клиента</h3>
      <div className="formgrid">
        <label>Telegram ID<input className="input" value={telegramId} onChange={(e) => setTelegramId(e.target.value)} placeholder="123456789" /></label>
        <button className="btn primary" disabled={!active || !telegramId} onClick={link}>Привязать к active клиенту</button>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" disabled={!active} onClick={() => createInvite(active?.client_id || null)}>Ключ для active клиента</button>
        <button className="btn" onClick={() => createInvite(null)}>Ключ для нового клиента</button>
      </div>
      {invite && <p>Ссылка: <span className="code">{invite}</span></p>}
    </div>
  );
}

function DebtsTab({ showToast }: { showToast: (s: string) => void }) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [includeExcluded, setIncludeExcluded] = useState(false);
  const total = debts.filter((d) => selected.includes(d.charge_id)).reduce((s, d) => s + Number(d.debt_left), 0);
  async function load() {
    const data = await api<Debt[]>(`/api/admin/debts?include_excluded=${includeExcluded ? 1 : 0}&only_overdue=0`);
    setDebts(data); setSelected(data.filter((d) => !d.is_excluded).map((d) => d.charge_id));
  }
  useEffect(() => { load().catch((e) => showToast(e.message)); }, [includeExcluded]);
  function toggle(id: number) { setSelected((x) => x.includes(id) ? x.filter((i) => i !== id) : [...x, id]); }
  async function post(url: string, body: any, msg: string) { await api(url, { method: 'POST', body: JSON.stringify(body) }); showToast(msg); await load(); }
  return <div className="card"><div className="space"><h3>⚠️ Все долги</h3><span className="money">выбрано {money(total)}</span></div>
    <div className="row">
      <button className="btn" onClick={() => setSelected(debts.filter((d) => !d.is_excluded).map((d) => d.charge_id))}>Выбрать все</button>
      <button className="btn" onClick={() => setSelected([])}>Снять все</button>
      <button className="btn warn" onClick={() => post('/api/admin/debts/bulk-remind', { charge_ids: selected }, 'Напоминания отправлены')}>📢 Напомнить выбранным</button>
      <button className="btn ok" onClick={() => confirm(`Оплатить выбранные ${money(total)}?`) && post('/api/admin/debts/bulk-paid', { charge_ids: selected, method: 'manual', note: 'bulk paid from debts tab' }, 'Оплаты записаны')}>✅ Оплачено выбранное</button>
      <button className="btn danger" onClick={() => { const reason = prompt('Причина исключения', 'дубль / ошибка / проверить'); if (reason) post('/api/admin/debts/bulk-exclude', { charge_ids: selected, reason }, 'Исключено'); }}>🙈 Исключить выбранное</button>
      <label className="row small"><input type="checkbox" checked={includeExcluded} onChange={(e) => setIncludeExcluded(e.target.checked)} /> показать исключённые</label>
    </div>
    <hr className="hr" />
    <table className="table"><thead><tr><th></th><th>Клиент</th><th>Велик</th><th>Дата</th><th>Долг</th><th>Telegram</th></tr></thead><tbody>{debts.map((d) => <tr key={d.charge_id}>
      <td><input className="check" type="checkbox" checked={selected.includes(d.charge_id)} onChange={() => toggle(d.charge_id)} disabled={d.is_excluded} /></td>
      <td>#{d.client_id} {d.client_name}<br /><span className="small muted">charge #{d.charge_id}</span></td>
      <td>{d.bike_label || '-'}</td><td>{d.due_date}<br /><span className="small dangerText">{d.overdue_days} дн.</span></td><td>{money(d.debt_left)}</td>
      <td>{d.private_telegram_id || d.client_telegram_id ? <span className="pill ok">есть</span> : <span className="pill danger">нет</span>} {d.is_excluded && <span className="pill warn">excluded</span>}</td>
    </tr>)}</tbody></table></div>;
}

function ExceptionsTab() {
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  useEffect(() => { api<ExceptionRow[]>('/api/admin/exceptions').then(setRows).catch(console.error); }, []);
  return <div className="card"><h3>🚨 Исключения и предупреждения</h3><p className="muted">Это список мест, где учёт может врать или автоматизация не сработает.</p><div className="list">
    {rows.map((r, idx) => <div key={idx} className={`item ${r.severity === 'critical' ? 'critical' : 'warn'}`}><div className="space"><b>{r.title}</b><span className={`pill ${r.severity === 'critical' ? 'danger' : 'warn'}`}>{r.severity}</span></div><div className="small muted">{r.exception_type}</div><p>{r.description}</p></div>)}
    {!rows.length && <p className="okText">Критичных исключений нет.</p>}
  </div></div>;
}

function ClientsTab({ showToast }: { showToast: (s: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  async function load() { setClients(await api<Client[]>(`/api/admin/clients?q=${encodeURIComponent(q)}`)); }
  useEffect(() => { load().catch((e) => showToast(e.message)); }, []);
  async function create() { await api('/api/admin/clients', { method: 'POST', body: JSON.stringify({ name, phone }) }); setName(''); setPhone(''); showToast('Клиент создан'); await load(); }
  async function invite(clientId: number) { const data = await api<any>('/api/admin/invites', { method: 'POST', body: JSON.stringify({ client_id: clientId }) }); await navigator.clipboard?.writeText(data.link).catch(() => null); showToast(`Ключ скопирован: ${data.link}`); }
  return <div className="grid"><div className="card"><h3>👤 Клиенты</h3><div className="row"><input className="input" placeholder="поиск" value={q} onChange={(e) => setQ(e.target.value)} /><button className="btn" onClick={load}>Найти</button></div><hr className="hr" /><div className="list">{clients.map((c) => <div className="item" key={c.id}><div className="space"><b>#{c.id} {c.name}</b>{c.telegram_id ? <span className="pill ok">TG</span> : <span className="pill warn">no TG</span>}</div><div className="small muted">{c.phone || '-'} · bikes {(c.active_bike_ids || []).join(', ') || '-'}</div><button className="btn" style={{ marginTop: 8 }} onClick={() => invite(c.id)}>🔑 Ключ привязки</button></div>)}</div></div><div className="card"><h3>Создать клиента</h3><label>Имя<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label><label>Телефон<input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></label><button className="btn primary" disabled={!name} onClick={create}>Создать</button></div></div>;
}
