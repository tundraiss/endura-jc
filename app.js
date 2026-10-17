import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';
const $=id=>document.getElementById(id);
const configured=SUPABASE_URL.startsWith('https://')&&SUPABASE_PUBLISHABLE_KEY!=='PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY';
let db=null, jobs=[], customers=[], items=[], notices=[], stagePlans=[], ovenSettings={oven_count:2,loads_per_oven_per_day:1};
let editRemoved=new Set();
let signatures=[];let signatureDirty=false;let jobPhotos=[];
let plannerWeekOffset=0;
const statuses=['New','To Be Quoted','Pretreatment','Powder Coating','Curing / QC','Ready for Collection','Collected'];
const isQuote=j=>['New','To Be Quoted'].includes(j.status);
const isProduction=j=>['Pretreatment','Powder Coating','Curing / QC'].includes(j.status);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const msg=x=>{const t=$('toast');t.textContent=x;t.style.display='block';setTimeout(()=>t.style.display='none',5500)};
const check=(res)=>{if(res.error)throw res.error;return res.data};
function urgency(j){
 if(['Collected','Ready for Collection'].includes(j.status))return ['ok',j.status];
 const due=String(j.due_date||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(due))return ['ok','No completion date'];
 const now=new Date();now.setHours(0,0,0,0);
 const d=new Date(`${due}T00:00:00`);
 if(Number.isNaN(d.getTime()))return ['ok','Invalid completion date'];
 const days=Math.round((d-now)/86400000);
 return days<0?['overdue',`${-days} day(s) overdue`]:days<=7?['urgent',days===0?'Due today':`Due in ${days} day(s)`]:['ok',`Due in ${days} day(s)`];
}
function show(tab){for(const el of ['dashboard','quote','active','ready','new','planner','review','collected','jobPrintModal'])$(el).classList.toggle('hide',el!==tab);$('app').classList.toggle('hide',tab==='jobPrintModal');document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));if(tab!=='jobPrintModal'){document.body.classList.remove('job-print-preview-open');window.scrollTo({top:0,behavior:'instant'});const activeTab=document.querySelector('.tabs [data-tab].active');if(window.innerWidth>700)activeTab?.scrollIntoView({block:'nearest',inline:'nearest'});document.getElementById('mobileMore')?.classList.toggle('active',['quote','planner','review','collected'].includes(tab))}}
function itemRow(){const d=document.createElement('div');d.className='item';d.innerHTML=`<div class="row"><div><label>Item</label><input class="desc" required placeholder="Steel brackets"></div><div><label>Quantity</label><input class="qty" type="number" min="1" value="1" required></div><div><label>Colour</label><input class="colour" placeholder="Matt black"></div><div><label>Dimensions</label><input class="dimensions" placeholder="L x W x H"></div><div><label>Price (R)</label><input class="price" type="number" min="0" step="0.01" value="0"></div><button type="button" class="secondary remove">Remove</button></div>`;d.querySelector('.remove').onclick=()=>{if($('items').children.length>1)d.remove()};$('items').appendChild(d)}
async function load(){jobs=check(await db.from('jobs').select('*').is('deleted_at',null).order('created_at',{ascending:false}));customers=check(await db.from('customers').select('*'));items=check(await db.from('job_items').select('*'));notices=check(await db.from('notifications').select('*'));stagePlans=check(await db.from('job_stage_schedule').select('*'));signatures=check(await db.from('job_signatures').select('*'));jobPhotos=check(await db.from('job_photos').select('*').order('created_at',{ascending:true}));const settings=check(await db.from('oven_capacity_settings').select('*').eq('id',1).single());ovenSettings=settings;render();refreshPrintJobOptions()}
function whatsappPhone(raw){let p=String(raw||'').replace(/\D/g,'');if(p.startsWith('00'))p=p.slice(2);if(p.startsWith('0'))p='27'+p.slice(1);if(p.length===9)p='27'+p;return /^\d{10,15}$/.test(p)?p:null}
function reviewHTML(n){const j=jobs.find(x=>x.id===n.job_id),c=customers.find(x=>x.id===j?.customer_id)||{},phone=whatsappPhone(c.phone);const kind=n.kind==='collection'?'Collection':'Delay';return `<div class="job"><div class="job-head"><strong>${esc(j?.job_number||'Job')} — ${kind}</strong><span class="chip">${esc(n.status==='sent'?'Sent':n.status==='approved'?'Approved / unsent':'Needs review')}</span></div><p class="muted">${esc(c.name||'Customer')} · ${esc(c.phone||'No phone')}</p><label>Message (copy or open WhatsApp to edit before sending)</label><textarea data-message="${n.id}" rows="4">${esc(n.message)}</textarea><div class="row review-actions"><button class="secondary" data-copy="${n.id}">Copy message</button><button data-whatsapp="${n.id}" ${phone?'':'disabled title="Add a valid WhatsApp number to the customer"'}>Open WhatsApp</button>${j?.invoice_path?`<button class="secondary" data-review-invoice="${j.id}">Open invoice PDF</button>`:'<span class="muted">No invoice attached</span>'}<button class="secondary" data-sent="${n.id}">Mark as Sent</button><button class="secondary" data-dismiss="${n.id}">Dismiss</button></div><p class="muted">${n.kind==='collection'?(j?.invoice_path?'Attach the invoice PDF manually in WhatsApp. ':'No invoice attached; you can upload one later. '):''}Opening WhatsApp does not send the message.</p></div>`}
function render(){
 const active=jobs.filter(j=>isProduction(j));
 const outstanding=jobs.filter(j=>isProduction(j)||isQuote(j));
 const late=outstanding.filter(j=>urgency(j)[0]==='overdue');
 const urgent=outstanding.filter(j=>urgency(j)[0]==='urgent');
 const pending=notices.filter(n=>['draft','approved','pending_integration'].includes(n.status));
 const badge=$('reviewBadge');
 if(badge){
   badge.textContent=String(pending.length);
   badge.classList.toggle('hide',pending.length===0);
   badge.setAttribute('aria-label',`${pending.length} messages awaiting review`);
   const reviewTab=document.querySelector('[data-tab="review"]');
   if(reviewTab)reviewTab.setAttribute('aria-label',pending.length?`Review, ${pending.length} messages awaiting review`:'Review, no pending messages');
 }
 const metrics=[['Active jobs',active.length,'◫',''],['Due soon (7 days)',urgent.length,'◷',''],['Overdue',late.length,'!','metric-danger'],['Ready to collect',jobs.filter(j=>j.status==='Ready for Collection').length,'✓','metric-ready'],['Review messages',pending.length,'✉','metric-review']];
 $('stats').innerHTML=metrics.map(([name,count,icon,cls])=>`<button type="button" class="metric ${cls}" data-dashboard-target="${name==='Ready to collect'?'ready':name==='Review messages'?'review':(name==='Due soon (7 days)'||name==='Overdue')&&active.length===0?'quote':'active'}" aria-label="Open ${esc(name)}: ${count}"><span class="metric-icon" aria-hidden="true">${icon}</span><div class="metric-value">${count}</div><div class="metric-label">${name} <span aria-hidden="true">→</span></div></button>`).join('');
 $('dashboardDate').textContent=new Intl.DateTimeFormat('en-ZA',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
 const stages=[['To Be Quoted','#94a3b8'],['Pretreatment','#60a5fa'],['Powder Coating','#f59e0b'],['Curing / QC','#a78bfa'],['Ready for Collection','#4ade80']];
 const max=Math.max(1,...stages.map(([s])=>(s==='To Be Quoted'?jobs.filter(isQuote):s==='Ready for Collection'?jobs.filter(j=>j.status==='Ready for Collection'):active.filter(j=>j.status===s)).length));
 $('pipeline').innerHTML=stages.map(([s,color])=>{const count=(s==='To Be Quoted'?jobs.filter(isQuote):s==='Ready for Collection'?jobs.filter(j=>j.status==='Ready for Collection'):active.filter(j=>j.status===s)).length;return `<div class="pipeline-row"><span class="pipeline-name">${esc(s)}</span><div class="pipeline-track"><div class="pipeline-fill" style="width:${100*count/max}%;background:${color}"></div></div><span class="pipeline-count">${count}</span></div>`}).join('');
 const needs=[...late,...urgent].sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,5);
 $('attention').innerHTML=needs.map(j=>`<div class="attention-row"><div class="attention-title">${esc(j.job_number)} · ${esc(customers.find(c=>c.id===j.customer_id)?.name||'Customer')}</div><div class="attention-sub">${esc(urgency(j)[1])} · ${esc(j.status)}</div></div>`).join('')||'<div class="empty">No urgent jobs right now.</div>';
 renderJobList();
 $('quoteJobs').innerHTML=jobs.filter(isQuote).map(jobHTML).join('')||'<p class="muted">No jobs awaiting quotation.</p>';
 $('readyJobs').innerHTML=jobs.filter(j=>j.status==='Ready for Collection').map(jobHTML).join('')||'<p class="muted">No jobs ready for collection.</p>';
 renderPlanner();
 renderStagePlanner();
 renderOvenCapacity();
 $('archive').innerHTML=jobs.filter(j=>j.status==='Collected').map(jobHTML).join('')||'<p class="muted">No collected jobs yet.</p>';
 $('reviews').innerHTML=pending.map(reviewHTML).join('')||'<p class="muted">No messages awaiting review.</p>';
 $('reviewHistory').innerHTML=notices.filter(n=>['sent','failed'].includes(n.status)).map(n=>`<div class="job"><strong>${esc(jobs.find(j=>j.id===n.job_id)?.job_number||'Job')}</strong> — ${esc(n.kind)} · ${n.status==='sent'?'Marked sent':'Dismissed'}<p class="muted">${esc(n.message)}</p></div>`).join('')||'<p class="muted">No reviewed messages yet.</p>';
}
function localISO(date){const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');return `${y}-${m}-${d}`}
function weekStart(offset){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7)+offset*7);return d}
function planCard(j){
 const c=customers.find(c=>c.id===j.customer_id);
 return `<article class="planner-job"><strong>${esc(j.job_number)}</strong><span>${esc(c?.name||'Customer')} · ${esc(j.status)}</span><span>Completion: ${esc(j.due_date)}</span><button class="secondary" data-edit="${esc(j.id)}">View / Edit</button></article>`;
}
function renderPlanner(){
 const start=weekStart(plannerWeekOffset),end=new Date(start);end.setDate(start.getDate()+6);
 const fmt=new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short'});
 $('plannerRange').textContent=`${fmt.format(start)} – ${fmt.format(end)} ${end.getFullYear()}`;
 const today=localISO(new Date()),a=localISO(start),b=localISO(end);
 const active=jobs.filter(isProduction);
 const due=active.filter(j=>j.due_date>=a&&j.due_date<=b);
 const overdue=active.filter(j=>j.due_date<today);
 $('plannerSummary').innerHTML=`<div class="planner-pill"><strong>${due.length}</strong> Completing this week</div><div class="planner-pill"><strong>${overdue.length}</strong> Overdue</div>`;
 const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return d});
 const weekday=new Intl.DateTimeFormat('en-ZA',{weekday:'short'});
 $('plannerDays').innerHTML=days.map(d=>{const iso=localISO(d),dayJobs=due.filter(j=>j.due_date===iso);return `<div class="planner-day ${iso===today?'today':''}"><h3>${weekday.format(d)} ${d.getDate()}</h3><div class="planner-day-count">${dayJobs.length} due</div>${dayJobs.map(planCard).join('')||'<div class="planner-empty">No jobs due</div>'}</div>`}).join('');
 $('plannerOverdue').innerHTML=overdue.map(j=>`<div class="planner-overdue-row"><div><strong>${esc(j.job_number)}</strong> · ${esc(customers.find(c=>c.id===j.customer_id)?.name||'Customer')}<div class="muted">Promised ${esc(j.due_date)} · ${esc(j.status)}</div></div><button class="secondary" data-edit="${esc(j.id)}">Edit</button></div>`).join('')||'<p class="muted">No overdue jobs.</p>';
}
$('plannerPrev').onclick=()=>{plannerWeekOffset--;renderPlanner();renderStagePlanner();renderOvenCapacity()};
$('plannerNext').onclick=()=>{plannerWeekOffset++;renderPlanner();renderStagePlanner();renderOvenCapacity()};
$('plannerToday').onclick=()=>{plannerWeekOffset=0;renderPlanner();renderStagePlanner();renderOvenCapacity()};
function calculatedDailyCapacity(){
 const ovens=Number(ovenSettings.oven_count)||1, cap=Number(ovenSettings.loads_per_oven_per_day)||1;
 const mins=Number(ovenSettings.cycle_minutes)||60, hours=Number(ovenSettings.operating_hours)||8;
 return ovens*Math.min(cap,Math.floor(hours*60/mins));
}
function findOvenSlot(jobId){
 const j=jobs.find(x=>x.id===jobId);if(!j)return {error:'Job not found'};
 const current=stagePlans.find(p=>p.job_id===jobId&&p.stage==='Curing / QC');
 const coating=stagePlans.find(p=>p.job_id===jobId&&p.stage==='Powder Coating');
 if(!current)return {error:'No curing stage exists for this job'};
 const capacity=calculatedDailyCapacity(),needed=Number(j.oven_loads)||1;
 if(capacity<1)return {error:'Configured oven capacity is zero. Increase hours or shorten cycle time.'};
 if(needed>capacity)return {error:`This job requires ${needed} loads, but daily capacity is ${capacity}. Split the job into multiple days or revise the load estimate.`};
 const today=localISO(new Date()), due=j.due_date;
 const first=coating?.planned_date>today?coating.planned_date:today;
 // The curing stage must follow the coating stage, not occur on the same date.
 const earliest=parseDate(first);if(coating&&coating.planned_date>=today)earliest.setDate(earliest.getDate()+1);
 const booked=stagePlans.filter(p=>p.stage==='Curing / QC'&&p.job_id!==jobId&&jobs.some(x=>x.id===p.job_id&&!['Collected','Ready for Collection'].includes(x.status)));
 let late=null;
 for(let offset=0;offset<90;offset++){
  const day=new Date(earliest);day.setDate(day.getDate()+offset);
  if([0,6].includes(day.getDay()))continue;
  const iso=localISO(day);
  const used=booked.filter(p=>p.planned_date===iso).reduce((sum,p)=>sum+(Number(jobs.find(x=>x.id===p.job_id)?.oven_loads)||1),0);
  if(used+needed<=capacity){
   if(iso<=due)return {date:iso,used,capacity,late:false};
   if(!late)late={date:iso,used,capacity,late:true};
  }
 }
 return late||{error:'No available slot found in the next 90 days'};
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-suggest-oven]');if(!b)return;
 const j=jobs.find(x=>x.id===b.dataset.suggestOven);if(!j)return;
 const result=findOvenSlot(j.id);
 if(result.error){msg(result.error);return}
 const existing=stagePlans.find(p=>p.job_id===j.id&&p.stage==='Curing / QC');
 const note=result.late?'WARNING: Suggested date is AFTER the customer due date.':'Suggested date is on or before the customer due date.';
 if(!confirm(`${j.job_number}: Move curing/QC from ${existing.planned_date} to ${result.date}?\\n${note}\\nCapacity: ${result.used}+${Number(j.oven_loads)||1} of ${result.capacity} loads.\\nNo customer due date or job status will change.`))return;
 await updateStage(existing.id,result.date);
});

