// AI Gateway — provider-agnostic LLM layer.
// Consumers (messageCreate.js / assistant.js) speak ANTHROPIC message/tool format;
// the gateway translates to/from OpenAI-compatible and Gemini protocols.
const Anthropic = require("@anthropic-ai/sdk");

const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    models: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-3-5-haiku-latest"],
  },
  openai: {
    label: "OpenAI (GPT / Codex)",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  },
  gemini: {
    label: "Google Gemini",
    protocol: "gemini",
    models: ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"],
  },
  deepseek: {
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  qwen: {
    label: "Qwen (DashScope)",
    protocol: "openai",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
  },
  custom: {
    label: "Custom (any OpenAI-compatible)",
    protocol: "openai",
    baseUrl: null,
    models: [],
  },
};

const defaultModel = (p) => PROVIDERS[p]?.models[0] || "gpt-4o-mini";
const defaultBase = (p) => PROVIDERS[p]?.baseUrl || null;

/* ---------- config resolution: workspace JSON → legacy raw key → host env ---------- */
function resolveAiConfig(ws) {
  if (ws?.aiApiKey) {
    try {
      const parsed = JSON.parse(ws.aiApiKey);
      if (parsed && parsed.provider && parsed.key) {
        return {
          provider: parsed.provider,
          model: parsed.model || defaultModel(parsed.provider),
          apiKey: parsed.key,
          baseUrl: parsed.baseUrl || defaultBase(parsed.provider),
        };
      }
    } catch {
      /* legacy raw Anthropic key */
    }
    return {
      provider: "anthropic",
      model: defaultModel("anthropic"),
      apiKey: ws.aiApiKey,
      baseUrl: null,
    };
  }
  const envKey = process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!envKey) return null;
  const provider =
    process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai");
  return {
    provider,
    model: process.env.AI_MODEL || defaultModel(provider),
    apiKey: envKey,
    baseUrl: process.env.AI_BASE_URL || defaultBase(provider),
  };
}

const encodeAiConfig = (cfg) => JSON.stringify(cfg);

/* ---------- Anthropic-shaped client ---------- */
function createAiClient(config) {
  const protocol = PROVIDERS[config.provider]?.protocol || "openai";
  return {
    messages: {
      create: (params) => {
        if (protocol === "anthropic") return anthropicCall(config, params);
        if (protocol === "gemini") return geminiCall(config, params);
        return openaiCall(config, params);
      },
    },
  };
}

async function anthropicCall(config, params) {
  const client = new Anthropic({ apiKey: config.apiKey, fetch: globalThis.fetch });
  return client.messages.create({ ...params, model: config.model });
}

/* ---------- OpenAI-compatible (OpenAI / DeepSeek / Qwen / Custom) ---------- */
function anthropicMessagesToOpenAI(messages) {
  const out = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "assistant") {
      const text = (m.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolUses = (m.content || []).filter((b) => b.type === "tool_use");
      const msg = { role: "assistant" };
      if (text) msg.content = text;
      if (toolUses.length)
        msg.tool_calls = toolUses.map((t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: JSON.stringify(t.input || {}) },
        }));
      out.push(msg);
    } else {
      const parts = [];
      for (const b of m.content || []) {
        if (b.type === "text") parts.push({ type: "text", text: b.text });
        else if (b.type === "image")
          parts.push({
            type: "image_url",
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          });
      }
      if (parts.length) out.push({ role: "user", content: parts });
      for (const b of (m.content || []).filter((b) => b.type === "tool_result")) {
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: String(b.content ?? "") });
      }
    }
  }
  return out;
}

async function openaiCall(config, params) {
  const base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const body = { model: config.model, messages: [], max_tokens: params.max_tokens || 4096 };
  if (params.system) body.messages.push({ role: "system", content: params.system });
  body.messages.push(...anthropicMessagesToOpenAI(params.messages || []));
  if (params.tools?.length)
    body.tools = params.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `AI request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const msg = data.choices?.[0]?.message;
  const content = [];
  if (msg?.content) content.push({ type: "text", text: msg.content });
  for (const tc of msg?.tool_calls || []) {
    let input = {};
    try {
      input = JSON.parse(tc.function.arguments || "{}");
    } catch {}
    content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
  }
  return {
    stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    content,
  };
}

/* ---------- Gemini ---------- */
function anthropicMessagesToGemini(messages) {
  const contents = [];
  const toolNames = {};
  for (const m of messages) {
    const blocks =
      typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content || [];
    if (m.role === "assistant") {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") parts.push({ text: b.text });
        else if (b.type === "tool_use") {
          toolNames[b.id] = b.name;
          parts.push({ functionCall: { name: b.name, args: b.input || {} } });
        }
      }
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      const parts = [];
      for (const b of blocks) {
        if (b.type === "text") parts.push({ text: b.text });
        else if (b.type === "image")
          parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
        else if (b.type === "tool_result")
          parts.push({
            functionResponse: {
              name: toolNames[b.tool_use_id] || "tool",
              response: { content: String(b.content ?? "") },
            },
          });
      }
      if (parts.length) contents.push({ role: "user", parts });
    }
  }
  return contents;
}

async function geminiCall(config, params) {
  const body = {
    contents: anthropicMessagesToGemini(params.messages || []),
    generationConfig: { maxOutputTokens: params.max_tokens || 4096 },
  };
  if (params.system) body.systemInstruction = { parts: [{ text: params.system }] };
  if (params.tools?.length)
    body.tools = [
      {
        functionDeclarations: params.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      },
    ];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const content = [];
  let i = 0;
  for (const p of parts) {
    if (p.text) content.push({ type: "text", text: p.text });
    else if (p.functionCall)
      content.push({
        type: "tool_use",
        id: `gem_${Date.now()}_${i++}`,
        name: p.functionCall.name,
        input: p.functionCall.args || {},
      });
  }
  return {
    stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    content,
  };
}

/* ---------- test connection (tiny ping before saving) ---------- */
async function testAiConnection(config) {
  try {
    const client = createAiClient(config);
    await client.messages.create({
      model: config.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    return {
      ok: true,
      message: `✅ Connected to ${PROVIDERS[config.provider]?.label || config.provider} (${config.model})`,
    };
  } catch (err) {
    return { ok: false, message: `❌ ${err.message}` };
  }
}

module.exports = {
  PROVIDERS,
  defaultModel,
  defaultBase,
  resolveAiConfig,
  encodeAiConfig,
  createAiClient,
  testAiConnection,
};
