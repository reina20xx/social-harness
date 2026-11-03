import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('/api/*', cors());

function generateSlug(text: string): string {
  const ascii = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = ascii.length >= 3 ? ascii.slice(0, 14) : 'theme-ops';
  const rand = Math.floor(0x1000 + Math.random() * 0x9000).toString(16);
  return `${prefix}-${rand}`;
}

export function extractOtpAndUrl(subject: string, body: string): { otp: string | null; url: string | null } {
  const combined = `${subject}\n${body}`;
  const otpMatch = combined.match(/\b(\d{6})\b/);
  const urlMatch = combined.match(/https?:\/\/[^\s"'<>]+/);
  return {
    otp: otpMatch ? otpMatch[1] : null,
    url: urlMatch ? urlMatch[0] : null,
  };
}

// 0. Health Check
app.get('/api/health', (c) => c.json({ status: 'ok', service: 'social-harness' }));

// 1. Dashboard Summary API
app.get('/api/dashboard', async (c) => {
  const personas = await c.env.DB.prepare('SELECT * FROM theme_personas ORDER BY id DESC').all();
  const emails = await c.env.DB.prepare('SELECT * FROM inbound_emails ORDER BY id DESC LIMIT 20').all();
  const posts = await c.env.DB.prepare(`
    SELECT p.*, tp.theme_name, tp.account_handle, tp.email_address
    FROM sns_posts p
    LEFT JOIN theme_personas tp ON p.persona_id = tp.id
    ORDER BY p.id DESC
  `).all();

  const personaList = personas.results || [];
  const emailList = emails.results || [];
  const postList = posts.results || [];

  const avgScore = postList.length
    ? Math.round(postList.reduce((acc: number, row: any) => acc + Number(row.algorithm_score || 0), 0) / postList.length)
    : 0;

  return c.json({
    kpis: {
      total_personas: personaList.length,
      active_mailboxes: personaList.length,
      otp_extracted_count: emailList.filter((e: any) => e.extracted_otp).length,
      queued_posts_count: postList.length,
      avg_algorithm_score: avgScore,
    },
    personas: personaList,
    emails: emailList,
    posts: postList,
  });
});

// 2. Auto-Provision Theme Email Address + AI Persona
app.post('/api/personas', async (c) => {
  const body = await c.req.json();
  const themeName = (body.theme_name || '').trim();
  if (!themeName) {
    return c.json({ error: 'theme_name is required' }, 400);
  }

  const domain = (body.email_domain || 'mail.harness-ops.dev').trim();
  const slug = generateSlug(body.slug_hint || themeName);
  const emailAddress = `${slug}@${domain}`;
  const handle = `@${slug.replace(/-/g, '_')}`;
  const targetAudience = (body.target_audience || '該当テーマに関心のあるSNSユーザー・実務者').trim();
  const toneStyle = (body.tone_style || '親しみやすく実体験ベース・誇張なし').trim();

  const bioProfile = `【${themeName}】をテーマに、実践ログ・知見・最新トレンドを毎日発信する専門アカウント（対象：${targetAudience} / トーン：${toneStyle}）⚡`;
  const contentPillars = `①${themeName}のリアルな実践・開発ログ ②失敗から学んだ知見・比較データ ③読者がすぐ試せるリンク・ハンズオン紹介`;

  const res = await c.env.DB.prepare(`
    INSERT INTO theme_personas (theme_name, account_handle, email_address, email_domain, target_audience, tone_style, bio_profile, content_pillars, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `)
    .bind(themeName, handle, emailAddress, domain, targetAudience, toneStyle, bioProfile, contentPillars)
    .run();

  const newId = res.meta.last_row_id;

  // Optionally create an initial welcome/verification readiness log in inbound_emails if requested
  if (body.simulate_welcome_otp) {
    const sampleOtp = String(Math.floor(100000 + Math.random() * 900000));
    await c.env.DB.prepare(`
      INSERT INTO inbound_emails (recipient_email, sender_email, subject, raw_body, extracted_otp, verification_url)
      VALUES (?, 'verify@sns-platform.example', ?, ?, ?, ?)
    `)
      .bind(
        emailAddress,
        `Confirmation code: ${sampleOtp}`,
        `Your verification code for ${handle} (${emailAddress}) is ${sampleOtp}. Confirm at https://sns.example.com/verify?code=${sampleOtp}`,
        sampleOtp,
        `https://sns.example.com/verify?code=${sampleOtp}`
      )
      .run();
  }

  const created = await c.env.DB.prepare('SELECT * FROM theme_personas WHERE id = ?').bind(newId).first();
  return c.json({ status: 'provisioned', persona: created }, 201);
});

// 3. Inbound Email Webhook / Email Worker Ingestion (Auto-extracts 6-digit OTP & Verification Link)
app.post('/api/mailboxes/inbound', async (c) => {
  const body = await c.req.json();
  const recipient = (body.recipient_email || '').trim();
  const sender = (body.sender_email || 'noreply@platform.com').trim();
  const subject = (body.subject || '').trim();
  const rawBody = (body.raw_body || '').trim();

  if (!recipient || (!subject && !rawBody)) {
    return c.json({ error: 'recipient_email and subject/raw_body are required' }, 400);
  }

  const { otp, url } = extractOtpAndUrl(subject, rawBody);

  const res = await c.env.DB.prepare(`
    INSERT INTO inbound_emails (recipient_email, sender_email, subject, raw_body, extracted_otp, verification_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
    .bind(recipient, sender, subject, rawBody, otp, url)
    .run();

  const saved = await c.env.DB.prepare('SELECT * FROM inbound_emails WHERE id = ?').bind(res.meta.last_row_id).first();
  return c.json({ status: 'received', email: saved }, 201);
});

// 4. Multi-SNS Post Generator + Shadowban & Algorithm Auditor
app.post('/api/posts/generate', async (c) => {
  const body = await c.req.json();
  const personaId = Number(body.persona_id || 1);
  const sourceTopic = (body.source_topic || '').trim();
  const targetUrl = (body.target_url || '').trim();

  if (!sourceTopic) {
    return c.json({ error: 'source_topic is required' }, 400);
  }

  const persona: any = await c.env.DB.prepare('SELECT * FROM theme_personas WHERE id = ?').bind(personaId).first();
  const themeLabel = persona ? persona.theme_name : 'AI×個人開発';

  // Check for spam/shadowban trigger words or excessive hashtags
  const spamRegex = /絶対儲かる|100%稼げる|相互フォロー100|無料配布企画|裏技暴露|DMください/;
  const hasSpamTrigger = spamRegex.test(sourceTopic);
  const rawHashtags = (sourceTopic.match(/#[^\s#]+/g) || []);
  const tooManyHashtags = rawHashtags.length >= 4;

  let algorithmScore = 96;
  let shadowbanStatus = 'SAFE（シャドウバンリスク極小）';
  const auditNotes: string[] = [];

  if (hasSpamTrigger) {
    algorithmScore -= 45;
    shadowbanStatus = 'WARNING（スパム・凍結リスク検知）';
    auditNotes.push('🚨 危険：SNSスパムフィルタに引っかかる煽り・誘導ワードを検知しました');
  } else {
    auditNotes.push('✅ 煽り・スパム規約違反ワードなし');
  }

  if (tooManyHashtags) {
    algorithmScore -= 20;
    shadowbanStatus = 'CAUTION（ハッシュタグ過多によるリーチ減衰）';
    auditNotes.push(`⚠️ ハッシュタグが${rawHashtags.length}個含まれています（2個以内に自動圧縮推奨）`);
  } else {
    auditNotes.push('✅ ハッシュタグ数を最適値（2個）に自動制御');
  }

  // Construct X Main Post (never put raw external URL in X main post to avoid 50-80% reach penalty)
  const cleanTopic = sourceTopic.replace(/#[^\s#]+/g, '').trim();
  const xMainPost = `【${themeLabel}】\n${cleanTopic}\n\n実際に動かしてみて分かったポイントと詳細はリプライ欄にまとめました👇\n\n#個人開発 #AI活用`;

  let xReplyComment = '（外部リンクなし・単体投稿）';
  if (targetUrl) {
    xReplyComment = `🔗 詳細リンク・実際に試せるページはこちら：\n${targetUrl}`;
    auditNotes.push('✅ 外部URLをリプライ欄へ自動分離済み（X本投稿の外部リンク減衰ペナルティを回避）');
  }

  const blueskyThreadsPost = `${cleanTopic}\n\n（テーマ：${themeLabel}）${targetUrl ? `\n👉 ${targetUrl}` : ''}`;

  const slots = ['本日 20:30（夜ゴールデンタイム枠）', '明日 07:30（朝通勤リーダー枠）', '明日 12:15（昼休みピーク枠）'];
  const scheduledSlot = body.scheduled_slot || slots[Math.floor(Math.random() * slots.length)];

  const res = await c.env.DB.prepare(`
    INSERT INTO sns_posts (
      persona_id, source_topic, target_url, x_main_post, x_reply_comment,
      bluesky_threads_post, algorithm_score, shadowban_status, audit_notes, scheduled_slot, publish_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      personaId,
      sourceTopic,
      targetUrl || null,
      xMainPost,
      xReplyComment,
      blueskyThreadsPost,
      algorithmScore,
      shadowbanStatus,
      auditNotes.join(' / '),
      scheduledSlot,
      hasSpamTrigger ? 'flagged_hold' : 'queued'
    )
    .run();

  const saved = await c.env.DB.prepare('SELECT * FROM sns_posts WHERE id = ?').bind(res.meta.last_row_id).first();
  return c.json({ status: 'generated', post: saved }, 201);
});

// 5. Web UI Dashboard
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Social Harness — テーマ別メール自動発行＆AI自律SNS運用エンジン</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen font-sans">
  <header class="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-10">
    <div class="max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
      <div>
        <div class="flex items-center gap-2">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">Cloudflare Email Workers + D1 + MCP</span>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">Shadowban Guardrail</span>
        </div>
        <h1 class="text-2xl font-extrabold tracking-tight mt-1 bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
          Social Harness — テーマ別メール自動生成 ＆ AI自律SNS運用エンジン
        </h1>
      </div>
      <div class="text-xs text-slate-400">
        Buffer / SocialDog / 捨てアド管理ツールを月額0円で統合代替
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-8 space-y-8">
    <!-- KPIs -->
    <section class="grid grid-cols-2 md:grid-cols-5 gap-4" id="kpi-grid">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-xs text-slate-400">稼働テーマ＆ペルソナ数</div>
        <div class="text-2xl font-bold text-purple-400 mt-1" id="kpi-personas">-</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-xs text-slate-400">自動発行メールアドレス数</div>
        <div class="text-2xl font-bold text-cyan-400 mt-1" id="kpi-mailboxes">-</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-xs text-slate-400">自動抽出OTP認証コード</div>
        <div class="text-2xl font-bold text-emerald-400 mt-1" id="kpi-otp">-</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-xs text-slate-400">マルチSNS予約キュー</div>
        <div class="text-2xl font-bold text-pink-400 mt-1" id="kpi-posts">-</div>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div class="text-xs text-slate-400">平均アルゴリズム安全度</div>
        <div class="text-2xl font-bold text-amber-400 mt-1" id="kpi-score">-</div>
      </div>
    </section>

    <!-- Action Grid -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Form 1: Auto-Email + Persona -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h2 class="text-lg font-bold text-purple-300 flex items-center gap-2">
          <span>① テーマ別メール自動発行＆ペルソナ設計</span>
        </h2>
        <p class="text-xs text-slate-400">
          テーマを入れるだけで、Cloudflare Email Routing用の専用メールアドレス（<code class="text-cyan-300">*@mail.harness-ops.dev</code>）とSNSプロフィール・発信軸を0秒で構築します。
        </p>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-300 block mb-1">運用テーマ名</label>
            <input id="theme_name" type="text" placeholder="例：インディーゲーム『10秒ラスボス』開発日誌" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-xs text-slate-300 block mb-1">アドレス接頭辞（英語）</label>
              <input id="slug_hint" type="text" placeholder="例：indie-boss" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label class="text-xs text-slate-300 block mb-1">ターゲット読者</label>
              <input id="target_audience" type="text" placeholder="例：カジュアルゲーム好き" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <label class="flex items-center gap-2 text-xs text-slate-300">
            <input id="simulate_welcome_otp" type="checkbox" checked class="rounded" />
            SNS登録用の初回OTP認証メール受信も同時にシミュレートする
          </label>
          <button onclick="createPersona()" class="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-2.5 rounded-lg text-sm transition">
            専用メールアドレスを発行してペルソナ作成
          </button>
        </div>
      </div>

      <!-- Form 2: Multi-SNS Post Generator -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h2 class="text-lg font-bold text-pink-300 flex items-center gap-2">
          <span>② マルチSNS投稿生成＆シャドウバン監査</span>
        </h2>
        <p class="text-xs text-slate-400">
          1つのネタから「X本投稿（URL分離でリーチ最大化）＋Xリプライ欄＋Bluesky/Threads文面」を一括生成し、スパム判定リスクを監査します。
        </p>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-300 block mb-1">発信ペルソナ選択</label>
            <select id="post_persona_id" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"></select>
          </div>
          <div>
            <label class="text-xs text-slate-300 block mb-1">投稿ネタ・伝えたい内容</label>
            <textarea id="source_topic" rows="3" placeholder="例：自分で作った10秒の攻撃を自分で避けきらないと公開できないゲームを作ったら、テストプレイで自分が一番苦しんでいます" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm"></textarea>
          </div>
          <div>
            <label class="text-xs text-slate-300 block mb-1">誘導したいURL（自動でリプライ欄へ分離されます）</label>
            <input id="target_url" type="text" placeholder="https://ten-second-boss.reina20xx.workers.dev/" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <button onclick="generatePost()" class="w-full bg-pink-600 hover:bg-pink-500 text-white font-bold py-2.5 rounded-lg text-sm transition">
            マルチSNS投稿を生成＆アルゴリズム監査
          </button>
        </div>
      </div>

      <!-- Form 3: OTP Email Extractor -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
        <h2 class="text-lg font-bold text-cyan-300 flex items-center gap-2">
          <span>③ 認証メール受信＆6桁OTP自動抽出</span>
        </h2>
        <p class="text-xs text-slate-400">
          発行したテーマ別メールアドレス宛に届いたSNS確認メールから、6桁の認証コード（OTP）と確認リンクを正規表現で即時抽出します。
        </p>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-slate-300 block mb-1">宛先メールアドレス</label>
            <input id="inbound_recipient" type="text" value="gamedev-10sec-a8f2@mail.harness-ops.dev" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="text-xs text-slate-300 block mb-1">件名（Subject）</label>
            <input id="inbound_subject" type="text" value="Your confirmation code is 739104" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label class="text-xs text-slate-300 block mb-1">本文（Raw Body）</label>
            <textarea id="inbound_body" rows="2" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm">Enter code 739104 or click https://x.com/verify?token=abc739104 to activate your account.</textarea>
          </div>
          <button onclick="simulateInboundEmail()" class="w-full bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-2.5 rounded-lg text-sm transition">
            認証メール受信＆OTPコードを自動抽出
          </button>
        </div>
      </div>
    </section>

    <!-- Personas & Mailboxes List -->
    <section class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h2 class="text-lg font-bold text-slate-100">📬 テーマ別メールアドレス ＆ ペルソナ台帳</h2>
      <div id="personas-list" class="grid grid-cols-1 md:grid-cols-2 gap-4"></div>
    </section>

    <!-- Inbound OTP Box -->
    <section class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h2 class="text-lg font-bold text-slate-100">🔐 自動抽出されたSNS認証コード（OTP Inbox）</h2>
      <div id="emails-list" class="space-y-3"></div>
    </section>

    <!-- Generated Multi-SNS Posts -->
    <section class="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
      <h2 class="text-lg font-bold text-slate-100">🚀 マルチSNS配信キュー（Xスレッド分離 ／ Bluesky ／ Threads）</h2>
      <div id="posts-list" class="space-y-4"></div>
    </section>
  </main>

  <script>
    async function loadDashboard() {
      const res = await fetch('/api/dashboard');
      const data = await res.json();

      document.getElementById('kpi-personas').textContent = data.kpis.total_personas;
      document.getElementById('kpi-mailboxes').textContent = data.kpis.active_mailboxes;
      document.getElementById('kpi-otp').textContent = data.kpis.otp_extracted_count;
      document.getElementById('kpi-posts').textContent = data.kpis.queued_posts_count;
      document.getElementById('kpi-score').textContent = data.kpis.avg_algorithm_score + ' / 100';

      const select = document.getElementById('post_persona_id');
      select.innerHTML = data.personas.map(p => \`<option value="\${p.id}">\${p.theme_name} (\${p.account_handle})</option>\`).join('');

      document.getElementById('personas-list').innerHTML = data.personas.map(p => \`
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-purple-300">\${p.theme_name}</span>
            <span class="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">\${p.account_handle}</span>
          </div>
          <div class="text-xs font-mono bg-slate-900 border border-slate-800 px-3 py-1.5 rounded text-cyan-300">
            📧 専用メール: \${p.email_address}
          </div>
          <p class="text-xs text-slate-300">\${p.bio_profile}</p>
          <p class="text-xs text-slate-400">📌 発信の柱: \${p.content_pillars}</p>
        </div>
      \`).join('');

      document.getElementById('emails-list').innerHTML = data.emails.map(e => \`
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-xs text-slate-400">To: <span class="text-cyan-300 font-mono">\${e.recipient_email}</span> | From: \${e.sender_email}</div>
            <div class="text-sm font-semibold text-slate-200 mt-0.5">\${e.subject}</div>
          </div>
          <div class="flex items-center gap-3">
            \${e.extracted_otp ? \`<span class="px-3 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-sm">OTP: \${e.extracted_otp}</span>\` : ''}
            \${e.verification_url ? \`<a href="\${e.verification_url}" target="_blank" class="text-xs text-cyan-400 underline">確認URL</a>\` : ''}
          </div>
        </div>
      \`).join('');

      document.getElementById('posts-list').innerHTML = data.posts.map(post => \`
        <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="text-xs font-bold text-purple-300">\${post.theme_name || ''} (\${post.account_handle || ''})</span>
              <span class="text-xs text-slate-400 ml-2">⏰ \${post.scheduled_slot}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded text-xs font-bold bg-amber-500/20 text-amber-300">Reach Score: \${post.algorithm_score}/100</span>
              <span class="px-2.5 py-0.5 rounded text-xs font-bold bg-emerald-500/20 text-emerald-300">\${post.shadowban_status}</span>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div class="bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div class="font-bold text-sky-400 mb-1">𝕏 メイン投稿（URL分離済み）</div>
              <pre class="whitespace-pre-wrap font-sans text-slate-200">\${post.x_main_post}</pre>
            </div>
            <div class="bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div class="font-bold text-indigo-400 mb-1">𝕏 セルフリプライ欄（URL誘導）</div>
              <pre class="whitespace-pre-wrap font-sans text-slate-200">\${post.x_reply_comment}</pre>
            </div>
            <div class="bg-slate-900 p-3 rounded-lg border border-slate-800">
              <div class="font-bold text-teal-400 mb-1">🦋 Bluesky / Threads 投稿</div>
              <pre class="whitespace-pre-wrap font-sans text-slate-200">\${post.bluesky_threads_post}</pre>
            </div>
          </div>
          <div class="text-xs text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded">
            🛡️ アルゴリズム監査ログ: \${post.audit_notes}
          </div>
        </div>
      \`).join('');
    }

    async function createPersona() {
      const theme_name = document.getElementById('theme_name').value;
      const slug_hint = document.getElementById('slug_hint').value;
      const target_audience = document.getElementById('target_audience').value;
      const simulate_welcome_otp = document.getElementById('simulate_welcome_otp').checked;
      if (!theme_name) return alert('運用テーマ名を入力してください');
      await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_name, slug_hint, target_audience, simulate_welcome_otp })
      });
      document.getElementById('theme_name').value = '';
      await loadDashboard();
    }

    async function generatePost() {
      const persona_id = document.getElementById('post_persona_id').value;
      const source_topic = document.getElementById('source_topic').value;
      const target_url = document.getElementById('target_url').value;
      if (!source_topic) return alert('投稿ネタを入力してください');
      await fetch('/api/posts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona_id, source_topic, target_url })
      });
      document.getElementById('source_topic').value = '';
      await loadDashboard();
    }

    async function simulateInboundEmail() {
      const recipient_email = document.getElementById('inbound_recipient').value;
      const subject = document.getElementById('inbound_subject').value;
      const raw_body = document.getElementById('inbound_body').value;
      await fetch('/api/mailboxes/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient_email, sender_email: 'verify@x.com', subject, raw_body })
      });
      await loadDashboard();
    }

    loadDashboard();
  </script>
</body>
</html>`);
});

// Export both HTTP fetch handler and Cloudflare Email Worker handler
export default {
  fetch: app.fetch,
  async email(message: any, env: Bindings, ctx: ExecutionContext) {
    const recipient = message.to || 'unknown@mail.harness-ops.dev';
    const sender = message.from || 'unknown@sender.com';
    const subject = (message.headers && message.headers.get ? message.headers.get('subject') : '') || 'Incoming Verification Email';
    const rawText = await new Response(message.raw).text();
    const { otp, url } = extractOtpAndUrl(subject, rawText);

    await env.DB.prepare(`
      INSERT INTO inbound_emails (recipient_email, sender_email, subject, raw_body, extracted_otp, verification_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .bind(recipient, sender, subject, rawText.slice(0, 2000), otp, url)
      .run();
  },
};