function renderOvenCapacity(){
 const container=$('ovenCapacity');if(!container)return;
 $('ovenCount').value=ovenSettings.oven_count;$('ovenLoadsPerDay').value=ovenSettings.loads_per_oven_per_day;
 $('ovenCycleMinutes').value=ovenSettings.cycle_minutes??60;$('ovenDailyHours').value=ovenSettings.operating_hours??8;
 const cap=calculatedDailyCapacity();
 const start=weekStart(plannerWeekOffset);
 const curing=jobs.filter(isProduction).map(j=>({job_id:j.id,stage:'Curing / QC',planned_date:suggestStageDates(j.due_date)[2]}));
 const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return localISO(d)});
 const total=days.map(day=>{
  const plans=curing.filter(p=>p.planned_date===day);
  const loads=plans.reduce((sum,p)=>sum+(Number(jobs.find(j=>j.id===p.job_id)?.oven_loads)||1),0);
  return {day,plans,loads};
 });
 $('ovenCapacitySummary').textContent=`${ovenSettings.oven_count} oven(s) × ${Math.min(Number(ovenSettings.loads_per_oven_per_day),Math.floor(Number(ovenSettings.operating_hours)*60/Number(ovenSettings.cycle_minutes)))} loads per oven/day = ${cap} estimated loads/day. Limited by both your load cap and available hours. Assumes identical ovens and one full batch per cycle; does not calculate physical fit.`;
 container.innerHTML=total.map(({day,plans,loads})=>{
 const over=loads>cap;
 return `<div class="oven-day ${over?'oven-over':''}"><div class="oven-top"><strong>${esc(day)}</strong><span>${loads} / ${cap} loads ${over?'⚠ OVER CAPACITY':''}</span></div><div class="oven-meter"><div style="width:${Math.min(100,loads/cap*100)}%;background:${over?'#f87171':'#4ade80'};height:100%"></div></div>${plans.map(p=>{const j=jobs.find(x=>x.id===p.job_id);return `<div class="oven-job"><span>${esc(j?.job_number)} · ${Number(j?.oven_loads)||1} load(s)</span><button type="button" class="secondary" data-oven-job="${esc(p.job_id)}">Edit loads</button><button type="button" class="secondary" data-suggest-oven="${esc(p.job_id)}">Find slot</button></div>`}).join('')||'<small>No curing jobs planned</small>'}</div>`;
 }).join('');
}

