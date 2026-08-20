const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled=false;
const API_BASE=(window.GAON_API_BASE||'').replace(/\/$/,'');
const IS_GITHUB_PAGES=location.hostname.endsWith('.github.io');
const DEMO_MODE=Boolean(window.GAON_DEMO_MODE&&!API_BASE&&(IS_GITHUB_PAGES||new URLSearchParams(location.search).has('pages-demo')));
const ui = {
  dialog: document.querySelector('#profileDialog'), form: document.querySelector('#profileForm'), name: document.querySelector('#nameInput'),
  profile: document.querySelector('#profileName'), changeProfile: document.querySelector('#changeProfile'), chat: document.querySelector('#chatLog'),
  restartStage: document.querySelector('#restartStage'),
  commandForm: document.querySelector('#commandForm'), input: document.querySelector('#commandInput'), count: document.querySelector('#charCount'),
  hint: document.querySelector('#hintButton'), toast: document.querySelector('#toast'), complete: document.querySelector('#completePanel'), replay: document.querySelector('#replayButton'),
  platformCount: document.querySelector('#platformCount'), ropeCount: document.querySelector('#ropeCount'), ladderCount: document.querySelector('#ladderCount'), state: document.querySelector('#aiState'),
  compiler: document.querySelector('#compilerOutput'), remaining: document.querySelector('#commandRemaining'), history: document.querySelector('#historyDialog'),
  stageNumber:document.querySelector('#stageNumber'),stageName:document.querySelector('#stageName'),objective:document.querySelector('#stageObjective'),commandTotal:document.querySelector('#commandTotal'),
  memoryReward:document.querySelector('#memoryReward'),completeStory:document.querySelector('#completeStory'),nextStage:document.querySelector('#nextStageButton')
};
ui.connection = document.querySelector('#aiConnection');
ui.globalAiStatus=document.querySelector('#globalAiStatus');

const STORAGE_KEY = 'gaon-adventure-profile-v1';
const world = { width: 960, gravity: 1850, cameraX: 0, time: 0, completed: false };
const player = { x: 90, y: 390, w: 32, h: 48, vx: 0, vy: 0, speed: 270, grounded: false, facing: 1 };
const ai = { x: 55, y: 335 };
const inventory = { platform: 1, rope: 1, ladder: 0 };
const STAGES=[
  {name:'첫 번째 발걸음',objective:'가온에게 기억 조각까지 이동하라고 지시하세요.',limit:2,items:{platform:0,rope:0,ladder:0},grounds:[[0,960]],reward:'가다',story:'당신의 짧은 한마디에 가온이 첫발을 내디뎠습니다.'},
  {name:'짧은 빈칸',objective:'짧은 틈 앞에서 발판을 설치하고 건너가세요.',limit:3,items:{platform:1,rope:0,ladder:0},grounds:[[0,320],[470,960]],reward:'잇다',story:'작은 빈칸은 단단한 발판으로 이어졌습니다.'},
  {name:'긴 침묵',objective:'넓은 절벽에는 밧줄을 연결해 건너가세요.',limit:3,items:{platform:0,rope:1,ladder:0},grounds:[[0,280],[560,960]],reward:'건너다',story:'긴 침묵 위로 기억의 밧줄이 이어졌습니다.'},
  {name:'위에 놓인 글자',objective:'높은 기록대 앞에 사다리를 설치하고 올라가세요.',limit:3,items:{platform:0,rope:0,ladder:1},grounds:[[0,650]],raised:{x:650,y:365,w:310},ladderX:642,reward:'오르다',story:'높이 놓인 글자도 올바른 도구로 닿을 수 있었습니다.'},
  {name:'50자의 작전',objective:'50자 안에서 발판·밧줄·사다리를 순서대로 사용하세요.',limit:1,items:{platform:1,rope:1,ladder:1},grounds:[[0,190],[330,520],[760,820]],raised:{x:820,y:365,w:140},ladderX:812,reward:'명령',story:'짧고 정확한 문장이 복잡한 세계를 움직였습니다.'}
];
let currentStage=0;
let commandLimit=STAGES[0].limit;
let commandsUsed=0;
let pendingPlan = null;
let movementQueue = [];
let activeMovement = null;
let lastTime = performance.now();
let toastTimer;

