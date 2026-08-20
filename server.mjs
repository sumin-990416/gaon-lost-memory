import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadEnvFile} from 'node:process';

const ROOT=fileURLToPath(new URL('.',import.meta.url));
try{loadEnvFile(join(ROOT,'.env'));}catch(error){if(error?.code!=='ENOENT')throw error;}
const PORT=Number(process.env.PORT||8765);
const MODEL='upstage/solar-pro4';
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};
const ALLOWED_ACTIONS=new Set(['reset','move_edge','platform','cross','rope','ladder','climb','goal']);
const rate=new Map();
let lastAiSuccess=0;

const SYSTEM_PROMPT=`당신은 2D 퍼즐 게임의 AI 동료 '가온'이다. 사용자의 자연스러운 한국어 작전을 게임 행동 배열로 변환한다.
가능한 행동은 다음뿐이다.
- move_edge: 다음 절벽 앞 또는 안전한 지점까지 이동
- platform: 180px 이하의 짧은 틈에 휴대용 발판 설치
- cross: 현재 절벽 반대편으로 이동
- rope: 180px보다 넓은 절벽에 밧줄 다리 설치
- ladder: 높은 벽에 접이식 사다리 설치
- climb: 설치된 사다리를 타고 높은 기록대로 올라가기
- goal: 기억 조각까지 이동
- reset: 시작 위치로 이동
복합 명령은 사용자가 말한 논리적 순서대로 여러 행동을 반환한다. 길을 건너라는 지시만 있고 설치 지시가 없다면 cross만 반환하며 게임이 성공 여부를 판단한다. 보유 수량이 0인 아이템 사용은 행동에 넣지 말고 notes로 설명한다. 존재하지 않는 행동, 좌표, 코드, 마크다운은 출력하지 않는다. reply는 가온의 짧고 자연스러운 한국어 확인 문장이다.
현재 상태의 executionsRemaining은 프롬프트 제출 가능 횟수다. 한 번의 프롬프트에는 최대 8개의 행동을 모두 포함할 수 있으므로 행동 개수를 executionsRemaining으로 제한하거나 경고하지 않는다.
명령에 실행 가능한 행동이 하나라도 있으면 actions를 절대로 빈 배열로 반환하지 않는다.
예시: "첫 절벽 앞까지 가서 발판을 설치하고 건너가" => [{"type":"move_edge"},{"type":"platform"},{"type":"cross"}]
예시: "나뭇가지에 밧줄을 연결한 다음 건너가" => [{"type":"rope"},{"type":"cross"}]
예시: "사다리를 설치하고 높은 곳으로 올라가" => [{"type":"ladder"},{"type":"climb"}]
예시: "기억 조각까지 가" => [{"type":"goal"}]
예시: "처음부터 다시 시작해" => [{"type":"reset"}]`;

const RESPONSE_FORMAT={type:'json_schema',json_schema:{name:'gaon_game_plan',strict:true,schema:{type:'object',additionalProperties:false,required:['actions','notes','reply'],properties:{
  actions:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['type'],properties:{type:{type:'string',enum:[...ALLOWED_ACTIONS]}}}},
  notes:{type:'array',maxItems:3,items:{type:'string',maxLength:160}},reply:{type:'string',maxLength:240}
}}}};

function json(res,status,data,extra={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extra});res.end(JSON.stringify(data));}
function allowRequest(ip){const now=Date.now();const recent=(rate.get(ip)||[]).filter(t=>now-t<60000);if(recent.length>=30)return false;recent.push(now);rate.set(ip,recent);return true;}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12000)throw new Error('too_large');}return JSON.parse(raw||'{}');}

async function interpret(req,res){
  if(!process.env.OPENROUTER_API_KEY)return json(res,503,{error:'OPENROUTER_API_KEY가 서버에 설정되지 않았습니다.'});
  if(!allowRequest(req.socket.remoteAddress||'unknown'))return json(res,429,{error:'잠시 후 다시 시도해 주세요.'});
  let input;try{input=await body(req);}catch{return json(res,400,{error:'잘못된 요청입니다.'});}
  const command=typeof input.command==='string'?input.command.trim().slice(0,180):'';
  if(!command)return json(res,400,{error:'명령이 비어 있습니다.'});
  const state=JSON.stringify(input.state||{}).slice(0,1200);
  try{
    const upstream=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{
      'Authorization':`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json','X-OpenRouter-Title':'Gaon: Lost Memory'
    },body:JSON.stringify({model:MODEL,temperature:0.1,max_tokens:500,response_format:RESPONSE_FORMAT,messages:[
      {role:'system',content:SYSTEM_PROMPT},{role:'user',content:`현재 게임 상태: ${state}\n모험가의 명령: ${command}`}
    ]})});
    const result=await upstream.json();
    if(!upstream.ok)throw new Error(result?.error?.message||`OpenRouter ${upstream.status}`);
    const parsed=JSON.parse(result?.choices?.[0]?.message?.content||'{}');
    const actions=Array.isArray(parsed.actions)?parsed.actions.filter(a=>a&&ALLOWED_ACTIONS.has(a.type)).slice(0,8):[];
    const notes=Array.isArray(parsed.notes)?parsed.notes.filter(n=>typeof n==='string').slice(0,3):[];
    lastAiSuccess=Date.now();
    json(res,200,{actions,notes,reply:typeof parsed.reply==='string'?parsed.reply.slice(0,240):'작전을 이해했어요.',model:MODEL,usage:result.usage||null});
  }catch(error){json(res,502,{error:'AI가 작전을 해석하지 못했습니다.',detail:String(error.message).slice(0,180)});}
}

async function staticFile(req,res){
  const pathname=new URL(req.url,'http://local').pathname;
  const relative=pathname==='/'?'index.html':decodeURIComponent(pathname.slice(1));
  const safe=normalize(relative).replace(/^(\.\.(\/|\\|$))+/,'');
  const path=join(ROOT,safe);
  if(!path.startsWith(ROOT))return json(res,403,{error:'Forbidden'});
  try{const info=await stat(path);if(!info.isFile())throw new Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':MIME[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);}catch{json(res,404,{error:'Not found'});}
}

createServer(async(req,res)=>{
  if(req.method==='GET'&&req.url==='/api/health')return json(res,200,{server:true,configured:Boolean(process.env.OPENROUTER_API_KEY),model:MODEL,lastAiSuccess});
  if(req.method==='POST'&&req.url==='/api/interpret')return interpret(req,res);
  if(req.method==='GET'||req.method==='HEAD')return staticFile(req,res);
  json(res,405,{error:'Method not allowed'});
}).listen(PORT,()=>console.log(`가온 개발 서버: http://127.0.0.1:${PORT} · ${MODEL}`));