const stageNames=['Pretreatment','Powder Coating','Curing / QC'];
const stageLabels={'Pretreatment':'Pretreatment','Powder Coating':'Powder Coating','Curing / QC':'Curing / QC'};
function parseDate(iso){const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d,12)}
function previousBusinessDay(iso,count){const d=parseDate(iso);while(count>0){d.setDate(d.getDate()-1);if(d.getDay()!==0&&d.getDay()!==6)count--}return localISO(d)}
function suggestStageDates(due){return [3,2,1].map(n=>previousBusinessDay(due,n))}
function stageFor(j){return stagePlans.filter(p=>p.job_id===j.id)}
function stageCard(p){const j=jobs.find(x=>x.id===p.job_id);if(!j)return '';const c=customers.find(x=>x.id===j.customer_id);return `<article class="stage-card"><strong>${esc(j.job_number)} · ${esc(p.stage)}</strong><small>${esc(c?.name||'Customer')} · Due ${esc(j.due_date)}</small><small>Automatically scheduled from completion date</small></article>`}
function renderStagePlanner(){
 const active=jobs.filter(isProduction),start=weekStart(plannerWeekOffset),end=new Date(start);end.setDate(start.getDate()+6);
 const a=localISO(start),b=localISO(end);
 const stageIndex={'Pretreatment':0,'Powder Coating':1,'Curing / QC':2};
 const outstanding=active.flatMap(j=>{const idx=stageIndex[j.status];const dates=suggestStageDates(j.due_date);return stageNames.slice(idx).map((stage,i)=>({job_id:j.id,stage,planned_date:dates[idx+i]}))});
 $('stageSummary').textContent=`${outstanding.filter(p=>p.planned_date>=a&&p.planned_date<=b).length} outstanding production tasks this week · Dates based on promised completion`;
 $('stageDays').innerHTML=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);const iso=localISO(d),list=outstanding.filter(p=>p.planned_date===iso);return `<div class="planner-day"><h3>${esc(new Intl.DateTimeFormat('en-ZA',{weekday:'short',day:'numeric',month:'short'}).format(d))}</h3><div class="planner-day-count">${list.length} outstanding</div>${list.map(stageCard).join('')||'<p class="planner-empty">No outstanding stages</p>'}</div>`}).join('');
}
async function generateStages(j,confirmExisting=false){
 const existing=stageFor(j);
 if(existing.length&&!confirmExisting){msg('This job already has stage dates. Reschedule individual stages instead.');return}
 const dates=suggestStageDates(j.due_date);
 if(dates[0]<localISO(new Date())&&!confirm(`Suggested stages for ${j.job_number} include past dates because the due date is close or overdue. Save suggestions anyway?`))return;
 const rows=stageNames.map((stage,i)=>({job_id:j.id,stage,planned_date:dates[i]}));
 check(await db.from('job_stage_schedule').upsert(rows,{onConflict:'job_id,stage'}));
 await load();msg('Suggested stage dates saved. Review against your actual workload.');
}
async function updateStage(id,date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){msg('Select a valid date');return}
 try{check(await db.from('job_stage_schedule').update({planned_date:date}).eq('id',id));await load();msg('Production stage rescheduled. Customer due date unchanged.')}catch(e){msg('Stage scheduling failed: '+e.message)}
}
$('stageEditCancel').onclick=()=>$('stageEditModal').classList.add('hide');
$('stageEditForm').onsubmit=async e=>{e.preventDefault();const id=$('stageEditId').value,date=$('stageEditDate').value;await updateStage(id,date);$('stageEditModal').classList.add('hide')};
document.addEventListener('click',async e=>{const edit=e.target.closest('[data-edit-stage]');if(edit){const p=stagePlans.find(x=>x.id===edit.dataset.editStage);if(!p)return;$('stageEditId').value=p.id;$('stageEditDate').value=p.planned_date;$('stageEditLabel').textContent=`${jobs.find(j=>j.id===p.job_id)?.job_number||'Job'} · ${p.stage}`;$('stageEditModal').classList.remove('hide')}const generate=e.target.closest('[data-generate-stages]');if(generate){const j=jobs.find(x=>x.id===generate.dataset.generateStages);if(j)try{await generateStages(j)}catch(err){msg('Could not generate schedule: '+err.message)}}});
document.addEventListener('dragstart',e=>{const card=e.target.closest('[data-drag-stage]');if(card){e.dataTransfer.setData('application/x-endura-stage',card.dataset.dragStage);e.dataTransfer.effectAllowed='move'}});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-stage-day]'))e.preventDefault()});
document.addEventListener('drop',e=>{const zone=e.target.closest('[data-stage-day]');if(!zone)return;const id=e.dataTransfer.getData('application/x-endura-stage');if(id){e.preventDefault();e.stopPropagation();updateStage(id,zone.dataset.stageDay)}});
function renderJobList(){
 const q=($('jobSearch')?.value||'').trim().toLowerCase();
 const visible=jobs.filter(isProduction).filter(j=>{const c=customers.find(c=>c.id===j.customer_id);const lines=items.filter(i=>i.job_id===j.id);return [j.job_number,j.status,c?.name,c?.phone,...lines.flatMap(i=>[i.description,i.colour])].join(' ').toLowerCase().includes(q)});
 $('jobs').innerHTML=visible.map(jobHTML).join('')||'<p class="empty">No matching active jobs.</p>';
}
$('jobSearch').addEventListener('input',renderJobList);

