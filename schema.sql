DROP TABLE IF EXISTS sns_posts;
DROP TABLE IF EXISTS inbound_emails;
DROP TABLE IF EXISTS theme_personas;

CREATE TABLE theme_personas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_name TEXT NOT NULL,
  account_handle TEXT NOT NULL,
  email_address TEXT NOT NULL UNIQUE,
  email_domain TEXT NOT NULL,
  target_audience TEXT NOT NULL,
  tone_style TEXT NOT NULL,
  bio_profile TEXT NOT NULL,
  content_pillars TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE inbound_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_email TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  raw_body TEXT NOT NULL,
  extracted_otp TEXT,
  verification_url TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sns_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id INTEGER NOT NULL,
  source_topic TEXT NOT NULL,
  target_url TEXT,
  x_main_post TEXT NOT NULL,
  x_reply_comment TEXT,
  bluesky_threads_post TEXT NOT NULL,
  algorithm_score INTEGER NOT NULL,
  shadowban_status TEXT NOT NULL,
  audit_notes TEXT NOT NULL,
  scheduled_slot TEXT NOT NULL,
  publish_status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (persona_id) REFERENCES theme_personas(id)
);

INSERT INTO theme_personas (theme_name, account_handle, email_address, email_domain, target_audience, tone_style, bio_profile, content_pillars, status)
VALUES
  (
    '個人開発ブラウザゲーム＆裏話ラボ',
    '@10sec_boss_lab',
    'gamedev-10sec-a8f2@mail.harness-ops.dev',
    'mail.harness-ops.dev',
    'インディーゲーム好き・友達と対戦したいプレイヤー・個人開発者',
    '親しみやすい・体験ベース・誇張なし',
    '10秒間の攻撃を録画して、自分でクリアできた弾幕だけを友達に送りつけるブラウザゲーム『10秒だけ、ラスボス』を開発中🎮 制作の裏側と挑戦状を毎日発信します。',
    '①自作ボスの攻略クリップ ②自分が苦しめられたテストプレイ体験談 ③個人開発のUI改善ログ',
    'active'
  ),
  (
    'SaaS is Dead / AI業務ハック研究所',
    '@saas_reborn_ai',
    'saas-reborn-c4d9@mail.harness-ops.dev',
    'mail.harness-ops.dev',
    'スタートアップ経営者・情シス・営業/CS責任者・AIエンジニア',
    '論理的・データ重視・実践的OSS紹介',
    '高額なシート課金SaaSをCloudflare Workers + D1 + MCP（月額0円）の自律AIハーネスで作り直す実験ラボ。Salesforce / Zendesk / 経費SaaSの代替OSSを公開中⚡',
    '①従来SaaSのコスト構造解剖 ②Cloudflare D1×MCP実装レシピ ③業務AI化のROI試算',
    'active'
  );

INSERT INTO inbound_emails (recipient_email, sender_email, subject, raw_body, extracted_otp, verification_url)
VALUES
  (
    'gamedev-10sec-a8f2@mail.harness-ops.dev',
    'verify@x.com',
    'Your X confirmation code is 849201',
    'Please enter the following verification code to complete your account setup: 849201. Or verify via https://x.com/account/confirm_email?token=demo849201',
    '849201',
    'https://x.com/account/confirm_email?token=demo849201'
  ),
  (
    'saas-reborn-c4d9@mail.harness-ops.dev',
    'noreply@bsky.social',
    'Bluesky Email Verification - Code: 391047',
    'Welcome to Bluesky! Your 6-digit verification code is 391047. Click here to confirm: https://bsky.app/verify?code=391047',
    '391047',
    'https://bsky.app/verify?code=391047'
  );

INSERT INTO sns_posts (persona_id, source_topic, target_url, x_main_post, x_reply_comment, bluesky_threads_post, algorithm_score, shadowban_status, audit_notes, scheduled_slot, publish_status)
VALUES
  (
    1,
    '自分で作った10秒の攻撃を、自分で避けきらないと友達に送れないゲーム「10秒だけ、ラスボス」を公開',
    'https://ten-second-boss.reina20xx.workers.dev/',
    '「絶対に避けられない最強の弾幕を作ろう！」と思って10秒間の攻撃を録画した直後、公開条件が「まず制作者自身がノーミス（ライフ3）で避けきること」なので毎回自分の首を絞めています。\n\n突破できたボスだけ友達に挑戦状URLを送れるブラウザゲームを作りました🎮\n\n#個人開発 #インディーゲーム',
    '👇登録不要・ブラウザですぐ遊べます（PC・スマホ対応）\nhttps://ten-second-boss.reina20xx.workers.dev/\n\n詳細な遊び方と制作ノートはこちら：\nhttps://note.com/light_quoll2409/n/n375f666baccf',
    '自分で10秒間の攻撃パターンを録画して、自分自身がライフ3で突破できたステージだけを友達に「挑戦状」として送りつけられるブラウザゲーム『10秒だけ、ラスボス』を公開しました！\n欲張って攻撃を詰め込むと自分がクリアできなくなるジレンマが楽しいです。\nhttps://ten-second-boss.reina20xx.workers.dev/',
    96,
    'SAFE（シャドウバンリスク極小）',
    '✅ 外部URLをリプライ欄へ分離済み（Xメイン投稿のリーチ減衰を回避） / ✅ ハッシュタグ2個以内（スパム判定回避） / ✅ 煽り・規約違反ワードなし',
    '本日 20:30（ゴールデンタイム枠）',
    'queued'
  ),
  (
    2,
    '月額3万円/人のSalesforceを代替する「CRM Harness」をOSS公開',
    'https://github.com/reina20xx/crm-harness',
    '営業マンが毎日90分かけて30項目のSFAフォームを手入力する時代はもう終わりにしませんか？\n\n商談の殴り書きメモを貼るだけで、AIが0秒で「MEDDIC」へ構造化し、決裁者不在の失注リスク検知からお礼メール作成まで全自動化するOSS『CRM Harness』を公開しました⚡\n\n#SaaSisDead #AIエージェント',
    '👇GitHubリポジトリ（MITライセンス・Cloudflare D1で月額0円稼働）\nhttps://github.com/reina20xx/crm-harness\n\n解説noteはこちら：\nhttps://note.com/light_quoll2409/n/n48b012da85d7',
    '「SaaS is Dead」の象徴である営業SFAの手入力負荷と高額シート課金をゼロにするため、Cloudflare Workers + D1 + MCPで動く『CRM Harness』をOSS公開しました。商談メモを貼るだけでMEDDIC解析と加重ヨミ集計が0秒で終わります。\nhttps://github.com/reina20xx/crm-harness',
    95,
    'SAFE（シャドウバンリスク極小）',
    '✅ 外部URLをリプライ欄へ分離済み / ✅ ハッシュタグ2個（最適値） / ✅ 独自性スコア良好',
    '明日 07:30（朝の通勤リーダー枠）',
    'queued'
  );