let staticPlatforms = [];
const createdPlatforms = [];
const particles = Array.from({length:35},(_,i)=>({x:(i*173)%960,y:30+(i*71)%370,r:1+(i%3),a:.15+(i%5)*.07}));

function loadProfile(){
  const profile = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if(profile?.name){ ui.profile.textContent = profile.name; }
  else ui.dialog.showModal();
}
function saveProfile(name, completed=false){ const old=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); localStorage.setItem(STORAGE_KEY,JSON.stringify({...old,name,stage1:completed||old.stage1||false})); }
ui.form.addEventListener('submit', e=>{ e.preventDefault(); const name=ui.name.value.trim(); if(name.length<2){showToast('이름을 두 글자 이상 입력해 주세요.');return;} saveProfile(name);ui.profile.textContent=name;ui.dialog.close();addMessage('ai',`${name}님, 목소리가 들려요. 저는 가온이에요. 함께 이곳을 빠져나가 봐요.`); });
ui.changeProfile.addEventListener('click',()=>{ui.name.value=ui.profile.textContent==='새 모험가'?'':ui.profile.textContent;ui.dialog.showModal();});
ui.restartStage.addEventListener('click',()=>restartStage(true));
document.querySelector('#openHistory').addEventListener('click',()=>ui.history.showModal());
document.querySelector('#closeHistory').addEventListener('click',()=>ui.history.close());

ui.input.addEventListener('input',()=>ui.count.textContent=`${Array.from(ui.input.value).length} / 50`);
document.querySelectorAll('.item').forEach(el=>el.addEventListener('click',()=>{ui.input.value=el.dataset.prompt;ui.input.dispatchEvent(new Event('input'));ui.input.focus();}));
ui.hint.addEventListener('click',()=>{const hints=[
  '기억 조각까지 이동해.',
  '틈 앞까지 가서 발판을 놓고 건너 목표로 가.',
  '절벽 앞까지 가서 밧줄을 놓고 건너 목표로 가.',
  '벽 앞까지 가서 사다리를 놓고 올라 목표로 가.',
  '발판 놓고 건너, 밧줄 놓고 건너, 사다리로 올라 목표로 가.'
];ui.input.value=hints[currentStage];ui.input.dispatchEvent(new Event('input'));ui.input.focus();showToast('이동·아이템·최종 목적지를 순서대로 작성해 보세요.');});

ui.commandForm.addEventListener('submit',async e=>{
  e.preventDefault(); const text=ui.input.value.trim(); if(!text)return;
  addMessage('user',text); ui.input.value='';ui.input.dispatchEvent(new Event('input'));
  if(commandsUsed>=commandLimit){showToast('이 스테이지의 실행 횟수를 모두 사용했습니다.');return;}
  const sendButton=ui.commandForm.querySelector('.run-button');commandsUsed++;updateCommandLimit();
  sendButton.disabled=true;ui.state.textContent='Solar 4가 작전을 이해하고 있어요';ui.connection.textContent='생각 중';
  pendingPlan=validatePlan(await interpretWithAI(text));
  renderPlan(pendingPlan);executePlan();sendButton.disabled=commandsUsed>=commandLimit;
});
ui.replay.addEventListener('click',()=>restartStage(false));
ui.nextStage.addEventListener('click',()=>{currentStage=(currentStage+1)%STAGES.length;loadStage();});