function jobHTML(j){const c=customers.find(x=>x.id===j.customer_id)||{};const [cls,urg]=urgency(j);const list=items.filter(i=>i.job_id===j.id);const notification=notices.find(n=>n.job_id===j.id&&n.kind==='collection');return `<div class="job"><div class="job-head"><div><strong>${esc(j.job_number)}</strong> — ${esc(c.name)} <span class="chip ${cls}">${esc(urg)}</span><div class="muted">${esc(c.phone)} · Due ${esc(j.due_date)}</div></div><div><select data-status="${j.id}" aria-label="Change job status">${statuses.map(s=>`<option ${s===j.status?'selected':''}>${esc(s)}</option>`).join('')}</select></div></div><div class="muted">${list.map(i=>`${esc(i.quantity)} × ${esc(i.description)} (${esc(i.colour)})`).join(' · ')||'No items'}</div><div class="job-tools"><button class="secondary" data-edit="${j.id}">✎ Edit job & items</button><button class="secondary" type="button" data-delete-job="${j.id}" style="border:1px solid #ef4444;color:#fecaca">🗑 Delete job card</button><button class="secondary" type="button" data-print-job="${j.id}">🖨 Print job card</button><button class="secondary" type="button" data-view-photos="${j.id}">📷 Photos (${jobPhotos.filter(p=>p.job_id===j.id).length})</button></div><div class="row"><div><label>Invoice PDF (max 10 MB)</label><input type="file" accept="application/pdf,.pdf" data-file="${j.id}"></div><div>${j.invoice_path?`<button class="secondary" data-invoice="${j.id}">View saved PDF</button>`:'<span class="muted">No invoice uploaded</span>'}</div></div>${notification?`<p class="muted">Collection WhatsApp: ${esc(notification.status.replaceAll('_',' '))}. Manual sending only.</p>`:''}</div>`}
function editItemRow(i={}){const d=document.createElement('div');d.className='edit-item';if(i.id)d.dataset.itemId=i.id;d.innerHTML=`<div class="row"><div><label>Item description</label><input class="e-desc" required value="${esc(i.description||'')}" placeholder="Steel brackets"></div><div><label>Quantity</label><input class="e-qty" type="number" min="1" required value="${Number(i.quantity)||1}"></div><div><label>Colour</label><input class="e-colour" value="${esc(i.colour||'')}" placeholder="Matt black"></div><div><label>Dimensions</label><input class="e-dim" value="${esc(i.dimensions||'')}"></div><div><label>Price (R)</label><input class="e-price" type="number" min="0" step="0.01" value="${Number(i.price)||0}"></div></div><div class="job-tools"><button type="button" class="secondary e-remove">Remove item</button></div>`;d.querySelector('.e-remove').onclick=()=>{if($('editItems').children.length<=1){msg('A job needs at least one item');return}if(d.dataset.itemId)editRemoved.add(d.dataset.itemId);d.remove()};$('editItems').appendChild(d)}
function openEdit(id){const j=jobs.find(x=>x.id===id);if(!j)return;editRemoved=new Set();$('editJobId').value=j.id;$('editJobNo').value=j.job_number;$('editDue').value=j.due_date;$('editNotes').value=j.notes||'';$('editCustomer').value=customers.find(c=>c.id===j.customer_id)?.name||'';$('editItems').innerHTML='';const lines=items.filter(i=>i.job_id===id);if(lines.length)lines.forEach(editItemRow);else editItemRow();$('editModal').classList.remove('hide');$('editJobPhotos').value='';showJobPhotos(id,'editJobPhotoGallery');$('editJobNo').focus()}
function closeEdit(){$('editModal').classList.add('hide');editRemoved.clear()}
$('closeEdit').onclick=closeEdit;$('cancelEdit').onclick=closeEdit;$('editAddItem').onclick=()=>editItemRow();
$('editModal').addEventListener('click',e=>{if(e.target===$('editModal'))closeEdit()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('editModal').classList.contains('hide'))closeEdit()});
$('editJobForm').onsubmit=async e=>{e.preventDefault();const button=$('saveEdit');button.disabled=true;try{const id=$('editJobId').value;const old=jobs.find(j=>j.id===id);if(!old)throw Error('Job no longer exists. Refresh first.');const rows=[...$('editItems').children].map(el=>({id:el.dataset.itemId||null,description:el.querySelector('.e-desc').value.trim(),quantity:Number(el.querySelector('.e-qty').value),colour:el.querySelector('.e-colour').value.trim(),dimensions:el.querySelector('.e-dim').value.trim(),price:Number(el.querySelector('.e-price').value)||0}));if(!rows.length||rows.some(r=>!r.description||!Number.isInteger(r.quantity)||r.quantity<1||r.price<0))throw Error('Each item needs a description, positive whole-number quantity and valid price.');const nextNumber=$('editJobNo').value.trim();if(!nextNumber)throw Error('Enter a job number.');if(jobs.some(j=>j.id!==id&&j.job_number.toLowerCase()===nextNumber.toLowerCase()))throw Error('That job number already exists.');const due=$('editDue').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(due))throw Error('Choose a valid due date.');const notes=$('editNotes').value;check(await db.from('jobs').update({job_number:nextNumber,due_date:due,notes,updated_at:new Date().toISOString()}).eq('id',id));for(const row of rows){const {id:itemId,...data}=row;if(itemId)check(await db.from('job_items').update(data).eq('id',itemId).eq('job_id',id));else check(await db.from('job_items').insert({...data,job_id:id}))}if(editRemoved.size)check(await db.from('job_items').delete().eq('job_id',id).in('id',[...editRemoved]));try{const dates=suggestStageDates(due);check(await db.from('job_stage_schedule').upsert(stageNames.map((stage,i)=>({job_id:id,stage,planned_date:dates[i]})),{onConflict:'job_id,stage'}))}catch(err){msg('Job saved; stage schedule sync failed: '+err.message)}closeEdit();await load();msg('Job card and items updated in Supabase.');}catch(err){msg('Save failed: '+err.message+' Refresh and review before retrying.')}finally{button.disabled=false}};
async function deleteJobCard(id){
 const j=jobs.find(x=>x.id===id);
 if(!j)return;
 const number=j.job_number;
 if(!confirm(`Delete job card ${number}? It will be removed from all normal job lists and production planning. This cannot be undone from the app.`))return;
 const entered=prompt(`To confirm deletion, type the exact job number: ${number}`);
 if(entered===null)return;
 if(entered.trim()!==number){msg('Deletion cancelled: job number did not match.');return}
 const btn=[...document.querySelectorAll('[data-delete-job]')].find(b=>b.dataset.deleteJob===id);
 if(btn)btn.disabled=true;
 try{
   const {data:{user},error:authError}=await db.auth.getUser();
   if(authError||!user)throw Error('Please sign in again.');
   const updated=check(await db.from('jobs').update({deleted_at:new Date().toISOString(),deleted_by:user.id,updated_at:new Date().toISOString()}).eq('id',id).is('deleted_at',null).select('id'));
   if(!updated?.length)throw Error('Job was not deleted. Check database permissions or refresh.');
   await load();
   msg(`Job card ${number} deleted from the app. Its number is available for automatic reuse on the next new job.`);
 }catch(err){msg('Delete failed: '+err.message);if(btn)btn.disabled=false}
}
async function transition(id,status){const j=jobs.find(x=>x.id===id);if(!j||j.status===status)return;try{check(await db.from('jobs').update({status,updated_at:new Date().toISOString()}).eq('id',id));check(await db.from('job_history').insert({job_id:id,status}));if(status==='Ready for Collection'){const c=customers.find(x=>x.id===j.customer_id);const text=`Good day ${c?.name||''}, your EnduraCoat job ${j.job_number} is ready for collection.${j.invoice_path?' Please find your invoice attached.':''} Thank you!`;check(await db.from('notifications').upsert({job_id:id,kind:'collection',status:'draft',message:text},{onConflict:'job_id,kind'}));msg('Job ready. Collection message added to Review — NOT sent.')}else msg('Job updated');await load()}catch(e){msg('Could not update job: '+e.message);await load()}}
async function uploadInvoice(id,file){if(!file)return;if(file.type!=='application/pdf'||!file.name.toLowerCase().endsWith('.pdf')||file.size>10*1024*1024){msg('Choose a PDF file under 10 MB.');return}try{const path=`${id}/${crypto.randomUUID()}.pdf`;check(await db.storage.from('invoices').upload(path,file,{contentType:'application/pdf',upsert:false}));check(await db.from('jobs').update({invoice_path:path,invoice_name:file.name}).eq('id',id));msg('Invoice uploaded securely');await load()}catch(e){msg('Upload failed: '+e.message)}}
async function viewInvoice(id){const j=jobs.find(x=>x.id===id);if(!j?.invoice_path)return;try{const r=check(await db.storage.from('invoices').createSignedUrl(j.invoice_path,60));window.open(r.signedUrl,'_blank','noopener,noreferrer')}catch(e){msg(e.message)}}
async function makeDelayReviews(){for(const j of jobs){if(urgency(j)[0]!=='overdue'||['Collected','Ready for Collection'].includes(j.status)||notices.some(n=>n.job_id===j.id&&n.kind==='delay'))continue;const c=customers.find(x=>x.id===j.customer_id);const message=`Good day ${c?.name||''}, we apologise that your EnduraCoat job ${j.job_number} has been delayed. We will confirm an updated collection date shortly.`;check(await db.from('notifications').insert({job_id:j.id,kind:'delay',status:'draft',message}));}await load()}
async function boot(){if(!configured){$('setup').classList.remove('hide');return}db=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);const {data:{session}}=await db.auth.getSession();await authView(session);db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>authView(session),0)})}
async function authView(session){if(!session)$('pushSettings').classList.add('hide');$('login').classList.toggle('hide',!!session);$('app').classList.toggle('hide',!session);$('logout').classList.toggle('hide',!session);if(session){try{const staff=check(await db.from('staff').select('user_id').eq('user_id',session.user.id).maybeSingle());if(!staff){$('app').classList.add('hide');msg('Account not authorised. Add this user UUID to public.staff in Supabase.');return}await load();await makeDelayReviews();await migratePendingReviews();$('pushSettings').classList.remove('hide');refreshPushStatus()}catch(e){msg('Database error: '+e.message)}}}
$('loginForm').onsubmit=async e=>{e.preventDefault();const r=await db.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(r.error)msg(r.error.message)};
$('logout').onclick=()=>db.auth.signOut();
const mobileMore=document.getElementById('mobileMore');
const mobileMoreMenu=document.getElementById('mobileMoreMenu');
const closeMore=()=>{mobileMoreMenu?.classList.add('hide');mobileMore?.setAttribute('aria-expanded','false')};
if(mobileMore&&mobileMoreMenu){
 mobileMore.onclick=()=>{const opening=mobileMoreMenu.classList.contains('hide');mobileMoreMenu.classList.toggle('hide',!opening);mobileMore.setAttribute('aria-expanded',String(opening))};
 document.addEventListener('click',e=>{if(!mobileMore.contains(e.target)&&!mobileMoreMenu.contains(e.target))closeMore()});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMore()});
}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{closeMore();show(b.dataset.tab)});$('stats').addEventListener('click',e=>{const card=e.target.closest('[data-dashboard-target]');if(card)show(card.dataset.dashboardTarget)});$('refresh').onclick=()=>load().catch(e=>msg(e.message));$('addItem').onclick=itemRow;itemRow();
// Customer account search (COD code or any part of the name).
const customerField=$('customer'),customerPhone=$('phone'),customerIdField=$('selectedCustomerId'),customerMatches=$('customerMatches');
function closeCustomerMatches(){customerMatches.classList.add('hide');customerMatches.innerHTML=''}
function pickCustomer(c){customerField.value=c.name;customerIdField.value=c.id;customerPhone.value=c.phone||'';closeCustomerMatches()}
function renderCustomerMatches(){const q=customerField.value.trim().toLocaleLowerCase();customerIdField.value='';if(!q){closeCustomerMatches();return}const matches=customers.filter(c=>c.name?.toLocaleLowerCase().includes(q)).sort((a,b)=>{const an=a.name.toLowerCase(),bn=b.name.toLowerCase();return Number(!an.startsWith(q))-Number(!bn.startsWith(q))||an.localeCompare(bn)}).slice(0,15);customerMatches.innerHTML='';if(!matches.length){customerMatches.innerHTML='<div class="customer-empty">No saved match — a new customer will be created.</div>'}else matches.forEach(c=>{const b=document.createElement('button');b.type='button';b.className='customer-match';b.setAttribute('role','option');b.textContent=c.name;const small=document.createElement('small');small.textContent=c.phone?'Phone: '+c.phone:'No phone saved';b.appendChild(small);b.addEventListener('click',()=>pickCustomer(c));customerMatches.appendChild(b)});customerMatches.classList.remove('hide')}
customerField.addEventListener('input',()=>{customerPhone.value='';renderCustomerMatches()});customerField.addEventListener('focus',renderCustomerMatches);customerField.addEventListener('keydown',e=>{if(e.key==='Escape')closeCustomerMatches();if(e.key==='ArrowDown'){const b=customerMatches.querySelector('button');if(b){e.preventDefault();b.focus()}}});document.addEventListener('click',e=>{if(!customerField.contains(e.target)&&!customerMatches.contains(e.target))closeCustomerMatches()});
$('jobForm').onsubmit=async e=>{e.preventDefault();const printWindow=null;const b=$('saveJob');b.disabled=true;try{if(signatureDirty&&(!$('signatureName').value.trim()||!$('signatureConsent').checked))throw Error('Enter the signer name and tick the customer confirmation before saving a signature.');const customerName=$('customer').value.trim(),phoneNumber=$('phone').value.trim();let c=customers.find(c=>c.id===customerIdField.value)||customers.find(c=>c.name.trim().toLocaleLowerCase()===customerName.toLocaleLowerCase());if(c){if(phoneNumber!==(c.phone||'')){c=check(await db.from('customers').update({phone:phoneNumber}).eq('id',c.id).select().single())}}else c=check(await db.from('customers').insert({name:customerName,phone:phoneNumber}).select().single());const requestedNumber=$('jobno').value.trim().toUpperCase();if(requestedNumber&&!/^[A-Z0-9][A-Z0-9\-_/]{0,39}$/.test(requestedNumber))throw Error('Manual job number must use letters, digits, hyphens, underscores or slashes (maximum 40 characters).');const job=check(await db.from('jobs').insert({customer_id:c.id,due_date:$('due').value,notes:$('notes').value,...(requestedNumber?{job_number:requestedNumber}:{})}).select().single());const signedData=signatureDirty?$('signatureCanvas').toDataURL('image/png'):null;const rows=[...document.querySelectorAll('#items .item')].map(x=>({job_id:job.id,description:x.querySelector('.desc').value,quantity:Number(x.querySelector('.qty').value),colour:x.querySelector('.colour').value,dimensions:x.querySelector('.dimensions').value,price:Number(x.querySelector('.price').value)||0}));check(await db.from('job_items').insert(rows));if(signedData)check(await db.from('job_signatures').insert({job_id:job.id,signer_name:$('signatureName').value.trim(),signature_data:signedData,signed_at:new Date().toISOString()}));check(await db.from('job_history').insert({job_id:job.id,status:'New'}));
 let stageWarning='';try{const dates=suggestStageDates(job.due_date);check(await db.from('job_stage_schedule').upsert(stageNames.map((stage,i)=>({job_id:job.id,stage,planned_date:dates[i]})),{onConflict:'job_id,stage'}))}catch(err){stageWarning=' Job created, but automatic stage scheduling failed: '+err.message}
 const shouldPrint=$('printAfterSave').checked;const photosToSave=[...$('newJobPhotos').files];let photoWarning='';if(photosToSave.length){try{await uploadJobPhotos(job.id,photosToSave)}catch(err){photoWarning=' Some photos could not be uploaded: '+err.message}}$('jobForm').reset();customerIdField.value='';closeCustomerMatches();$('jobno').value='';$('newPhotoSelection').innerHTML='';clearSignature();$('items').innerHTML='';itemRow();await load();show('dashboard');msg('Job saved to cloud.'+stageWarning+photoWarning);if(shouldPrint){printJobCard(job.id)}}catch(e){if(e.code==='23505'){const duplicateJob=/job_number|jobs_job_number/i.test(String(e.message||'')+' '+String(e.details||''));if(duplicateJob){msg('Job number conflict. Please retry saving; Supabase will assign a new number.')}else msg('A record with these details already exists. '+(e.message||''));}else msg('Save failed: '+e.message)}finally{b.disabled=false}};
