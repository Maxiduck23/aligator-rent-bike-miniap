import { NextRequest } from "next/server";
import { fail, ok, optionalString } from "@/lib/http";
import { requireAdmin } from "@/lib/telegram";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ParsedLine = { line: string; bike_id: number; amount: number; action: "payment" | "debt"; charge_type: string };
function norm(text: string) { return (text || "").toLowerCase().replace(/ё/g,"е").replace(/[–—]/g,"-").replace(/\u00a0/g," ").trim(); }
function parseAmount(raw: string, suffix?: string) { const n=Number(raw.replace(",",".")); if(!Number.isFinite(n)||n<=0) throw new Error(`Некорректная сумма: ${raw}`); return suffix && /^(к|k)$/i.test(suffix) && n<1000 ? Math.round(n*1000) : n; }
function detectBikeId(line: string) { const n=norm(line); for(const pat of [/(?:вел(?:ик)?|bike|vel|b|байк|дуотс|duotts|игвей|engwe)\s*#?\s*(\d{1,5})/iu,/(\d{1,5})\s*(?:вел(?:ик)?|bike|vel|байк|дуотс|duotts|игвей|engwe)/iu,/#\s*(\d{1,5})/iu]) { const m=n.match(pat); if(m && Number(m[1])>0) return Number(m[1]); } return null; }
function detectAmount(line: string) { const candidates:Array<{amount:number,idx:number}>=[]; for(const m of line.matchAll(/(?<!\d)(\d+(?:[\.,]\d+)?)(?:\s*(к|k)(?=$|[\s.,;:!?)]))?/giu)){ candidates.push({amount:parseAmount(m[1],m[2]),idx:m.index||0}); } candidates.sort((a,b)=>b.amount-a.amount||a.idx-b.idx); return candidates[0]?.amount ?? null; }
function isDebtLine(line: string) { return /(долг|долги|должен|должна|должны|торчит|торчу|dluh)/iu.test(norm(line)); }
function detectChargeType(line: string) { const n=norm(line); if(/(аренда|аренд|оренда|оренд|rent|pronajem|pronájem)/iu.test(n)) return "rent"; if(/(сервис|ремонт|service|servis|oprava)/iu.test(n)) return "repair"; if(/(штраф|fine|pokuta)/iu.test(n)) return "fine"; if(/(депозит|залог|deposit)/iu.test(n)) return "deposit"; return "other"; }
function parseLines(text:string,forceAction?:"payment"|"debt",defaultChargeType="rent") {
  const out:ParsedLine[]=[];
  for(const line of (text||"").replace(/\u00a0/g," ").split(/\r?\n|;+/).map(x=>x.trim()).filter(Boolean)){
    const bike=detectBikeId(line), amount=detectAmount(line); if(!bike||!amount) throw new Error(`Не понял строку: "${line}"`);
    const action=forceAction || (isDebtLine(line)?"debt":"payment");
    out.push({line,bike_id:bike,amount,action,charge_type:action==="debt"?(defaultChargeType!=="auto"?defaultChargeType:detectChargeType(line)):"rent"});
  }
  if(!out.length) throw new Error("Не найдено ни одной строки");
  return out;
}
async function activeRental(bikeId:number){ const {data,error}=await supabaseAdmin.from("rentals").select("id,client_id,bike_id,status").eq("bike_id",bikeId).eq("status","active").order("id",{ascending:false}).limit(1).maybeSingle(); if(error) throw error; return data; }
async function duplicate(item:ParsedLine,rental:any,dateValue:string){
  const start=new Date(dateValue); start.setDate(start.getDate()-2); const from=start.toISOString().slice(0,10);
  if(item.action==="payment") { const {data,error}=await supabaseAdmin.from("client_payments").select("id,amount,payment_date,client_id,rental_id,notes").eq("client_id",Number(rental.client_id)).eq("amount",item.amount).gte("payment_date",from).order("id",{ascending:false}).limit(1); if(error) throw error; return data?.[0]||null; }
  const {data,error}=await supabaseAdmin.from("client_charges").select("id,amount,due_date,client_id,rental_id,bike_id,charge_type,notes").eq("client_id",Number(rental.client_id)).eq("bike_id",item.bike_id).eq("amount",item.amount).eq("charge_type",item.charge_type).gte("due_date",from).order("id",{ascending:false}).limit(1); if(error) throw error; return data?.[0]||null;
}

export async function POST(req: NextRequest) {
  try {
    const auth=requireAdmin(req); const body=await req.json();
    const text=optionalString(body.text)||""; if(!text.trim()) throw new Error("text is required");
    const paymentDate=optionalString(body.payment_date)||new Date().toISOString().slice(0,10);
    const dueDate=optionalString(body.due_date)||paymentDate; const periodStart=optionalString(body.period_start); const periodEnd=optionalString(body.period_end);
    const method=optionalString(body.method)||"manual_chat"; const note=optionalString(body.note)||"quick payment/debt text";
    const forceRaw=optionalString(body.force_action); const forceAction=forceRaw==="payment"||forceRaw==="debt"?forceRaw:undefined;
    const defaultChargeType=optionalString(body.default_charge_type)||"rent"; const confirmDuplicate=Boolean(body.confirm_duplicate);
    const parsed=parseLines(text,forceAction,defaultChargeType); const results:any[]=[];
    if(!confirmDuplicate){ const duplicates:any[]=[]; for(const item of parsed){ const rental=await activeRental(item.bike_id); if(!rental?.client_id) continue; const d=await duplicate(item,rental,item.action==="debt"?dueDate:paymentDate); if(d) duplicates.push({line:item.line,bike_id:item.bike_id,amount:item.amount,action:item.action,duplicate:d}); } if(duplicates.length) return ok({duplicate_warning:true,duplicates,parsed_count:0,results:[]}); }
    const auditChat=Number(process.env.PAYMENT_AUDIT_CHAT_ID||"-5156455929");
    for(const item of parsed){
      if(item.action==="debt"){
        const rental=await activeRental(item.bike_id); if(!rental?.client_id) throw new Error(`${item.line}: active аренда #${item.bike_id} не найдена`);
        const {data,error}=await supabaseAdmin.rpc("miniapp_create_manual_charge",{p_client_id:Number(rental.client_id),p_rental_id:Number(rental.id),p_bike_id:item.bike_id,p_charge_type:item.charge_type,p_amount:item.amount,p_due_date:dueDate,p_period_start:periodStart,p_period_end:periodEnd,p_note:`${note}; DEBT; ${item.line}`,p_admin_tg_id:auth.telegramId}); if(error) throw new Error(`${item.line}: ${error.message}`); results.push({...item,result:data});
      } else {
        const {data,error}=await supabaseAdmin.rpc("miniapp_record_bike_payment_v2",{
          p_bike_id:item.bike_id,p_amount:item.amount,p_method:method,p_payment_date:paymentDate,
          p_note:`${note}; PAYMENT; ${item.line}`,p_admin_tg_id:auth.telegramId,
          p_source:"admin_miniapp_quick",p_audit_chat_id:Number.isFinite(auditChat)?auditChat:null
        });
        if(error) throw new Error(`${item.line}: ${error.message}`);
        results.push({...item,result:data});
      }
    }
    return ok({parsed_count:parsed.length,results});
  } catch(e){ return fail(e); }
}