function interpret(text){
  const t=text.replace(/\s/g,''); const actions=[]; const notes=[];
  const wantsEdge=/(절벽|낭떠러지|끊어진길).*(앞|근처).*(가|이동)|(?:앞|다음|첫)절벽.*(?:까지|앞으로).*(?:가|이동)/.test(t);
  const wantsCross=/(건너가|건너줘|건너자|반대편으로가|반대편으로이동)/.test(t);
  const wantsGoal=/(기억조각|목표|끝).*(도착|가|이동)/.test(t);
  if(/(처음|시작위치).*(돌아|이동|가)|다시시작/.test(t)) actions.push({type:'reset',label:'시작 위치로 돌아가기'});
  if(wantsEdge) actions.push({type:'move_edge',label:'가장 가까운 절벽 앞까지 이동'});
  if(/(발판|다리)/.test(t)){
    if(inventory.platform<=0) notes.push('휴대용 발판이 남아 있지 않아요.');
    else if(!/(절벽|낭떠러지|틈|앞|가까운|첫)/.test(t)) notes.push('발판을 설치할 위치가 모호해요.');
    else actions.push({type:'platform',label:'가장 가까운 끊어진 길 가운데에 휴대용 발판 1개 설치'});
  }
  if(/(밧줄|로프)/.test(t)){
    if(inventory.rope<=0) notes.push('기억의 밧줄이 남아 있지 않아요.');
    else if(!/(나무|나뭇가지|절벽|건너|연결)/.test(t)) notes.push('밧줄을 연결할 대상을 알려 주세요.');
    else actions.push({type:'rope',label:'다음 절벽의 나뭇가지에 밧줄을 연결해 다리 만들기'});
  }
  if(/(사다리)/.test(t)){
    if(inventory.ladder<=0) notes.push('접이식 사다리가 남아 있지 않아요.');
    else actions.push({type:'ladder',label:'높은 벽에 접이식 사다리 설치'});
  }
  if(wantsCross) actions.push({type:'cross',label:'설치된 길을 이용해 절벽 반대편으로 이동'});
  if(/(올라가|오르기|타고올라)/.test(t)) actions.push({type:'climb',label:'설치한 사다리를 타고 높은 곳으로 이동'});
  if(wantsGoal) actions.push({type:'goal',label:'안전한 길을 따라 기억 조각까지 이동'});
  if(!wantsEdge&&!wantsCross&&!wantsGoal&&/(앞으로|오른쪽으로).*(가|이동)/.test(t)) actions.push({type:'move_edge',label:'앞쪽의 안전한 지점까지 이동'});
  if(!actions.length&&!notes.length) notes.push('사용할 아이템과 대상을 찾지 못했어요. “발판”, “밧줄”, “사다리” 중 하나와 사용할 위치를 말해 주세요.');
  return {actions,notes};
}
const ACTION_LABELS={
  reset:'시작 위치로 돌아가기',move_edge:'가장 가까운 절벽 앞까지 이동',platform:'가장 가까운 끊어진 길에 휴대용 발판 설치',
  cross:'설치된 길을 이용해 절벽 반대편으로 이동',rope:'넓은 절벽에 밧줄 다리 설치',ladder:'높은 벽에 접이식 사다리 설치',
  climb:'설치한 사다리를 타고 높은 곳으로 이동',goal:'안전한 길을 따라 기억 조각까지 이동'
};
async function interpretWithAI(text){
  if(DEMO_MODE){const plan=interpret(text);plan.source='demo';ui.connection.textContent='Pages 데모';setAiStatus('online','Pages 데모 모드');return plan;}
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(`${API_BASE}/api/interpret`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({
      command:text,state:{stage:currentStage+1,playerX:Math.round(player.x),executionsRemaining:commandLimit-commandsUsed,inventory:{...inventory},installed:createdPlatforms.map(p=>p.kind),gapsRemaining:stageGaps().length-createdPlatforms.length}
    })});
    if(!response.ok)throw new Error(`AI ${response.status}`);
    const data=await response.json();
    const actions=(Array.isArray(data.actions)?data.actions:[]).filter(a=>a&&ACTION_LABELS[a.type]).slice(0,8).map(a=>({type:a.type,label:ACTION_LABELS[a.type]}));
    const notes=Array.isArray(data.notes)?data.notes.filter(n=>typeof n==='string').slice(0,3):[];
    if(typeof data.reply==='string'&&data.reply.trim())addMessage('ai',data.reply.trim().slice(0,240));
    ui.connection.textContent='Solar 4';
    setAiStatus('online','Solar 4 연결됨');
    if(!actions.length&&!notes.length)notes.push('실행할 수 있는 행동을 찾지 못했어요. 목적지와 사용할 아이템을 조금 더 구체적으로 알려 주세요.');
    return {actions,notes,source:'ai'};
  }catch(error){
    const fallback=interpret(text);fallback.source='local';
    fallback.notes.push(error.name==='AbortError'?'Solar 4 응답 시간이 초과되어 기본 해석기로 전환했습니다.':'Solar 4 연결이 일시적으로 실패해 기본 해석기로 전환했습니다. 다시 실행하면 AI 연결을 재시도합니다.');
    ui.connection.textContent='기본 모드';
    setAiStatus('offline','AI 연결 재시도 중');
    return fallback;
  }finally{clearTimeout(timeout);}
}
function currentGroundIndex(){const grounds=STAGES[currentStage].grounds;const center=player.x+player.w/2;const index=grounds.findIndex(g=>center>=g[0]&&center<=g[1]);return index<0?0:index;}
function validatePlan(plan){
  if(!plan.actions.length)return plan;
  const stage=STAGES[currentStage],gaps=stageGaps();let segment=currentGroundIndex();
  const installed=new Set(createdPlatforms.filter(p=>Number.isInteger(p.gapIndex)).map(p=>p.gapIndex));
  let ladder=createdPlatforms.some(p=>p.kind==='ladder'),climbed=Boolean(stage.raised&&player.y<400);const errors=[];
  for(const action of plan.actions){
    if(action.type==='reset'){segment=0;climbed=false;continue;}
    if(action.type==='move_edge')continue;
    if(action.type==='platform'||action.type==='rope'){
      const gap=gaps[segment],fits=gap&&(action.type==='platform'?gap.w<=180:gap.w>180);
      if(!fits){errors.push(action.type==='platform'?'발판은 현재 위치 다음의 짧은 틈에서만 사용할 수 있어요.':'밧줄은 현재 위치 다음의 넓은 절벽에서만 사용할 수 있어요.');break;}installed.add(segment);continue;
    }
    if(action.type==='cross'){if(!installed.has(segment)){errors.push('길을 먼저 연결한 다음 건너가야 해요.');break;}segment++;continue;}
    if(action.type==='ladder'){if(!stage.raised||segment!==stage.grounds.length-1){errors.push('높은 벽 앞까지 도착한 다음 사다리를 설치해야 해요.');break;}ladder=true;continue;}
    if(action.type==='climb'){if(!ladder){errors.push('사다리를 먼저 설치한 다음 올라가야 해요.');break;}climbed=true;continue;}
    if(action.type==='goal'&&(segment!==stage.grounds.length-1||(stage.raised&&!climbed))){errors.push('모든 장애물을 순서대로 통과한 다음 목표로 이동해야 해요.');break;}
  }
  if(errors.length)return {actions:[],notes:[...plan.notes,...errors],source:plan.source};
  return plan;
}
function setAiStatus(mode,label){ui.globalAiStatus.className=`global-ai-status ${mode}`;ui.globalAiStatus.innerHTML='<i></i> '+label;}
async function checkAiHealth(silent=false){
  if(DEMO_MODE){setAiStatus('online','Pages 데모 모드');ui.connection.textContent='로컬 해석';return;}
  if(!silent)setAiStatus('checking','AI 확인 중');
  try{const response=await fetch(`${API_BASE}/api/health`,{cache:'no-store'});if(!response.ok)throw new Error();const data=await response.json();if(!data.configured){setAiStatus('offline','API 키 확인 필요');ui.connection.textContent='키 없음';}else{setAiStatus('online','Solar 4 연결됨');ui.connection.textContent='Solar 4';}}
  catch{setAiStatus('offline','AI 서버 연결 끊김');ui.connection.textContent='기본 모드';}
}
function renderPlan(plan){
  const list=plan.actions.length?`<ol>${plan.actions.map(a=>`<li>${a.label}</li>`).join('')}</ol>`:'<p>실행할 수 있는 행동이 없습니다.</p>';
  const notes=plan.notes.map(n=>`<p>· ${n}</p>`).join('');
  ui.compiler.innerHTML='<span class="eyebrow">가온의 해석 결과</span>'+list+notes;
  ui.state.textContent=plan.actions.length?'작전을 실행하고 있어요':'명령을 더 구체적으로 알려 주세요';
}
function stageGaps(){const grounds=STAGES[currentStage].grounds;return grounds.slice(0,-1).map((g,i)=>({x:g[1],w:grounds[i+1][0]-g[1],index:i}));}
function nextOpenGap(kind){return stageGaps().find(g=>!createdPlatforms.some(p=>p.gapIndex===g.index)&&(kind==='platform'?g.w<=180:g.w>180));}
function createBridge(kind){
  const gap=nextOpenGap(kind);if(!gap){showToast(kind==='platform'?'발판은 짧은 틈에만 설치할 수 있어요.':'밧줄은 넓은 절벽에만 설치할 수 있어요.');return false;}
  createdPlatforms.push({x:gap.x,y:465,w:gap.w,h:kind==='rope'?12:16,kind,gapIndex:gap.index,born:world.time});return true;
}
function createLadder(){
  const stage=STAGES[currentStage];if(!stage.raised||createdPlatforms.some(p=>p.kind==='ladder'))return false;
  createdPlatforms.push({x:stage.ladderX,y:stage.raised.y,w:18,h:465-stage.raised.y,kind:'ladder',born:world.time});return true;
}
function executePlan(){
  if(!pendingPlan)return; let done=0;
  pendingPlan.actions.forEach(action=>{
    if(action.type==='platform'&&inventory.platform>0){
      if(createBridge('platform')){inventory.platform--;done++;}
    }
    if(action.type==='rope'&&inventory.rope>0&&createBridge('rope')){inventory.rope--;done++;}
    if(action.type==='ladder'&&inventory.ladder>0&&createLadder()){inventory.ladder--;done++;}
    if(['move_edge','cross','climb','goal'].includes(action.type)){movementQueue.push(action);done++;}
    if(action.type==='reset'){resetPlayer();done++;}
  });
  updateInventory();addMessage('ai',done?'작전을 실행했어요.':'실행할 수 있는 새 행동이 없어요.');showToast(done?'가온이 작전을 실행했습니다.':'실행할 새 행동이 없습니다.');ui.state.textContent='명령을 기다리고 있어요';pendingPlan=null;
}
function addMessage(role,text){ const el=document.createElement('div');el.className=`message ${role==='ai'?'ai-message':'user-message'}`;el.innerHTML=`<span class="speaker">${role==='ai'?'가온':'나'}</span><p></p>`;el.querySelector('p').textContent=text;ui.chat.append(el);ui.chat.scrollTop=ui.chat.scrollHeight; }
function updateInventory(){
  ui.platformCount.textContent=inventory.platform;ui.ropeCount.textContent=inventory.rope;ui.ladderCount.textContent=inventory.ladder;
  document.querySelectorAll('[data-item]').forEach(el=>{const available=inventory[el.dataset.item]>0;el.disabled=!available;el.classList.toggle('unavailable',!available);});
}
function updateCommandLimit(){ui.remaining.textContent=Math.max(0,commandLimit-commandsUsed);ui.commandTotal.textContent=`/ ${commandLimit}`;ui.commandForm.querySelector('.run-button').disabled=commandsUsed>=commandLimit;}
function showToast(text){clearTimeout(toastTimer);ui.toast.textContent=text;ui.toast.classList.add('show');toastTimer=setTimeout(()=>ui.toast.classList.remove('show'),2200);}
function resetPlayer(){Object.assign(player,{x:90,y:390,vx:0,vy:0});world.cameraX=0;movementQueue=[];activeMovement=null;}
function loadStage(){
  const stage=STAGES[currentStage];
  commandLimit=stage.limit;
  staticPlatforms=stage.grounds.map(([start,end])=>({x:start,y:465,w:end-start,h:100}));
  if(stage.raised)staticPlatforms.push({...stage.raised,h:18});
  if(currentStage===0)staticPlatforms.push({x:610,y:365,w:120,h:18},{x:760,y:300,w:110,h:18});
  ui.stageNumber.textContent=`기억 ${String(currentStage+1).padStart(2,'0')}`;ui.stageName.textContent=stage.name;ui.objective.textContent=stage.objective;
  ui.memoryReward.textContent=`‘${stage.reward}’ 기억을 되찾았습니다.`;ui.completeStory.textContent=stage.story;ui.nextStage.textContent=currentStage===STAGES.length-1?'첫 스테이지로':'다음 스테이지';
  restartStage(false);addMessage('ai',`${currentStage+1}번째 기억, ‘${stage.name}’을 시작할게요. 실행 기회는 ${stage.limit}번이에요.`);
}
function restartStage(notify){
  ui.complete.classList.add('hidden');
  world.completed=false;
  pendingPlan=null;
  commandsUsed=0;
  createdPlatforms.length=0;
  Object.assign(inventory,STAGES[currentStage].items);
  updateInventory();
  updateCommandLimit();
  ui.compiler.innerHTML='<span class="eyebrow">가온의 해석 결과</span><p>코드를 작성하고 동작 실행을 눌러 주세요.</p>';
  resetPlayer();
  if(notify){addMessage('ai','스테이지를 처음 상태로 되돌렸어요. 새로운 작전을 세워 볼까요?');showToast('스테이지를 새로고침했습니다.');}
}

