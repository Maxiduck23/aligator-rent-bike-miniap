#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const pagePath = path.join(root, 'app', 'page.tsx');
const financePath = path.join(root, 'components', 'finance', 'FinanceRangePanel.tsx');

if (!fs.existsSync(pagePath)) throw new Error(`Не найден ${pagePath}`);
let page = fs.readFileSync(pagePath, 'utf8');

function addImport(source, statement, anchor) {
  if (source.includes(statement)) return source;
  const i = source.indexOf(anchor);
  if (i < 0) throw new Error(`Не найден import anchor: ${anchor}`);
  const end = source.indexOf('\n', i);
  return source.slice(0, end + 1) + statement + '\n' + source.slice(end + 1);
}

function functionBounds(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Не найдена function ${name}`);
  const parenStart = source.indexOf('(', start);
  if (parenStart < 0) throw new Error(`Не найдена сигнатура function ${name}`);
  let pDepth = 0, sigQuote = null, sigEsc = false;
  let sigEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    const c = source[i];
    if (sigQuote) {
      if (sigEsc) { sigEsc = false; continue; }
      if (c === '\\') { sigEsc = true; continue; }
      if (c === sigQuote) sigQuote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { sigQuote = c; continue; }
    if (c === '(') pDepth++;
    else if (c === ')') { pDepth--; if (pDepth === 0) { sigEnd = i; break; } }
  }
  if (sigEnd < 0) throw new Error(`Не найден конец сигнатуры function ${name}`);
  let brace = source.indexOf('{', sigEnd);
  if (brace < 0) throw new Error(`Не найдено тело function ${name}`);
  let depth = 0, quote = null, esc = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error(`Не удалось найти конец function ${name}`);
}

function replaceFunction(source, name, replacement) {
  if (source.includes(`/* operations-v22:${name} */`)) return source;
  const b = functionBounds(source, name);
  return source.slice(0, b.start) + `/* operations-v22:${name} */\n${replacement}` + source.slice(b.end);
}

page = addImport(page, 'import OperationsDashboardV22 from "@/components/operations/OperationsDashboardV22";', 'import FinanceRangePanel');
page = addImport(page, 'import BatteryOverviewV22 from "@/components/operations/BatteryOverviewV22";', 'import OperationsDashboardV22');
page = addImport(page, 'import RequestsBoardV22 from "@/components/operations/RequestsBoardV22";', 'import BatteryOverviewV22');
page = addImport(page, 'import ClientActionsV22 from "@/components/client/ClientActionsV22";', 'import RequestsBoardV22');

// Extend admin tab union without depending on exact formatting.
if (!/type AdminTab\s*=([\s\S]*?)"dashboard"/.test(page)) {
  page = page.replace(/type AdminTab\s*=\s*([\s\S]*?);/, (m, body) => {
    if (!body.includes('"bikes"')) return m;
    return `type AdminTab =\n  "dashboard" | "batteries" | ${body.trim()};`;
  });
}
page = page.replace('useState<AdminTab>("bikes")', 'useState<AdminTab>("dashboard")');

// Admin tabs: insert Operations + Batteries right after AdminApp's tabs container.
if (!page.includes('data-operations-v22="dashboard-tab"')) {
  const fn = functionBounds(page, 'AdminApp');
  const marker = '<div className="tabs">';
  const at = page.indexOf(marker, fn.start);
  if (at < 0 || at > fn.end) throw new Error('Не найден tabs container внутри AdminApp');
  const insertAt = at + marker.length;
  const buttons = `\n        <button data-operations-v22="dashboard-tab" className={\`tab \${tab === "dashboard" ? "active" : ""}\`} onClick={() => setTab("dashboard")}>⚡ Центр</button>\n        <button className={\`tab \${tab === "batteries" ? "active" : ""}\`} onClick={() => setTab("batteries")}>🔋 Батареи</button>`;
  page = page.slice(0, insertAt) + buttons + page.slice(insertAt);
}

// Render new tabs before old bikes block.
if (!page.includes('{tab === "dashboard" && <OperationsDashboardV22')) {
  const fn = functionBounds(page, 'AdminApp');
  const marker = '{tab === "bikes" &&';
  const at = page.indexOf(marker, fn.start);
  if (at < 0 || at > fn.end) throw new Error('Не найден render bikes внутри AdminApp');
  page = page.slice(0, at) + '{tab === "dashboard" && <OperationsDashboardV22 showToast={showToast} />}\n      {tab === "batteries" && <BatteryOverviewV22 showToast={showToast} />}\n      ' + page.slice(at);
}

// Requests tab becomes structured operations board.
page = page.replace('{tab === "requests" && <RuleRequestsTab showToast={showToast} />}', '{tab === "requests" && <RequestsBoardV22 showToast={showToast} />}');

// Remove obsolete client copy about payment-rule requests; v2.2 uses structured requests.
page = page.replace(
  'Тут клиент видит баланс, долги, платежи и может отправлять запрос на изменение правила оплаты. Подтверждает только админ.',
  'Тут клиент видит баланс, долги, платежи, состояние велосипеда и отправляет структурированные заявки.'
);

// Client old comment-based request form is replaced by structured requests + cash codes.
page = replaceFunction(page, 'ClientGeneralRequestBlock', `function ClientGeneralRequestBlock({ showToast, reload }: { showToast: (s: string) => void; reload: () => Promise<void> }) {\n  return <ClientActionsV22 showToast={showToast} reload={reload} />;\n}`);

fs.writeFileSync(pagePath, page);
console.log(`OK page: ${pagePath}`);

// Old generic token redemption offered cash/card/bank. Cash codes are now handled by
// OperationsDashboardV22, so hide the old widget to prevent accidental bank/card use.
if (fs.existsSync(financePath)) {
  let finance = fs.readFileSync(financePath, 'utf8');
  const before = finance;
  finance = finance.replace(/\n\s*<PaymentTokenAdmin showToast=\{showToast\} onDone=\{\(\) => load\(\)\.catch\(\(\) => null\)\} \/>\s*\n/, '\n');
  if (finance !== before) {
    fs.writeFileSync(financePath, finance);
    console.log(`OK finance: hidden legacy generic payment-token widget`);
  } else if (!finance.includes('PaymentTokenAdmin showToast=')) {
    console.log('OK finance: legacy token widget already absent');
  } else {
    console.warn('WARN: legacy PaymentTokenAdmin usage was not patched automatically');
  }
}
