const STORAGE_KEY = 'routine-app-data-v1';
const $ = (selector) => document.querySelector(selector);
const listView = $('#list-view');
const calendarView = $('#calendar-view');
const routineList = $('#routine-list');
const emptyState = $('#empty-state');
const form = $('#routine-form');
let state = loadState();
let currentId = null;
let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let toastTimer;
const lastTaps = new WeakMap();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.routines) ? saved : { routines: [], completions: {} };
  } catch { return { routines: [], completions: {} }; }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function localISO(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function fromISO(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
function formatDate(date, options) { return new Intl.DateTimeFormat('ko-KR', options).format(date); }
function escaped(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function completionKey(id) { return `routine:${id}`; }
function completedDates(id) { return state.completions[completionKey(id)] || []; }
function isCompleted(id, date) { return completedDates(id).includes(localISO(date)); }
function unitText(routine) { return routine.period === 'week' ? '주' : '일'; }
function prettyTarget(routine) { return `${routine.target}회 이상 / ${routine.period === 'week' ? '주' : '일'}`; }
function dayWeekStart(date) { const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()); start.setDate(start.getDate()-start.getDay()); return start; }
function weekEnd(date) { const end=dayWeekStart(date); end.setDate(end.getDate()+6); return end; }
function countWeek(id,date) { const start=dayWeekStart(date), end=weekEnd(date); return completedDates(id).filter(value=>{const d=fromISO(value);return d>=start&&d<=end;}).length; }
function meetsGoal(routine,date) { return routine.period === 'day' ? isCompleted(routine.id,date) : countWeek(routine.id,date)>=routine.target; }

function renderList() {
  routineList.innerHTML = '';
  emptyState.hidden = state.routines.length !== 0;
  routineList.hidden = state.routines.length === 0;
  for (const routine of state.routines) {
    const card=document.createElement('article'); card.className='routine-card'; card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-label',`${routine.name}, ${prettyTarget(routine)}. 두 번 탭해서 기록 보기`);
    card.innerHTML=`<div class="routine-card-top"><h2>${escaped(routine.name)}</h2><div class="target-pill"><span>↗</span>${escaped(prettyTarget(routine))}</div></div><p class="routine-note ${routine.note?'':'empty-note'}">${escaped(routine.note)}</p><div class="card-footer"><span>두 번 탭해서 기록 보기</span><div class="card-actions"><button class="small-action edit" type="button" aria-label="${escaped(routine.name)} 편집">편집</button><button class="small-action delete" type="button" aria-label="${escaped(routine.name)} 삭제">삭제</button></div></div>`;
    card.addEventListener('pointerup', e=>{if(e.target.closest('button'))return; if(registerTap(card)){openCalendar(routine.id);}});
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCalendar(routine.id);}});
    card.querySelector('.edit').addEventListener('click',e=>{e.stopPropagation();openForm(routine.id);});
    card.querySelector('.delete').addEventListener('click',e=>{e.stopPropagation();deleteRoutine(routine.id);});
    routineList.append(card);
  }
}
function registerTap(element) { const now=Date.now(),last=lastTaps.get(element)||0; if(now-last<420){lastTaps.set(element,0);element.classList.add('double-tap');setTimeout(()=>element.classList.remove('double-tap'),220);return true;}lastTaps.set(element,now);return false; }
function openForm(id=null) {
  currentId=id; form.reset(); $('#routine-target').value='1';
  $('#form-title').textContent=id?'루틴 편집':'루틴 추가'; $('#form-eyebrow').textContent=id?'EDIT ROUTINE':'NEW ROUTINE';
  if(id){const r=state.routines.find(x=>x.id===id);if(!r)return;$('#routine-name').value=r.name;$('#routine-note').value=r.note||'';$('#routine-period').value=r.period;$('#routine-target').value=r.target;}
  $('#routine-dialog').showModal();setTimeout(()=>$('#routine-name').focus(),60);
}
function deleteRoutine(id) { const r=state.routines.find(x=>x.id===id);if(!r)return;if(!confirm(`“${r.name}” 루틴과 완료 기록을 삭제할까요?`))return;state.routines=state.routines.filter(x=>x.id!==id);delete state.completions[completionKey(id)];persist();renderList();showToast('루틴을 삭제했습니다.'); }
function openCalendar(id, { pushHistory = true } = {}) {
  currentId=id;
  shownMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  if(pushHistory)history.pushState({routineView:'calendar',routineId:id},'',location.href);
  renderCalendar();
  listView.hidden=true;
  calendarView.hidden=false;
  window.scrollTo({top:0,behavior:'instant'});
}
function renderCalendar() {
  const routine=state.routines.find(x=>x.id===currentId);if(!routine){showList();return;}
  $('#calendar-heading').textContent=routine.name;$('#calendar-description').textContent=routine.note||prettyTarget(routine);$('#month-label').textContent=formatDate(shownMonth,{year:'numeric',month:'long'});
  const grid=$('#calendar-grid');grid.innerHTML='';
  const first=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);const start=new Date(first);start.setDate(1-first.getDay());
  const today=localISO(new Date());
  for(let week=0;week<6;week++){
    const row=[];let rowDate=new Date(start);rowDate.setDate(start.getDate()+week*7);
    const weeklyDone=routine.period==='week'&&countWeek(routine.id,rowDate)>=routine.target;
    for(let dow=0;dow<7;dow++){
      const date=new Date(start);date.setDate(start.getDate()+week*7+dow);const iso=localISO(date);const day=document.createElement('button');
      day.type='button';day.className='calendar-day';if(date.getMonth()!==shownMonth.getMonth())day.classList.add('outside');if(iso===today)day.classList.add('today');if(isCompleted(routine.id,date))day.classList.add('done');if(dow===0)day.classList.add('week-start','sunday');if(dow===6)day.classList.add('week-end');if(weeklyDone)day.classList.add('week-complete');
      day.setAttribute('aria-label',`${formatDate(date,{year:'numeric',month:'long',day:'numeric',weekday:'long'})}${isCompleted(routine.id,date)?', 완료':''}${weeklyDone?', 주간 목표 달성':''}. 두 번 탭해서 완료 변경`);day.innerHTML=`<span class="day-number">${date.getDate()}</span>`;
      day.addEventListener('pointerup',()=>{if(registerTap(day))toggleDate(routine.id,iso);});row.push(day);
    }
    row.forEach(day=>grid.append(day));
  }
  const all=completedDates(routine.id).length;const monthCount=completedDates(routine.id).filter(value=>{const date=fromISO(value);return date.getFullYear()===shownMonth.getFullYear()&&date.getMonth()===shownMonth.getMonth();}).length;
  $('#history-summary').innerHTML=`이번 달 <strong>${monthCount}회</strong> 완료 · 전체 <strong>${all}회</strong> 기록`;
  $('#previous-month').disabled=false;$('#next-month').disabled=false;
}
function toggleDate(id,iso) { const key=completionKey(id),set=new Set(state.completions[key]||[]);if(set.has(iso)){set.delete(iso);showToast('완료 표시를 해제했습니다.');}else{set.add(iso);showToast('완료로 기록했습니다.');}state.completions[key]=[...set].sort();persist();renderCalendar(); }
function showList(){calendarView.hidden=true;listView.hidden=false;renderList();window.scrollTo({top:0,behavior:'instant'});}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),1800);}
$('#add-button').addEventListener('click',()=>openForm());$('#empty-add').addEventListener('click',()=>openForm());
form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);const target=Number(data.get('target'));if(!Number.isInteger(target)||target<1||target>30){$('#routine-target').focus();return;}const value={name:String(data.get('name')).trim(),note:String(data.get('note')).trim(),period:String(data.get('period')),target};if(!value.name)return;
  if(currentId){Object.assign(state.routines.find(x=>x.id===currentId),value);persist();$('#routine-dialog').close();renderCalendar();showToast('루틴을 수정했습니다.');}
  else{const routine={id:uid(),...value};state.routines.push(routine);state.completions[completionKey(routine.id)]=[];persist();$('#routine-dialog').close();renderList();showToast('새 루틴을 추가했습니다.');}
});
$('#settings-button').addEventListener('click',()=>$('#settings-dialog').showModal());$('#reset-button').addEventListener('click',()=>{if(!confirm('이 기기에 저장된 모든 루틴과 완료 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;state={routines:[],completions:{}};persist();$('#settings-dialog').close();showList();showToast('모든 데이터를 삭제했습니다.');});
$('#back-button').addEventListener('click',()=>{if(history.state?.routineView==='calendar')history.back();else showList();});$('#edit-current').addEventListener('click',()=>openForm(currentId));
$('#previous-month').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()-1,1);renderCalendar();});$('#next-month').addEventListener('click',()=>{shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,1);renderCalendar();});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
window.addEventListener('popstate',event=>{
  if(event.state?.routineView==='calendar'&&state.routines.some(routine=>routine.id===event.state.routineId))openCalendar(event.state.routineId,{pushHistory:false});
  else showList();
});
renderList();
if(history.state?.routineView==='calendar'&&state.routines.some(routine=>routine.id===history.state.routineId))openCalendar(history.state.routineId,{pushHistory:false});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Service worker registration failed',error)));