function goalPositionX(){const stage=STAGES[currentStage];return (stage.raised?stage.raised.x+stage.raised.w:stage.grounds.at(-1)[1])-95;}
function movementTarget(type){
  const grounds=STAGES[currentStage].grounds;
  if(type==='goal') return goalPositionX();
  if(type==='cross'){
    const next=grounds.find(g=>g[0]>player.x+player.w);
    return next?next[0]+40:goalPositionX();
  }
  const current=grounds.find(g=>player.x+player.w/2>=g[0]&&player.x+player.w/2<g[1]);
  return current?current[1]-player.w-10:goalPositionX();
}

function updatePromptMovement(dt){
  if(!activeMovement&&movementQueue.length){
    activeMovement=movementQueue.shift();
    if(activeMovement.type==='climb')activeMovement.targetY=STAGES[currentStage].raised?.y-player.h;
    activeMovement.target=movementTarget(activeMovement.type);
  }
  if(!activeMovement){player.vx=0;return;}
  if(activeMovement.type==='climb'){
    const stage=STAGES[currentStage];const ladder=createdPlatforms.some(p=>p.kind==='ladder');
    if(!stage.raised||!ladder){activeMovement=null;showToast('사다리를 먼저 설치해야 합니다.');return;}
    const targetX=stage.raised.x+10;player.vx=0;player.vy=0;player.x+=(targetX-player.x)*Math.min(1,dt*7);player.y+=(activeMovement.targetY-player.y)*Math.min(1,dt*5);
    if(Math.abs(player.y-activeMovement.targetY)<3){player.x=targetX;player.y=activeMovement.targetY;activeMovement=null;}return;
  }
  const distance=activeMovement.target-player.x;
  if(Math.abs(distance)<5){player.x=activeMovement.target;player.vx=0;activeMovement=null;return;}
  player.vx=Math.sign(distance)*player.speed;
  player.facing=Math.sign(distance);
}