document.addEventListener('change',async e=>{const t=e.target;if(t.dataset.status)await transition(t.dataset.status,t.value);if(t.dataset.file)await uploadInvoice(t.dataset.file,t.files?.[0])});async function migratePendingReviews(){const pending=notices.filter(n=>n.status==='pending_integration');if(!pending.length)return;for(const n of pending)check(await db.from('notifications').update({status:'draft'}).eq('id',n.id));await load()}
async function saveReviewMessage(id){const field=[...document.querySelectorAll('[data-message]')].find(x=>x.dataset.message===id);const n=notices.find(x=>x.id===id);if(!field||!n)return null;const message=field.value.trim();if(!message){msg('Message cannot be empty');return null}if(message!==n.message){check(await db.from('notifications').update({message}).eq('id',id));n.message=message}return message}
document.addEventListener('click',async e=>{const t=e.target.closest('button');if(!t)return;try{if(t.dataset.edit)openEdit(t.dataset.edit);if(t.dataset.deleteJob){await deleteJobCard(t.dataset.deleteJob);return;}if(t.dataset.viewPhotos)await showJobPhotos(t.dataset.viewPhotos,'jobPhotoViewerGallery',true);if(t.dataset.printJob)printJobCard(t.dataset.printJob);if(t.dataset.invoice||t.dataset.reviewInvoice)await viewInvoice(t.dataset.invoice||t.dataset.reviewInvoice);if(t.dataset.copy){const message=await saveReviewMessage(t.dataset.copy);if(message){await navigator.clipboard.writeText(message);msg('Message copied')}}if(t.dataset.whatsapp){const id=t.dataset.whatsapp,message=await saveReviewMessage(id);if(!message)return;const n=notices.find(x=>x.id===id),j=jobs.find(x=>x.id===n.job_id),c=customers.find(x=>x.id===j?.customer_id),phone=whatsappPhone(c?.phone);if(!phone){msg('Customer needs a valid WhatsApp number');return}window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');msg('WhatsApp opened. Check recipient and send manually; attach PDF if needed.')}if(t.dataset.sent){const id=t.dataset.sent;if(!confirm('Have you actually sent this message in WhatsApp?'))return;if(!await saveReviewMessage(id))return;check(await db.from('notifications').update({status:'sent'}).eq('id',id));msg('Marked as sent (manual confirmation)');await load()}if(t.dataset.dismiss){check(await db.from('notifications').update({status:'failed'}).eq('id',t.dataset.dismiss));msg('Message dismissed');await load()}}catch(err){msg('Review action failed: '+err.message)}});

$('ovenSettingsForm').onsubmit=async e=>{
 e.preventDefault();
 const oven_count=Number($('ovenCount').value),loads_per_oven_per_day=Number($('ovenLoadsPerDay').value),cycle_minutes=Number($('ovenCycleMinutes').value),operating_hours=Number($('ovenDailyHours').value);
 if(!Number.isInteger(oven_count)||oven_count<1||oven_count>20||!Number.isInteger(loads_per_oven_per_day)||loads_per_oven_per_day<1||loads_per_oven_per_day>100||!Number.isInteger(cycle_minutes)||cycle_minutes<1||cycle_minutes>1440||!(operating_hours>0&&operating_hours<=24)){msg('Enter valid oven counts, cycle minutes and operating hours.');return}
 try{const updated=check(await db.from('oven_capacity_settings').update({oven_count,loads_per_oven_per_day,cycle_minutes,operating_hours}).eq('id',1).select().single());ovenSettings=updated;renderOvenCapacity();msg('Shared oven capacity saved.')}catch(err){msg('Capacity save failed: '+err.message)}
};
document.addEventListener('click',e=>{const b=e.target.closest('[data-oven-job]');if(!b)return;const j=jobs.find(x=>x.id===b.dataset.ovenJob);if(!j)return;$('ovenJobId').value=j.id;$('ovenJobLabel').textContent=j.job_number;$('ovenJobLoads').value=j.oven_loads||1;$('ovenJobModal').classList.remove('hide')});
$('ovenJobCancel').onclick=()=>$('ovenJobModal').classList.add('hide');
$('ovenJobForm').onsubmit=async e=>{e.preventDefault();const id=$('ovenJobId').value,oven_loads=Number($('ovenJobLoads').value);if(!Number.isInteger(oven_loads)||oven_loads<1||oven_loads>1000){msg('Enter a whole number of oven loads.');return}try{check(await db.from('jobs').update({oven_loads}).eq('id',id));$('ovenJobModal').classList.add('hide');await load();msg('Estimated oven loads saved.')}catch(err){msg('Save failed: '+err.message)}};


const PUSH_FN='push-dispatch';
function decodeVapid(s){const b64=s.replace(/-/g,'+').replace(/_/g,'/');const raw=atob(b64+'='.repeat((4-b64.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
async function pushCall(payload){
 const {data:{session}}=await db.auth.getSession();if(!session)throw Error('Sign in first.');
 const r=await fetch(`${SUPABASE_URL}/functions/v1/${PUSH_FN}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session.access_token}`,'apikey':SUPABASE_PUBLISHABLE_KEY},body:JSON.stringify(payload)});
 const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||`Push service returned ${r.status}`);return body;
}
async function refreshPushStatus(){
 const label=$('pushStatus'),panel=$('pushSettings');if(!label||!panel)return;
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window)){
  label.textContent='Web Push is unavailable in this browser. On iPhone, add ENDURA JC to Home Screen and open it there.';
  panel.classList.remove('hide');return;
 }
 try{
  const reg=await navigator.serviceWorker.getRegistration('./');
  const sub=reg?await reg.pushManager.getSubscription():null;
  const enabled=Boolean(sub)&&Notification.permission==='granted';
  label.textContent=enabled?'Push enabled on this device.':'Push is not enabled on this device.';
  panel.classList.toggle('hide',enabled||localStorage.getItem('endura_push_disabled')==='yes'||Notification.permission==='denied');
 }catch(e){label.textContent=e.message;panel.classList.remove('hide')}
}
$('pushEnable').onclick=async()=>{
 try{
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('This browser does not support Web Push. On iPhone install ENDURA JC to your Home Screen.');
 const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notification permission was not granted. Check your device settings.');
 const {publicKey}=await pushCall({action:'public-key'});if(!publicKey)throw Error('VAPID key not configured on Supabase.');
 const reg=await navigator.serviceWorker.register('./push-sw.js',{scope:'./'});
 await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();
 if(sub){const key=new Uint8Array(sub.options.applicationServerKey||[]);if(key.length&&!key.every((b,i)=>b===decodeVapid(publicKey)[i])){await sub.unsubscribe();sub=null}}
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeVapid(publicKey)});
 await pushCall({action:'subscribe',subscription:sub.toJSON()});localStorage.removeItem('endura_push_disabled');msg('Push notifications enabled.');await refreshPushStatus();
 }catch(e){msg('Push setup: '+e.message);await refreshPushStatus()}
};
$('pushDisable').onclick=async()=>{
 try{const reg=await navigator.serviceWorker.getRegistration('./');const sub=reg?await reg.pushManager.getSubscription():null;if(sub){await pushCall({action:'unsubscribe',endpoint:sub.endpoint});await sub.unsubscribe()}localStorage.setItem('endura_push_disabled','yes');msg('Push disabled on this device.');await refreshPushStatus()}catch(e){msg('Disable failed: '+e.message)}
};
$('pushTest').onclick=async()=>{try{const r=await pushCall({action:'test'});msg(`Test queued for ${r.queued||0} subscription(s). It will be delivered by the dispatcher.`)}catch(e){msg('Test failed: '+e.message)}};


// Digital signature capture — compatible with iPhone/iPad touch, stylus and desktop mouse.
const signatureCanvas=$('signatureCanvas'),signatureCtx=signatureCanvas.getContext('2d');
signatureCtx.strokeStyle='#14253e';signatureCtx.lineWidth=3;signatureCtx.lineCap='round';signatureCtx.lineJoin='round';
signatureCanvas.style.touchAction='none';
let signing=false, activeInput=null;
function signaturePoint(e){
 const r=signatureCanvas.getBoundingClientRect();
 const point=e.touches?.[0]||e.changedTouches?.[0]||e;
 return {x:(point.clientX-r.left)*signatureCanvas.width/Math.max(r.width,1),y:(point.clientY-r.top)*signatureCanvas.height/Math.max(r.height,1)};
}
function clearSignature(){signatureCtx.clearRect(0,0,signatureCanvas.width,signatureCanvas.height);signatureDirty=false;signing=false;activeInput=null}
$('clearSignature').onclick=clearSignature;
function startSignature(e,kind){
 if(e.cancelable)e.preventDefault();
 if(signing)return;
 signing=true;activeInput=kind;
 const p=signaturePoint(e);signatureCtx.beginPath();signatureCtx.moveTo(p.x,p.y);
 signatureCtx.lineTo(p.x+0.1,p.y+0.1);signatureCtx.stroke();signatureDirty=true;
}
function moveSignature(e,kind){
 if(!signing||activeInput!==kind)return;
 if(e.cancelable)e.preventDefault();
 const p=signaturePoint(e);signatureCtx.lineTo(p.x,p.y);signatureCtx.stroke();
}
function stopSignature(e,kind){if(activeInput!==kind)return;if(e?.cancelable)e.preventDefault();signing=false;activeInput=null}
// Explicit touch listeners are essential for some iOS Home Screen web-app versions.
signatureCanvas.addEventListener('touchstart',e=>startSignature(e,'touch'),{passive:false});
signatureCanvas.addEventListener('touchmove',e=>moveSignature(e,'touch'),{passive:false});
signatureCanvas.addEventListener('touchend',e=>stopSignature(e,'touch'),{passive:false});
signatureCanvas.addEventListener('touchcancel',e=>stopSignature(e,'touch'),{passive:false});
// Pointer events cover pen and mouse on modern browsers; touch is handled above.
signatureCanvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch')return;startSignature(e,'pointer');try{signatureCanvas.setPointerCapture?.(e.pointerId)}catch(_){}});
signatureCanvas.addEventListener('pointermove',e=>{if(e.pointerType!=='touch')moveSignature(e,'pointer')});
for(const event of ['pointerup','pointercancel','lostpointercapture'])signatureCanvas.addEventListener(event,e=>stopSignature(e,'pointer'));
// Older desktop browsers without Pointer Events.
if(!window.PointerEvent){
 signatureCanvas.addEventListener('mousedown',e=>startSignature(e,'mouse'));
 signatureCanvas.addEventListener('mousemove',e=>moveSignature(e,'mouse'));
 window.addEventListener('mouseup',e=>stopSignature(e,'mouse'));
}
let printReturnTab = 'dashboard';
let currentPrintJobId = null;
function printJobCard(id){
 currentPrintJobId=id;
 const j=jobs.find(x=>x.id===id);if(!j){msg('Job not found. Refresh and try again.');return}
 const c=customers.find(x=>x.id===j.customer_id)||{};
 const lines=items.filter(x=>x.job_id===id);
 const sig=signatures.find(x=>x.job_id===id);
 const sum=lines.reduce((total,i)=>total+(Number(i.price)||0),0);
 const rows=lines.map((i,n)=>`<tr><td>${n+1}</td><td>${esc(i.description)}</td><td>${esc(i.quantity)}</td><td>${esc(i.colour)}</td><td>${esc(i.dimensions)}</td><td>R ${Number(i.price||0).toFixed(2)}</td></tr>`).join('');
 const sigHtml=sig?`<img class="print-signature" src="${sig.signature_data}" alt="Customer signature"><p><strong>${esc(sig.signer_name)}</strong> — ${esc(new Date(sig.signed_at).toLocaleString('en-ZA'))}</p>`:'<div class="print-unsigned">Customer signature: __________________________________</div>';
 $('jobPrintSheet').innerHTML=`<header class="print-header"><div><h1>ENDURACOAT</h1><div>POWDER COATING — JOB CARD</div></div><div><strong>${esc(j.job_number)}</strong><p>Created: ${esc(new Date(j.created_at).toLocaleDateString('en-ZA'))}</p></div></header><div class="print-meta"><div><strong>Customer:</strong> ${esc(c.name)}</div><div><strong>Contact:</strong> ${esc(c.phone)}</div><div><strong>Promised completion:</strong> ${esc(j.due_date)}</div><div><strong>Status:</strong> ${esc(j.status)}</div></div><h2>Items received for powder coating</h2><table class="print-table"><thead><tr><th>#</th><th>Item description</th><th>Qty</th><th>Colour</th><th>Dimensions</th><th>Price</th></tr></thead><tbody>${rows}</tbody></table><p style="text-align:right"><strong>Total recorded: R ${sum.toFixed(2)}</strong></p><h2>Job notes</h2><div class="print-notes">${esc(j.notes||'—')}</div><h2>Customer acknowledgement</h2><p>The customer acknowledges the items listed above and authorises recording of the signature, where provided.</p>${sigHtml}<footer class="print-footer">EnduraCoat | Job card generated electronically from ENDURA JC</footer>`;
 $('jobPrintTitle').textContent='Job Card '+j.job_number;
 printReturnTab=['dashboard','new','planner','review','collected'].find(tab=>!$(tab).classList.contains('hide'))||'dashboard';
 show('jobPrintModal');
 window.scrollTo(0,0);
}
function closeJobPrint(){show(printReturnTab);window.scrollTo(0,0)}
$('closeJobPrint').onclick=closeJobPrint;
// iOS Home Screen PWAs may ignore window.print(). Share an actual PDF instead.
async function createJobCardPDF(id){
 const j=jobs.find(x=>x.id===id);if(!j)throw Error('Job card not found.');
 if(!window.jspdf?.jsPDF)throw Error('PDF generator is unavailable. Check your internet connection and reopen ENDURA JC.');
 const {jsPDF}=window.jspdf;
 const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
 const c=customers.find(x=>x.id===j.customer_id)||{};
 const lines=items.filter(x=>x.job_id===id);
 const sig=signatures.find(x=>x.job_id===id);
 const margin=15, width=180, bottom=280;
 let y=19;
 function page(needed=8){if(y+needed>bottom){pdf.addPage();y=18;}}
 function line(value,{bold=false,size=10,gap=6}={}){
  pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);
  const parts=pdf.splitTextToSize(String(value??''),width);
  page(parts.length*(size*.42)+gap);
  pdf.text(parts,margin,y);y+=parts.length*(size*.42)+gap;
 }
 function rule(){page(5);pdf.setDrawColor(190);pdf.line(margin,y,195,y);y+=6;}
 line('ENDURACOAT',{bold:true,size:20,gap:8});
 line('POWDER COATING - JOB CARD',{bold:true,size:12,gap:7});rule();
 line('Job number: '+(j.job_number||''),{bold:true,size:13});
 line('Created: '+new Date(j.created_at).toLocaleDateString('en-ZA'));
 line('Customer: '+(c.name||''));line('Contact: '+(c.phone||''));
 line('Promised completion: '+(j.due_date||''));line('Status: '+(j.status||''));rule();
 line('ITEMS RECEIVED FOR POWDER COATING',{bold:true,size:11});
 for(let i=0;i<lines.length;i++){
  const it=lines[i];page(23);
  line(`${i+1}. ${it.description||'Item'} | Qty: ${it.quantity||0}`,{bold:true,gap:4});
  line(`Colour: ${it.colour||'-'} | Dimensions: ${it.dimensions||'-'} | Price: R ${Number(it.price||0).toFixed(2)}`,{size:9,gap:6});
 }
 rule();line('Total recorded: R '+lines.reduce((sum,i)=>sum+Number(i.price||0),0).toFixed(2),{bold:true});
 line('JOB NOTES',{bold:true,size:11});line(j.notes||'-');rule();
 line('CUSTOMER ACKNOWLEDGEMENT',{bold:true,size:11});
 line('The customer acknowledges the items listed and authorises recording of their signature where provided.',{size:9});
 if(sig?.signature_data){
  page(40);
  try{pdf.addImage(sig.signature_data,'PNG',margin,y,65,22);y+=27;}
  catch(e){line('Signature image could not be included.',{size:9});}
  line('Signed by: '+(sig.signer_name||''),{bold:true});
  line('Signed at: '+new Date(sig.signed_at).toLocaleString('en-ZA'));
 }else{line('Customer signature: ____________________________');}
 page(15);rule();line('EnduraCoat | Generated electronically from ENDURA JC',{size:8});
 return pdf.output('blob');
}
$('printJobNow').onclick=async()=>{
 const button=$('printJobNow');button.disabled=true;
 try{
  if(!currentPrintJobId)throw Error('Choose a job card first.');
  // Desktop browsers use the native print dialog and print the exact HTML preview.
  // iOS installed PWAs retain the existing shareable-PDF workflow.
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(!isIOS){
   document.body.classList.add('job-print-preview-open');
   try{window.print();}
   finally{setTimeout(()=>document.body.classList.remove('job-print-preview-open'),1200);}
   return;
  }
  const j=jobs.find(x=>x.id===currentPrintJobId);
  const blob=await createJobCardPDF(currentPrintJobId);
  const safeName=String(j.job_number||'Job_Card').replace(/[^a-zA-Z0-9_-]/g,'_');
  const file=new File([blob],`EnduraCoat_${safeName}.pdf`,{type:'application/pdf'});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
   try{await navigator.share({files:[file],title:`EnduraCoat ${j.job_number}`});return;}
   catch(e){if(e.name==='AbortError')return;}
  }
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.href=url;link.download=file.name;
  document.body.appendChild(link);link.click();link.remove();
  msg('PDF created. Open it in Files or Downloads, then tap Share > Print to select a printer.');
  setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){msg('Could not prepare printable PDF: '+e.message)}
 finally{button.disabled=false}
};

