const STORAGE_KEY = 'routine-app-data-v1';
const $ = (selector) => document.querySelector(selector);
const listView = $('#list-view');
const calendarView = $('#calendar-view');
const textView = $('#text-view');
const topbar = $('.topbar');
const routineList = $('#routine-list');
const emptyState = $('#empty-state');
const form = $('#routine-form');
let state = loadState();
let currentId = null;
let shownMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let toastTimer;
const lastTaps = new WeakMap();
let reorderGesture = null;
let calendarSwipe = null;
let detailOpenedAt = 0;
let suppressClickUntil = 0;
let lastPointerDownTarget = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && Array.isArray(saved.routines) ? { ...saved, completions: saved.completions || {}, plans: saved.plans || {} } : { routines: [], completions: {}, plans: {} };
  } catch { return { routines: [], completions: {}, plans: {} }; }
}
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function localISO(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function fromISO(value) { const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
function formatDate(date, options) { return new Intl.DateTimeFormat('ko-KR', options).format(date); }
function escaped(value='') { return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function completionKey(id) { return `routine:${id}`; }
function planKey(id) { return `routine:${id}`; }
function completedDates(id) { return state.completions[completionKey(id)] || []; }
function plannedDates(id) { return state.plans[planKey(id)] || []; }
function isCompleted(id, date) { return completedDates(id).includes(localISO(date)); }
function isPlanned(id, date) { return plannedDates(id).includes(localISO(date)); }
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
    const isText=routine.type==='text';
    const card=document.createElement('article'); card.className=`routine-card ${isText?'text-card':''}`; card.dataset.routineId=routine.id; card.tabIndex=0; card.setAttribute('role','button'); card.setAttribute('aria-label',`${routine.name}${isText?', 텍스트 항목':`, ${prettyTarget(routine)}`}. 탭하여 ${isText?'내용 보기':'기록 보기'}, 길게 눌러 순서 이동`);
    card.innerHTML=`<div class="routine-card-top"><h2>${escaped(routine.name)}</h2>${isText?'<span class="text-type-pill">텍스트</span>':`<div class="target-pill"><span class="target-icon">↗</span><span class="target-text">${escaped(prettyTarget(routine))}</span></div>`}</div><p class="routine-note ${routine.note?'':'empty-note'}">${escaped(routine.note)}</p>`;
    card.addEventListener('pointerdown', event=>beginReorder(event,card));
    card.addEventListener('pointerup', event=>{if(event.pointerType==='touch')return;if(reorderGesture?.pointerId===event.pointerId&&(reorderGesture.moved||reorderGesture.active))return;if(isText)openTextDetail(routine.id);else openCalendar(routine.id);});
    card.addEventListener('touchstart',event=>beginTouchReorder(event,card),{passive:true});
    card.addEventListener('touchmove',moveTouchReorder,{passive:false});
    card.addEventListener('touchend',event=>finishTouchReorder(event,card,routine.id));
    card.addEventListener('touchcancel',event=>cancelTouchReorder(event));
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(isText)openTextDetail(routine.id);else openCalendar(routine.id);}});
    routineList.append(card);
  }
}
function beginReorder(event,card) {
  if(event.pointerType==='touch'||event.button!==0||reorderGesture)return;
  const rect=card.getBoundingClientRect();
  const gesture={pointerId:event.pointerId,card,startX:event.clientX,startY:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,active:false,moved:false,timer:null};
  reorderGesture=gesture;
  gesture.timer=setTimeout(()=>activateReorder(gesture),520);
}
function beginTouchReorder(event,card){
  if(event.touches.length!==1||reorderGesture)return;
  const touch=event.changedTouches[0];
  const rect=card.getBoundingClientRect();
  const gesture={pointerId:null,touchId:touch.identifier,card,startX:touch.clientX,startY:touch.clientY,offsetX:touch.clientX-rect.left,offsetY:touch.clientY-rect.top,active:false,moved:false,timer:null};
  reorderGesture=gesture;
  gesture.timer=setTimeout(()=>activateReorder(gesture),520);
}
function activateReorder(gesture){
  if(reorderGesture!==gesture)return;
  gesture.active=true;
  const rect=gesture.card.getBoundingClientRect();
  const preview=gesture.card.cloneNode(true);
  preview.removeAttribute('id');preview.classList.add('drag-preview');preview.style.width=`${rect.width}px`;preview.style.left=`${rect.left}px`;preview.style.top=`${rect.top}px`;
  document.body.append(preview);gesture.preview=preview;
  gesture.card.classList.add('drag-placeholder');
  document.body.classList.add('reordering');
  moveDragPreview(gesture,gesture.startX,gesture.startY);
  navigator.vibrate?.(18);
}
function moveDragPreview(gesture,x,y){if(!gesture.preview)return;gesture.preview.style.left=`${x-gesture.offsetX}px`;gesture.preview.style.top=`${y-gesture.offsetY}px`;}
function reorderAtPoint(card,x,y){
  document.querySelectorAll('.routine-card.drop-target').forEach(item=>item.classList.remove('drop-target'));
  const target=document.elementFromPoint(x,y)?.closest('.routine-card');
  if(!target||target===card)return;
  target.classList.add('drop-target');
  const rect=target.getBoundingClientRect();
  const before=Array.from(routineList.querySelectorAll('.routine-card')).filter(item=>item!==card).map(item=>[item,item.getBoundingClientRect().top]);
  routineList.insertBefore(card,y>rect.top+rect.height/2?target.nextElementSibling:target);
  for(const [item,oldTop] of before){const delta=oldTop-item.getBoundingClientRect().top;if(!delta)continue;item.style.transition='none';item.style.transform=`translateY(${delta}px)`;void item.offsetHeight;item.style.transition='transform 180ms cubic-bezier(.2,.75,.25,1)';item.style.transform='';setTimeout(()=>{item.style.transition='';},200);}
}
function persistReorderedRoutines(){
  const reordered=Array.from(routineList.querySelectorAll('.routine-card')).map(card=>state.routines.find(item=>item.id===card.dataset.routineId)).filter(Boolean);
  if(reordered.every((item,index)=>item.id===state.routines[index]?.id))return;
  state.routines=reordered;
  persist();
  showToast('루틴 순서를 변경했습니다.');
}
function clearReorderGesture(gesture){
  clearTimeout(gesture.timer);
  gesture.card.classList.remove('dragging','drag-placeholder');
  delete gesture.card.dataset.reordering;
  document.querySelectorAll('.routine-card.drop-target').forEach(item=>item.classList.remove('drop-target'));
  document.body.classList.remove('reordering');
  reorderGesture=null;
}
function moveTouchReorder(event){
  const gesture=reorderGesture;
  if(!gesture||gesture.pointerId!==null)return;
  const touch=Array.from(event.changedTouches).find(item=>item.identifier===gesture.touchId);
  if(!touch)return;
  if(Math.hypot(touch.clientX-gesture.startX,touch.clientY-gesture.startY)>9)gesture.moved=true;
  if(!gesture.active&&gesture.moved)clearTimeout(gesture.timer);
  if(gesture.active){event.preventDefault();moveDragPreview(gesture,touch.clientX,touch.clientY);reorderAtPoint(gesture.card,touch.clientX,touch.clientY);}
}
function finishTouchReorder(event,card,routineId){
  const gesture=reorderGesture;
  const touch=Array.from(event.changedTouches).find(item=>item.identifier===gesture?.touchId);
  if(!gesture||gesture.pointerId!==null||!touch)return;
  if(gesture.active)persistReorderedRoutines();
  else if(!gesture.moved){const item=state.routines.find(value=>value.id===routineId);if(item?.type==='text')openTextDetail(routineId);else openCalendar(routineId);}
  settleDragPreview(gesture);
  clearReorderGesture(gesture);
}
function cancelTouchReorder(event){
  const gesture=reorderGesture;
  if(!gesture||gesture.pointerId!==null||!Array.from(event.changedTouches).some(item=>item.identifier===gesture.touchId))return;
  if(gesture.active)persistReorderedRoutines();
  settleDragPreview(gesture);
  clearReorderGesture(gesture);
}
function moveReorder(event) {
  const gesture=reorderGesture;
  if(gesture&&event.pointerId===gesture.pointerId){
    const distance=Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY);
    if(distance>9)gesture.moved=true;
    if(!gesture.active&&gesture.moved)clearTimeout(gesture.timer);
    if(gesture.active){
      event.preventDefault();
      moveDragPreview(gesture,event.clientX,event.clientY);
      reorderAtPoint(gesture.card,event.clientX,event.clientY);
    }
  }
  if(calendarSwipe&&event.pointerId===calendarSwipe.pointerId){
    const dx=event.clientX-calendarSwipe.startX,dy=event.clientY-calendarSwipe.startY;
    if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.15)calendarSwipe.swiped=true;
  }
}
function finishReorder(event,cancelled=false) {
  const gesture=reorderGesture;
  if(!gesture||event&&event.pointerId!==gesture.pointerId)return;
  clearTimeout(gesture.timer);
  if(gesture.active)persistReorderedRoutines();
  settleDragPreview(gesture);
  clearReorderGesture(gesture);
}
function settleDragPreview(gesture){const preview=gesture.preview;if(!preview)return;const rect=gesture.card.getBoundingClientRect();preview.style.transition='left 160ms cubic-bezier(.2,.75,.25,1),top 160ms cubic-bezier(.2,.75,.25,1),opacity 160ms ease';preview.style.left=`${rect.left}px`;preview.style.top=`${rect.top}px`;preview.style.opacity='0';setTimeout(()=>preview.remove(),180);gesture.preview=null;}
function registerTap(element) { const now=Date.now(),last=lastTaps.get(element)||0; if(now-last<420){lastTaps.set(element,0);element.classList.add('double-tap');setTimeout(()=>element.classList.remove('double-tap'),220);return true;}lastTaps.set(element,now);return false; }
function openForm(id=null) {
  currentId=id; form.reset(); $('#routine-target').value='1';
  $('#form-title').textContent=id?'루틴 편집':'루틴 추가'; $('#form-eyebrow').textContent=id?'EDIT ROUTINE':'NEW ROUTINE';
  if(id){const r=state.routines.find(x=>x.id===id);if(!r)return;$('#entry-type').value=r.type||'routine';$('#routine-name').value=r.name;$('#routine-note').value=r.note||'';$('#routine-period').value=r.period||'day';$('#routine-target').value=r.target||1;}
  updateEntryFields();
  $('#routine-dialog').showModal();setTimeout(()=>$('#routine-name').focus(),60);
}
function updateEntryFields(){const isRoutine=$('#entry-type').value==='routine';$('#routine-goal-fields').hidden=!isRoutine;$('#routine-note-optional').hidden=!isRoutine;$('#routine-period').required=isRoutine;$('#routine-target').required=isRoutine;$('#routine-note').placeholder=isRoutine?'무엇을 할지 간단히 적어주세요':'내용을 입력해 주세요';}
function openTextDetail(id,{pushHistory=true,editing=false}={}){const entry=state.routines.find(item=>item.id===id&&item.type==='text');if(!entry)return;currentId=id;detailOpenedAt=Date.now();suppressClickUntil=detailOpenedAt+650;$('#text-detail-title').value=entry.name;$('#text-detail-content').value=entry.note||'';setTextEditMode(editing);topbar.hidden=true;if(pushHistory)history.pushState({routineView:'text',routineId:id,editing:false},'',location.href);const from=!listView.hidden?listView:!calendarView.hidden?calendarView:textView;transitionView(from,textView,'forward');window.scrollTo({top:0,behavior:'instant'});}
function deleteRoutine(id) { const r=state.routines.find(x=>x.id===id);if(!r)return false;if(!confirm(`“${r.name}” 루틴과 완료 기록을 삭제할까요?`))return false;state.routines=state.routines.filter(x=>x.id!==id);delete state.completions[completionKey(id)];delete state.plans[planKey(id)];persist();renderList();showToast('루틴을 삭제했습니다.');return true; }
function openCalendar(id, { pushHistory = true, editing = false } = {}) {
  currentId=id;
  detailOpenedAt=Date.now();
  suppressClickUntil=detailOpenedAt+650;
  shownMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);
  if(pushHistory)history.pushState({routineView:'calendar',routineId:id,editing:false},'',location.href);
  renderCalendar();
  setRoutineEditMode(editing);
  topbar.hidden=true;
  transitionView(listView,calendarView,'forward');
  requestAnimationFrame(resizeRoutineNote);
  window.scrollTo({top:0,behavior:'instant'});
}
function renderCalendar() {
  const routine=state.routines.find(x=>x.id===currentId);if(!routine){showList();return;}
  $('#calendar-heading').textContent=routine.name;$('#calendar-description').value=routine.note||'';$('#month-label').textContent=formatDate(shownMonth,{year:'numeric',month:'long'});
  const grid=$('#calendar-grid');grid.innerHTML='';
  const first=new Date(shownMonth.getFullYear(),shownMonth.getMonth(),1);const start=new Date(first);start.setDate(1-first.getDay());const weeksNeeded=Math.ceil((first.getDay()+new Date(shownMonth.getFullYear(),shownMonth.getMonth()+1,0).getDate())/7);
  const today=localISO(new Date());
  for(let week=0;week<weeksNeeded;week++){
    const row=[];let rowDate=new Date(start);rowDate.setDate(start.getDate()+week*7);
    const weeklyDone=routine.period==='week'&&countWeek(routine.id,rowDate)>=routine.target;
    for(let dow=0;dow<7;dow++){
      const date=new Date(start);date.setDate(start.getDate()+week*7+dow);const iso=localISO(date);const day=document.createElement('button');
      const dateIsFuture=iso>today,dateIsPlanned=isPlanned(routine.id,date),dateIsDone=isCompleted(routine.id,date);
      day.type='button';day.className='calendar-day';if(date.getMonth()!==shownMonth.getMonth())day.classList.add('outside');if(iso===today)day.classList.add('today');if(dateIsDone)day.classList.add('done');if(dateIsPlanned)day.classList.add('planned');if(dow===0)day.classList.add('week-start','sunday');if(dow===6)day.classList.add('week-end');if(weeklyDone)day.classList.add('week-complete');
      day.setAttribute('aria-label',`${formatDate(date,{year:'numeric',month:'long',day:'numeric',weekday:'long'})}${dateIsDone?', 완료':''}${dateIsPlanned?', 계획':''}${weeklyDone?', 주간 목표 달성':''}. ${dateIsFuture?'두 번 탭해서 계획 표시 변경':'두 번 탭해서 완료 변경'}`);day.innerHTML=`<span class="day-number">${date.getDate()}</span>`;
      day.addEventListener('pointerup',event=>{if(calendarSwipe?.pointerId===event.pointerId&&calendarSwipe.swiped)return;if(registerTap(day)){if(dateIsFuture)togglePlan(routine.id,iso);else toggleDate(routine.id,iso);}});row.push(day);
    }
    row.forEach(day=>grid.append(day));
  }
  const all=completedDates(routine.id).length;const monthCount=completedDates(routine.id).filter(value=>{const date=fromISO(value);return date.getFullYear()===shownMonth.getFullYear()&&date.getMonth()===shownMonth.getMonth();}).length;
  resizeRoutineNote();
  $('#history-summary').innerHTML=`이번 달 <strong>${monthCount}회</strong> 완료 · 전체 <strong>${all}회</strong> 기록`;
  $('#previous-month').disabled=false;$('#next-month').disabled=false;
}
function toggleDate(id,iso) { const planned=new Set(plannedDates(id));if(planned.has(iso)){planned.delete(iso);state.plans[planKey(id)]=[...planned].sort();persist();renderCalendar();showToast('계획을 해제했습니다. 다시 두 번 탭하면 완료로 기록됩니다.');return;}const key=completionKey(id),set=new Set(completedDates(id));if(set.has(iso)){set.delete(iso);showToast('완료 표시를 해제했습니다.');}else{set.add(iso);showToast('완료로 기록했습니다.');}state.completions[key]=[...set].sort();persist();renderCalendar(); }
function togglePlan(id,iso) { const key=planKey(id),set=new Set(plannedDates(id));if(set.has(iso)){set.delete(iso);showToast('계획을 해제했습니다.');}else{set.add(iso);showToast('할 일을 계획했습니다.');}state.plans[key]=[...set].sort();persist();renderCalendar(); }
function transitionView(from,to,direction){from.hidden=true;to.hidden=false;to.classList.remove('view-enter-forward','view-enter-back');void to.offsetWidth;to.classList.add(direction==='forward'?'view-enter-forward':'view-enter-back');to.addEventListener('animationend',()=>to.classList.remove('view-enter-forward','view-enter-back'),{once:true});}
function showList(){renderList();const from=!calendarView.hidden?calendarView:!textView.hidden?textView:null;topbar.hidden=false;if(from)transitionView(from,listView,'back');else{calendarView.hidden=true;textView.hidden=true;listView.hidden=false;}window.scrollTo({top:0,behavior:'instant'});}
function setTextEditMode(editing){const title=$('#text-detail-title'),content=$('#text-detail-content');title.readOnly=!editing;content.readOnly=!editing;textView.classList.toggle('editing',editing);}
function enterTextEditMode(){if(!$('#text-detail-content').readOnly)return;setTextEditMode(true);history.pushState({routineView:'text',routineId:currentId,editing:true},'',location.href);setTimeout(()=>$('#text-detail-content').focus(),0);}
function setRoutineEditMode(editing){const content=$('#calendar-description');content.readOnly=!editing;calendarView.classList.toggle('editing',editing);}
function enterRoutineEditMode(){const content=$('#calendar-description');if(!content.readOnly)return;setRoutineEditMode(true);history.pushState({routineView:'calendar',routineId:currentId,editing:true},'',location.href);setTimeout(()=>content.focus(),0);}
function changeMonth(amount){shownMonth=new Date(shownMonth.getFullYear(),shownMonth.getMonth()+amount,1);renderCalendar();}
function finishCalendarSwipe(event,cancelled=false){if(!calendarSwipe||event&&event.pointerId!==calendarSwipe.pointerId)return;const gesture=calendarSwipe;calendarSwipe=null;if(!cancelled&&gesture.swiped&&Math.abs(gesture.startX-gesture.endX)>56)changeMonth(gesture.endX<gesture.startX?1:-1);}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),1800);}
$('#add-button').addEventListener('click',()=>openForm());$('#empty-add').addEventListener('click',()=>openForm());
form.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);const type=String(data.get('type'));const target=Number(data.get('target'));if(type==='routine'&&(!Number.isInteger(target)||target<1||target>30)){$('#routine-target').focus();return;}const value={type,name:String(data.get('name')).trim(),note:String(data.get('note')).trim()};if(type==='routine'){value.period=String(data.get('period'));value.target=target;}if(!value.name)return;
  if(currentId){const old=state.routines.find(x=>x.id===currentId);if(!old)return;const oldType=old.type||'routine';Object.assign(old,value);persist();$('#routine-dialog').close();if(oldType==='text'&&type==='text'){renderList();$('#text-detail-title').value=old.name;$('#text-detail-content').value=old.note||'';showToast('텍스트 항목을 수정했습니다.');}else if(oldType!==type){renderList();history.replaceState(null,'',location.href);showList();showToast(type==='text'?'텍스트 항목으로 변경했습니다.':'루틴으로 변경했습니다.');}else{renderCalendar();setRoutineEditMode(false);if(history.state?.routineView==='calendar')history.replaceState({...history.state,editing:false},'',location.href);showToast('루틴을 수정했습니다.');}}
  else{const routine={id:uid(),...value};state.routines.push(routine);if(type==='routine'){state.completions[completionKey(routine.id)]=[];state.plans[planKey(routine.id)]=[];}persist();$('#routine-dialog').close();renderList();showToast(type==='text'?'텍스트 항목을 추가했습니다.':'새 루틴을 추가했습니다.');}
});
$('#entry-type').addEventListener('change',updateEntryFields);
$('#settings-button').addEventListener('click',()=>$('#settings-dialog').showModal());$('#reset-button').addEventListener('click',()=>{if(!confirm('이 기기에 저장된 모든 루틴과 완료 기록을 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;state={routines:[],completions:{},plans:{}};persist();$('#settings-dialog').close();showList();showToast('모든 데이터를 삭제했습니다.');});
$('#home-link').addEventListener('click',event=>{event.preventDefault();history.replaceState(null,'',location.href);showList();});
$('#edit-current').addEventListener('click',()=>{if(Date.now()-detailOpenedAt>=700)openForm(currentId);});
$('#delete-current').addEventListener('click',()=>{if(Date.now()-detailOpenedAt<700)return;if(deleteRoutine(currentId)){history.replaceState(null,'',location.href);showList();}});
$('#delete-text-entry').addEventListener('click',()=>{if(Date.now()-detailOpenedAt<700)return;if(deleteRoutine(currentId)){history.replaceState(null,'',location.href);showList();}});
function saveTextDetailField(field){const entry=state.routines.find(item=>item.id===currentId&&item.type==='text');if(!entry)return;entry[field]=field==='name'?$('#text-detail-title').value:$('#text-detail-content').value;persist();}
$('#text-detail-title').addEventListener('input',()=>saveTextDetailField('name'));
$('#text-detail-content').addEventListener('input',()=>saveTextDetailField('note'));
$('#text-detail-content').addEventListener('click',enterTextEditMode);
function resizeRoutineNote(){const content=$('#calendar-description');if(!content)return;content.rows=1;content.style.height='0px';const height=content.scrollHeight;content.style.height=`${Math.max(52,height+2)}px`;}
$('#calendar-description').addEventListener('input',()=>{const routine=state.routines.find(item=>item.id===currentId&&item.type!=='text');if(!routine)return;routine.note=$('#calendar-description').value;persist();resizeRoutineNote();});
$('#routine-note-panel').addEventListener('click',enterRoutineEditMode);
document.addEventListener('pointerdown',event=>{lastPointerDownTarget=event.target;},true);
document.addEventListener('click',event=>{const fromRoutineCard=lastPointerDownTarget?.closest?.('.routine-card');lastPointerDownTarget=null;if(fromRoutineCard&&event.isTrusted&&event.detail>0&&Date.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}},true);
$('#previous-month').addEventListener('click',()=>changeMonth(-1));$('#next-month').addEventListener('click',()=>changeMonth(1));
$('#month-label').addEventListener('click',()=>{const input=$('#month-input');input.value=`${shownMonth.getFullYear()}${String(shownMonth.getMonth()+1).padStart(2,'0')}`;$('#month-dialog').showModal();setTimeout(()=>{input.focus();input.select();},50);});
$('#month-form').addEventListener('submit',event=>{event.preventDefault();const value=$('#month-input').value.trim();const year=Number(value.slice(0,4)),month=Number(value.slice(4,6));if(!/^\d{6}$/.test(value)||year<1000||month<1||month>12){showToast('연월을 YYYYMM 형식으로 입력해 주세요.');return;}shownMonth=new Date(year,month-1,1);$('#month-dialog').close();renderCalendar();});
$('.calendar-card').addEventListener('pointerdown',event=>{if(event.pointerType==='touch')calendarSwipe={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,endX:event.clientX,endY:event.clientY,swiped:false};});
document.addEventListener('pointermove',event=>{moveReorder(event);if(calendarSwipe?.pointerId===event.pointerId){calendarSwipe.endX=event.clientX;calendarSwipe.endY=event.clientY;}},{passive:false});
document.addEventListener('pointerup',event=>{finishReorder(event);finishCalendarSwipe(event);});
document.addEventListener('pointercancel',event=>{finishReorder(event,true);finishCalendarSwipe(event,true);});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.close).close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();}));
window.addEventListener('popstate',event=>{
  if(event.state?.routineView==='calendar'&&state.routines.some(routine=>routine.id===event.state.routineId)){if(!calendarView.hidden&&currentId===event.state.routineId)setRoutineEditMode(Boolean(event.state.editing));else openCalendar(event.state.routineId,{pushHistory:false,editing:Boolean(event.state.editing)});}
  else if(event.state?.routineView==='text'&&state.routines.some(routine=>routine.id===event.state.routineId&&routine.type==='text')){if(!textView.hidden&&currentId===event.state.routineId)setTextEditMode(Boolean(event.state.editing));else openTextDetail(event.state.routineId,{pushHistory:false,editing:Boolean(event.state.editing)});}
  else showList();
});
renderList();
if(history.state?.routineView==='calendar'&&state.routines.some(routine=>routine.id===history.state.routineId))openCalendar(history.state.routineId,{pushHistory:false,editing:Boolean(history.state.editing)});
else if(history.state?.routineView==='text'&&state.routines.some(routine=>routine.id===history.state.routineId&&routine.type==='text'))openTextDetail(history.state.routineId,{pushHistory:false,editing:Boolean(history.state.editing)});
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(error=>console.warn('Service worker registration failed',error)));