function update(dt){
  if(world.completed)return; world.time+=dt;
  updatePromptMovement(dt);
  if(activeMovement?.type!=='climb')player.vy+=world.gravity*dt;player.x+=player.vx*dt;player.x=Math.max(0,Math.min(world.width-player.w,player.x));
  const prevBottom=player.y+player.h;player.y+=player.vy*dt;player.grounded=false;
  [...staticPlatforms,...createdPlatforms.filter(p=>p.kind!=='ladder')].forEach(p=>{if(player.vy>=0&&prevBottom<=p.y+7&&player.y+player.h>=p.y&&player.x+player.w>p.x&&player.x<p.x+p.w){player.y=p.y-player.h;player.vy=0;player.grounded=true;}});
  if(player.y>610){resetPlayer();addMessage('ai','길이 연결되지 않아 떨어졌어요. 이동 전에 사용할 아이템과 위치를 함께 지시해 주세요.');showToast('작전 실패 · 시작 위치로 돌아왔습니다.');}
  const targetCam=Math.max(0,Math.min(world.width-canvas.width,player.x-canvas.width*.38));world.cameraX+=(targetCam-world.cameraX)*Math.min(1,dt*5);
  ai.x+=(player.x-48-ai.x)*dt*3.4;ai.y+=(player.y-55+Math.sin(world.time*3)*10-ai.y)*dt*3.4;
  const goalX=goalPositionX();
  if(player.x>goalX-15){world.completed=true;saveProfile(ui.profile.textContent,true);ui.complete.classList.remove('hidden');}
}
function roundedRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function draw(){
  const cam=Math.round(world.cameraX);
  ctx.fillStyle='#293657';ctx.fillRect(0,0,960,540);
  ctx.fillStyle='#35486b';ctx.fillRect(0,170,960,370);
  // pixel sun and square clouds
  ctx.fillStyle='#f4cf72';ctx.fillRect(78,58,40,40);ctx.fillStyle='#ffe59b';ctx.fillRect(86,50,24,56);ctx.fillRect(70,66,56,24);
  drawCloud(210,82,1);drawCloud(650,112,.8);drawCloud(810,55,.55);
  // blocky background mountains
  ctx.fillStyle='#3f506e';
  for(let i=0;i<7;i++){const x=i*170-50;ctx.beginPath();ctx.moveTo(x,350);ctx.lineTo(x+24,318);ctx.lineTo(x+24,294);ctx.lineTo(x+48,294);ctx.lineTo(x+48,254+(i%2)*36);ctx.lineTo(x+72,254+(i%2)*36);ctx.lineTo(x+72,286);ctx.lineTo(x+96,286);ctx.lineTo(x+96,318);ctx.lineTo(x+130,350);ctx.fill();}
  ctx.fillStyle='#293b57';ctx.fillRect(0,350,960,115);
  // distant pixel grass and ruins
  ctx.fillStyle='#466257';for(let x=0;x<960;x+=24){const h=16+((x/24)%3)*8;ctx.fillRect(x,350-h,16,h);}
  ctx.fillStyle='#55647a';ctx.fillRect(725,250,22,100);ctx.fillRect(705,250,62,18);ctx.fillStyle='#26334f';ctx.fillRect(731,278,10,72);
  particles.forEach(p=>{ctx.fillStyle=p.r>1?'#90d8bd':'#668c86';ctx.fillRect(Math.round(p.x/4)*4,Math.round(p.y/4)*4,4,4);});
  ctx.save();ctx.translate(-cam,0);
  staticPlatforms.forEach(drawPlatform);createdPlatforms.forEach(drawCreated);
  const secondGround=STAGES[currentStage].grounds[1];
  drawPixelTree(secondGround?Math.min(820,secondGround[0]-10):520,285);
  // goal memory shard
  const stage=STAGES[currentStage],goal=goalPositionX()+20,goalY=stage.raised?stage.raised.y-92:373;const bob=Math.round(Math.sin(world.time*3)*4/4)*4;ctx.fillStyle='rgba(122,241,199,.18)';ctx.fillRect(goal-24,goalY+bob,48,48);ctx.fillStyle='#d9fff0';ctx.fillRect(goal-4,goalY+4+bob,8,8);ctx.fillRect(goal-12,goalY+12+bob,24,16);ctx.fillRect(goal-4,goalY+28+bob,8,8);ctx.fillStyle='#72f1c7';ctx.fillRect(goal-4,goalY+12+bob,8,16);
  drawAI();drawPlayer();ctx.restore();
  ctx.fillStyle='rgba(8,14,28,.28)';ctx.fillRect(0,0,960,8);ctx.fillRect(0,532,960,8);ctx.fillRect(0,0,8,540);ctx.fillRect(952,0,8,540);
}
function drawCloud(x,y,s){ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.fillStyle='#7184a0';ctx.fillRect(0,16,88,16);ctx.fillRect(16,8,48,24);ctx.fillStyle='#91a0b6';ctx.fillRect(24,0,32,16);ctx.restore();}
function drawPixelTree(x,y){ctx.fillStyle='#543f42';ctx.fillRect(x+20,y+52,20,128);ctx.fillStyle='#73504a';ctx.fillRect(x+28,y+60,8,120);ctx.fillRect(x-12,y+72,52,12);ctx.fillRect(x+36,y+38,54,12);ctx.fillStyle='#274f4b';ctx.fillRect(x-28,y+28,56,48);ctx.fillRect(x+4,y,64,72);ctx.fillRect(x+48,y+20,48,52);ctx.fillStyle='#38685b';ctx.fillRect(x-20,y+20,32,24);ctx.fillRect(x+12,y+8,32,24);ctx.fillRect(x+56,y+28,24,24);ctx.fillStyle='#72f1c7';ctx.fillRect(x-16,y+66,8,8);}
function drawPlatform(p){const tile=24;ctx.fillStyle=p.y>450?'#3f403e':'#494b54';ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle='#73915e';ctx.fillRect(p.x,p.y,p.w,8);ctx.fillStyle='#97ad70';ctx.fillRect(p.x,p.y,p.w,4);for(let x=p.x;x<p.x+p.w;x+=tile){ctx.fillStyle=((x/tile)&1)?'#4d493f':'#454239';ctx.fillRect(x,p.y+12,Math.min(tile-2,p.x+p.w-x),20);ctx.fillStyle='#292e37';ctx.fillRect(x+8,p.y+40,8,8);}}
function drawCreated(p){const bright=Math.sin((world.time-p.born)*6)>0;if(p.kind==='ladder'){ctx.fillStyle='#a8cc72';ctx.fillRect(p.x,p.y,4,p.h);ctx.fillRect(p.x+p.w-4,p.y,4,p.h);for(let y=p.y+8;y<p.y+p.h;y+=16)ctx.fillRect(p.x,y,p.w,4);return;}ctx.fillStyle=p.kind==='rope'?'#725d3e':'#2d6a65';ctx.fillRect(p.x,p.y,p.w,p.h);ctx.fillStyle=p.kind==='rope'?'#e2bb6c':bright?'#99ffe0':'#72d6bd';ctx.fillRect(p.x,p.y,p.w,4);for(let x=p.x+8;x<p.x+p.w;x+=20){ctx.fillStyle=p.kind==='rope'?'#493c30':'#183e43';ctx.fillRect(x,p.y+5,8,7);}if(p.kind==='rope'){ctx.fillStyle='#d2b77a';for(let x=p.x;x<p.x+p.w;x+=16){ctx.fillRect(x,p.y,12,5);ctx.fillRect(x+4,p.y+5,4,5);}}}
function drawPlayer(){const x=Math.round(player.x/4)*4,y=Math.round(player.y/4)*4;ctx.save();ctx.translate(x,y);if(player.facing<0){ctx.translate(player.w,0);ctx.scale(-1,1);}ctx.fillStyle='#30283f';ctx.fillRect(4,0,24,8);ctx.fillRect(0,8,32,12);ctx.fillStyle='#d9b49b';ctx.fillRect(8,12,20,16);ctx.fillStyle='#241f33';ctx.fillRect(20,16,4,4);ctx.fillStyle='#765ea6';ctx.fillRect(4,28,24,12);ctx.fillRect(0,32,8,8);ctx.fillStyle='#d8e4e7';ctx.fillRect(8,40,8,8);ctx.fillRect(20,40,8,8);ctx.fillStyle='#20283b';ctx.fillRect(8,44,8,4);ctx.fillRect(20,44,8,4);ctx.restore();}
function drawAI(){const x=Math.round(ai.x/4)*4,y=Math.round(ai.y/4)*4,b=Math.sin(world.time*4)>0;ctx.fillStyle='rgba(114,241,199,.18)';ctx.fillRect(x-20,y-20,40,40);ctx.fillStyle=b?'#caffed':'#72f1c7';ctx.fillRect(x-8,y-12,16,24);ctx.fillRect(x-12,y-8,24,16);ctx.fillStyle='#284d57';ctx.fillRect(x-4,y-4,8,8);ctx.fillStyle='#d9fff0';ctx.fillRect(x,y-4,4,4);}
function loop(now){const dt=Math.min(.033,(now-lastTime)/1000);lastTime=now;update(dt);draw();requestAnimationFrame(loop);}
loadProfile();loadStage();checkAiHealth();setInterval(()=>checkAiHealth(true),10000);requestAnimationFrame(loop);
