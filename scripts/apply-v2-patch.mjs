import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const pagePath = path.join(root, "app", "page.tsx");
if (!fs.existsSync(pagePath)) throw new Error(`Не найден ${pagePath}`);
let source = fs.readFileSync(pagePath, "utf8");

const importLine = 'import FinanceRangePanel from "@/components/finance/FinanceRangePanel";';
if (!source.includes(importLine)) {
  const anchor = 'import RentalContractForm from "@/components/rentals/RentalContractForm";';
  if (source.includes(anchor)) source = source.replace(anchor, `${anchor}\n${importLine}`);
  else source = source.replace(/^"use client";\s*/m, `"use client";\n\n${importLine}\n`);
}

const financeRe = /function FinanceLogTab\(\{ showToast \}: \{ showToast: \(s: string\) => void \}\) \{[\s\S]*?\n\}\n\n\nfunction BusinessDebtsBlock/;
const replacement = `function FinanceLogTab({ showToast }: { showToast: (s: string) => void }) {\n  return <FinanceRangePanel showToast={showToast} />;\n}\n\n\nfunction BusinessDebtsBlock`;
if (financeRe.test(source)) {
  source = source.replace(financeRe, replacement);
} else if (!source.includes("return <FinanceRangePanel showToast={showToast} />")) {
  throw new Error("Не нашёл старый FinanceLogTab в app/page.tsx. Патч остановлен, файл не записан.");
}



// Payment rules are admin-only: no client request switch and no disabled-rule dump.
source = source.replace(/\s*const \[allowClientEdit, setAllowClientEdit\] = useState\(true\);/, "");
source = source.replace(/\s*const \[requiresApproval, setRequiresApproval\] = useState\(true\);/, "");
source = source.replace(/allow_client_edit:\s*allowClientEdit/g, "allow_client_edit: false");
source = source.replace(/requires_admin_approval:\s*requiresApproval/g, "requires_admin_approval: true");
source = source.replace(
  /\s*<div className="row" style=\{\{ marginTop: 10 \}\}>\s*<label className="row small">[\s\S]*?клиент может запросить изменение[\s\S]*?только после подтверждения админа[\s\S]*?<\/div>/,
  "",
);
source = source.replace(
  /\{ctx\.payment_rules\.length \? \(\s*ctx\.payment_rules\s*\.map\(\(r\) => `#\$\{r\.id\} \$\{r\.is_active \? "active" : "off"\}`\)\s*\.join\(", "\)\s*\) : \(\s*<span className="warnText">нет<\/span>\s*\)\}/,
  `{ctx.payment_rules.some((r) => r.is_active) ? (\n              <>\n                {ctx.payment_rules.filter((r) => r.is_active).map((r) => \`#\${r.id} active\`).join(", ")}\n                {ctx.payment_rules.filter((r) => !r.is_active).length > 0 && (\n                  <div className="small muted">История скрыта: {ctx.payment_rules.filter((r) => !r.is_active).length} старых правил</div>\n                )}\n              </>\n            ) : (\n              <span className="warnText">нет active правила</span>\n            )}`,
);

// Card/POS is a first-class manual payment method too.
source = source.replace(
  /<option value="cash">cash<\/option>\s*<option value="bank">bank<\/option>/g,
  `<option value="cash">cash</option><option value="card">card / POS</option><option value="bank">bank</option>`,
);

// Payment verification is shared by bot + Mini App, show it in payment tables.
if (!source.includes("verification_status?: string | null;")) {
  source = source.replace(
    /type Payment = \{([\s\S]*?)notes\?: string \| null;([\s\S]*?)\};/,
    (m, a, b) => `type Payment = {${a}notes?: string | null;\n  verification_status?: string | null;\n  verification_source?: string | null;${b}};`,
  );
}
source = source.replace(
  /<th>Метод<\/th>\s*<th>Заметка<\/th>/g,
  `<th>Метод</th><th>Проверка</th><th>Заметка</th>`,
);
source = source.replace(
  /<td>\{p\.method\}<\/td>\s*<td>\{p\.notes\}<\/td>/g,
  `<td>{p.method}</td><td><span className={\`pill \${p.verification_status === "verified" ? "ok" : p.verification_status === "reversed" || p.verification_status === "rejected" ? "danger" : "warn"}\`}>{p.verification_status || "legacy"}</span><div className="small muted">{p.verification_source || ""}</div></td><td>{p.notes}</td>`,
);

// Payment rule requests stay admin-only in UI.
source = source.replace(/<ClientRuleRequestBlock[\s\S]*?\/>/g, "");
source = source.replace(/\s*<option value="payment_rule_request">[\s\S]*?<\/option>/g, "");

fs.writeFileSync(pagePath, source, "utf8");
console.log("V2 page patch applied:");
console.log("- animated FinanceRangePanel enabled");
console.log("- old fixed 1/7/30 FinanceLogTab replaced");
console.log("- payment verification status added to payment tables");
console.log("- payment rule editing is admin-only; disabled history is hidden");
console.log("- client payment-rule request UI remains disabled");
console.log("- RentalContractForm import preserved");
