const MODEL = 'upstage/solar-pro4';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ALLOWED_ORIGINS = new Set([
  'https://sumin-990416.github.io',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8765',
  'http://localhost:8766',
  'http://localhost:8765',
]);
const ALLOWED_ACTIONS = ['reset', 'move_edge', 'platform', 'cross', 'rope', 'ladder', 'climb', 'goal'];
const requestsByIp = new Map();

const SYSTEM_PROMPT = `당신은 2D 퍼즐 게임의 AI 동료 '가온'이다. 사용자의 자연스러운 한국어 작전을 게임 행동 배열로 변환한다.
가능한 행동은 다음뿐이다.
- move_edge: 다음 절벽 앞 또는 안전한 지점까지 이동
- platform: 180px 이하의 짧은 틈에 휴대용 발판 설치
- cross: 현재 절벽 반대편으로 이동
- rope: 180px보다 넓은 절벽에 밧줄 다리 설치
- ladder: 높은 벽에 접이식 사다리 설치
- climb: 설치된 사다리를 타고 높은 기록대로 올라가기
- goal: 기억 조각까지 이동
- reset: 시작 위치로 이동
복합 명령은 사용자가 말한 논리적 순서대로 여러 행동을 반환한다. 보유 수량이 0인 아이템 사용은 행동에 넣지 말고 notes로 설명한다. 존재하지 않는 행동, 좌표, 코드, 마크다운은 출력하지 않는다. reply는 가온의 짧고 자연스러운 한국어 확인 문장이다.
한 번의 프롬프트에는 최대 8개의 행동을 포함할 수 있다.
예시: "첫 절벽 앞까지 가서 발판을 설치하고 건너가" => move_edge, platform, cross
예시: "사다리를 설치하고 높은 곳으로 올라가" => ladder, climb`;

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'gaon_game_plan',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false, required: ['actions', 'notes', 'reply'],
      properties: {
        actions: {type: 'array', maxItems: 8, items: {type: 'object', additionalProperties: false, required: ['type'], properties: {type: {type: 'string', enum: ALLOWED_ACTIONS}}}},
        notes: {type: 'array', maxItems: 3, items: {type: 'string', maxLength: 160}},
        reply: {type: 'string', maxLength: 240},
      },
    },
  },
};

function corsHeaders(origin) {
  return {
    ...(ALLOWED_ORIGINS.has(origin) ? {'Access-Control-Allow-Origin': origin} : {}),
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(origin)}});
}

function rateLimit(ip) {
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter((time) => now - time < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  requestsByIp.set(ip, recent);
  return true;
}

function cleanState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return {
    stage: Number(value.stage) || 1,
    playerX: Number(value.playerX) || 0,
    executionsRemaining: Math.max(0, Number(value.executionsRemaining) || 0),
    inventory: value.inventory && typeof value.inventory === 'object' ? value.inventory : {},
    installed: Array.isArray(value.installed) ? value.installed.slice(0, 8) : [],
    gapsRemaining: Math.max(0, Number(value.gapsRemaining) || 0),
  };
}

async function interpret(request, env, origin) {
  if (!env.OPENROUTER_API_KEY) return json({error: 'OPENROUTER_API_KEY가 설정되지 않았습니다.'}, 503, origin);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!rateLimit(ip)) return json({error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'}, 429, origin);

  let body;
  try {
    if (Number(request.headers.get('Content-Length') || 0) > 12_000) throw new Error('too_large');
    body = await request.json();
  } catch {
    return json({error: '잘못된 요청입니다.'}, 400, origin);
  }
  const command = typeof body.command === 'string' ? body.command.trim() : '';
  if (!command || Array.from(command).length > 50) return json({error: '명령은 한글 기준 1~50자로 입력해 주세요.'}, 400, origin);
  const state = JSON.stringify(cleanState(body.state)).slice(0, 1200);

  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'X-OpenRouter-Title': 'Gaon: Lost Memory',
        'HTTP-Referer': 'https://sumin-990416.github.io/gaon-lost-memory/',
      },
      body: JSON.stringify({
        model: MODEL, temperature: 0.1, max_tokens: 500, response_format: RESPONSE_FORMAT,
        messages: [{role: 'system', content: SYSTEM_PROMPT}, {role: 'user', content: `현재 게임 상태: ${state}\n모험가의 명령: ${command}`}],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const result = await upstream.json();
    if (!upstream.ok) throw new Error(result?.error?.message || `OpenRouter ${upstream.status}`);
    const parsed = JSON.parse(result?.choices?.[0]?.message?.content || '{}');
    const actions = Array.isArray(parsed.actions) ? parsed.actions.filter((action) => action && ALLOWED_ACTIONS.includes(action.type)).slice(0, 8) : [];
    const notes = Array.isArray(parsed.notes) ? parsed.notes.filter((note) => typeof note === 'string').slice(0, 3) : [];
    return json({actions, notes, reply: typeof parsed.reply === 'string' ? parsed.reply.slice(0, 240) : '작전을 이해했어요.', model: MODEL}, 200, origin);
  } catch (error) {
    return json({error: 'AI가 작전을 해석하지 못했습니다.', detail: String(error.message).slice(0, 160)}, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({error: '허용되지 않은 출처입니다.'}, 403, origin);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: corsHeaders(origin)});
    const {pathname} = new URL(request.url);
    if (request.method === 'GET' && pathname === '/api/health') return json({server: true, configured: Boolean(env.OPENROUTER_API_KEY), model: MODEL}, 200, origin);
    if (request.method === 'POST' && pathname === '/api/interpret') return interpret(request, env, origin);
    return json({error: 'Not found'}, 404, origin);
  },
};
