#!/usr/bin/env node
/**
 * Social Harness MCP Server (JSON-RPC 2.0 over stdio)
 * Tools:
 *  - provision_theme_mailbox_and_persona
 *  - fetch_latest_verification_code
 *  - generate_and_audit_sns_campaign
 */

const BASE_URL = process.env.SOCIAL_HARNESS_URL || 'http://127.0.0.1:8804';

const TOOLS = [
  {
    name: 'provision_theme_mailbox_and_persona',
    description: 'テーマ名を指定するだけで、Cloudflare Email Routing用の専用メールアドレス（*@mail.harness-ops.dev）を自動生成し、SNS運用ペルソナ・プロフィール・発信軸をD1上に構築します。',
    inputSchema: {
      type: 'object',
      properties: {
        theme_name: { type: 'string', description: 'SNS運用テーマ名（例：インディーゲーム開発ラボ）' },
        slug_hint: { type: 'string', description: 'メールアドレスの接頭辞ヒント（例：indie-game）' },
        target_audience: { type: 'string', description: 'ターゲット読者層' },
        simulate_welcome_otp: { type: 'boolean', description: '初回OTP確認メール受信も同時シミュレートするか' }
      },
      required: ['theme_name']
    }
  },
  {
    name: 'fetch_latest_verification_code',
    description: '自動生成したテーマ別メールアドレス宛に届いた最新のSNS認証メールから、6桁のOTP認証コードと確認リンクを取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        recipient_email: { type: 'string', description: '確認したいメールアドレス（未指定時は最新一覧を返却）' }
      }
    }
  },
  {
    name: 'generate_and_audit_sns_campaign',
    description: '1つのネタからXメイン投稿（URL分離でリーチ減衰を回避）＋Xリプライ欄＋Bluesky/Threads投稿を一括生成し、シャドウバン＆アルゴリズム安全度スコアを監査して配信キューへ登録します。',
    inputSchema: {
      type: 'object',
      properties: {
        persona_id: { type: 'number', description: 'ペルソナID' },
        source_topic: { type: 'string', description: '発信したいネタ・トピック' },
        target_url: { type: 'string', description: '誘導先URL（自動でリプライ欄へ分離されます）' }
      },
      required: ['source_topic']
    }
  }
];

async function handleRequest(req) {
  if (req.method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'social-harness-mcp', version: '1.0.0' }
    };
  }
  if (req.method === 'tools/list') {
    return { tools: TOOLS };
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args } = req.params;
    if (name === 'provision_theme_mailbox_and_persona') {
      const res = await fetch(`${BASE_URL}/api/personas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      });
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    if (name === 'fetch_latest_verification_code') {
      const res = await fetch(`${BASE_URL}/api/dashboard`);
      const data = await res.json();
      const filtered = args && args.recipient_email
        ? data.emails.filter((e) => e.recipient_email === args.recipient_email)
        : data.emails;
      return { content: [{ type: 'text', text: JSON.stringify(filtered, null, 2) }] };
    }
    if (name === 'generate_and_audit_sns_campaign') {
      const res = await fetch(`${BASE_URL}/api/posts/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      });
      const data = await res.json();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
    throw new Error(`Unknown tool: ${name}`);
  }
  return {};
}

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const req = JSON.parse(line);
      const result = await handleRequest(req);
      if (req.id !== undefined) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\n');
      }
    } catch (err) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: err.message } }) + '\n');
    }
  }
});