// Job creation cancellation: discard unsaved form only after confirmation.
$('cancelNewJob').onclick=()=>{
 if(!confirm('Cancel creating this job card? All unsaved details and the signature will be discarded.'))return;
 $('jobForm').reset();$('jobno').value='';$('newPhotoSelection').innerHTML='';clearSignature();$('items').innerHTML='';itemRow();show('dashboard');msg('Job card creation cancelled. Nothing was saved.');
};
$('printSavedJobButton').onclick=()=>{
 const id=$('printSavedJobSelect').value;
 if(!id){msg('Select a saved job card to print.');return}
 printJobCard(id);
};
function refreshPrintJobOptions(){
 const sel=$('printSavedJobSelect');if(!sel)return;
 const previous=sel.value;
 sel.innerHTML='<option value="">Select a saved job card</option>'+jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.job_number)} — ${esc(customers.find(c=>c.id===j.customer_id)?.name||'Customer')}</option>`).join('');
 if(jobs.some(j=>j.id===previous))sel.value=previous;
}


// Job photo attachments: private Supabase Storage and per-job metadata.
const PHOTO_BUCKET='job-photos';
const MAX_PHOTO_BYTES=8*1024*1024;
const PHOTO_TYPES=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
function validatePhotos(files){
 if(files.length>8)throw Error('Choose no more than 8 photos at once.');
 for(const file of files){if(!PHOTO_TYPES.has(file.type))throw Error('Only JPG, PNG, WebP and HEIC photos are supported: '+file.name);if(file.size>MAX_PHOTO_BYTES)throw Error('Photo exceeds 8 MB: '+file.name)}
}
function safePhotoName(name){return String(name||'photo').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-90)}
async function uploadJobPhotos(jobId,files){
 validatePhotos(files);const saved=[];
 for(const file of files){
  const path=`${jobId}/${crypto.randomUUID()}-${safePhotoName(file.name)}`;
  check(await db.storage.from(PHOTO_BUCKET).upload(path,file,{contentType:file.type,upsert:false}));
  try{const row=check(await db.from('job_photos').insert({job_id:jobId,storage_path:path,file_name:file.name,mime_type:file.type,file_size:file.size}).select().single());saved.push(row)}
  catch(err){await db.storage.from(PHOTO_BUCKET).remove([path]);throw err}
 }
 return saved;
}
async function showJobPhotos(jobId,targetId,openViewer=false){
 const photos=jobPhotos.filter(p=>p.job_id===jobId);
 const target=$(targetId);if(!target)return;
 target.innerHTML=photos.length?'Loading photos…':'<p class="muted">No photos attached yet.</p>';
 if(openViewer){$('jobPhotoViewer').classList.remove('hide');$('jobPhotoViewerTitle').textContent='Job photos — '+(jobs.find(j=>j.id===jobId)?.job_number||'Job card')}
 if(!photos.length)return;
 const cards=await Promise.all(photos.map(async p=>{
  try{const {signedUrl}=check(await db.storage.from(PHOTO_BUCKET).createSignedUrl(p.storage_path,3600));return `<div class="photo-tile"><a href="${esc(signedUrl)}" target="_blank" rel="noopener noreferrer"><img src="${esc(signedUrl)}" alt="${esc(p.file_name)}" loading="lazy"><small>View full photo</small></a><small>${esc(p.file_name)}</small></div>`}
  catch(err){return `<div class="photo-tile"><small>${esc(p.file_name)} — could not load</small></div>`}
 }));
 target.innerHTML=cards.join('');
}
$('newJobPhotos').addEventListener('change',()=>{
 const files=[...$('newJobPhotos').files];try{validatePhotos(files);$('newPhotoSelection').textContent=files.length?`${files.length} photo(s) selected: ${files.map(f=>f.name).join(', ')}`:''}
 catch(err){$('newJobPhotos').value='';$('newPhotoSelection').textContent='';msg(err.message)}
});
$('editJobPhotos').addEventListener('change',async()=>{
 const jobId=$('editJobId').value,files=[...$('editJobPhotos').files];if(!files.length||!jobId)return;
 $('editJobPhotos').disabled=true;
 try{await uploadJobPhotos(jobId,files);await load();await showJobPhotos(jobId,'editJobPhotoGallery');msg('Photos saved to job card.')}catch(err){msg('Photo upload failed: '+err.message)}
 finally{$('editJobPhotos').value='';$('editJobPhotos').disabled=false}
});
$('closeJobPhotoViewer').onclick=()=>$('jobPhotoViewer').classList.add('hide');

boot().catch(e=>msg(e.message));
