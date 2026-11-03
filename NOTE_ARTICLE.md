# 【完全無料・OSS】テーマを決めるだけで「専用メールアドレス自動発行＋認証OTP取得」から「シャドウバン回避のマルチSNS運用」まで全自動化する『Social Harness』を公開しました

個人開発のゲームやWebサービス、あるいは専門テーマの情報発信アカウントを複数運用しようとしたとき、最初にぶつかる壁が **「テーマごとのメールアドレス管理の煩雑さ」** と **「毎日のSNS投稿作成＆シャドウバン（リーチ激減）対策の負荷」** です。

現場ではよく、こんな悩みが発生します。

- **「テーマ別にSNSアカウントを作りたいが、毎回メールアドレスを用意して認証コード（OTP）を確認するのが面倒」**
- **「X（旧Twitter）の投稿本文にゲームやnoteのURLを直接貼ったら、アルゴリズムの外部リンク減衰ペナルティを受けてインプレッションが1/5に激減した」**
- **「BufferやSocialDogなどのSNS予約配信・分析SaaSを複数アカウント分契約すると、それだけで毎月数千〜数万円の固定費が消える」**

この課題をまるごと解決するため、Cloudflare Email Routing（Email Workers）＋ Cloudflare D1（月額0円）を活用し、**「テーマ別メールアドレスの0秒自動発行＆6桁OTPコード自動抽出」** から **「Xスレッド分離・Bluesky・Threads対応のAI自律SNS運用＆シャドウバン監査」** までを1つに統合したオープンソース **『Social Harness』** をMITライセンスで公開しました！

🔗 **GitHubリポジトリ**: https://github.com/reina20xx/social-harness

---

## Social Harness の5大コア機能

### 1. テーマ別メールアドレスの0秒自動生成 ＆ 認証コード（6桁OTP）自動抽出
Cloudflare Email RoutingのCatch-All機能（`*@your-domain.com` ➔ Email Worker直結）と連動し、運用テーマ（例：`インディーゲーム開発ラボ`、`SaaSコスト削減研究所`）を入力するだけで専用メールアドレス（例：`pixel-action-8f2a@mail.harness-ops.dev`）を即座に発行します。

さらに、各SNSから届く確認メールをCloudflare Email Workerが直接受信し、**本文中の6桁の認証コード（OTP）と確認URLを正規表現で自動抽出してダッシュボードおよびMCPへ即座に表示**します。メールソフトをわざわざ開く必要すらありません。

```typescript
export function extractOtpAndUrl(subject: string, body: string) {
  const combined = `${subject}\n${body}`;
  const otpMatch = combined.match(/\b(\d{6})\b/);
  const urlMatch = combined.match(/https?:\/\/[^\s"'<>]+/);
  return {
    otp: otpMatch ? otpMatch[1] : null,
    url: urlMatch ? urlMatch[0] : null,
  };
}
```

> **💡 重要：なぜ「SNSアカウント自体の無人Bot量産」ではなく「メール自動発行＋中身100%自動化」なのか？**
> 現在の主要SNS（X等）はSMS認証や高度なCAPTCHAが必須であり、アカウント登録作業そのものをBotで無理やり突破しようとすると即座に永久凍結・シャドウバンされます。
> Social Harnessは **「専用メール発行とOTP取得を0秒化して初回の箱作りを最速化し、その後の『日々の企画・投稿生成・アルゴリズム監査・配信キュー管理』を100% AIで自走させる」** という、凍結リスクゼロで最も実用的な設計を採用しています。

### 2. 「Xの外部リンク減衰ペナルティ」を自動回避するセルフリプライ分離生成
現在のX（旧Twitter）のアルゴリズムでは、メイン投稿の本文に外部URL（自分のゲームやnoteへのリンク）を入れると、露骨にインプレッションが制限されます。
Social Harnessに「伝えたいネタ」と「誘導したいURL」を渡すと、AIが自動的に以下の3つへ分解・整形します。

- **𝕏 メイン投稿**: 外部URLを含めず、読者の足を止めるフックと本編テキスト＋最適なハッシュタグ2個のみで構成（リーチ最大化）
- **𝕏 セルフリプライ欄**: 1ツリー目のリプライとして、ゲームやnoteへの誘導URLを自動配置
- **🦋 Bluesky / Threads 投稿**: 各SNSのカルチャーに合わせた会話調フォーマット

### 3. シャドウバン＆スパム判定を未然に防ぐ「Algorithm & Safety Auditor」
AIにSNS運用を任せる際に一番怖い「スパム判定」を防ぐため、投稿キューに入る前に自動で安全度スコア（0〜100点）を監査します。
- ハッシュタグの付けすぎ（3個以上はスパム判定リスクが高まるため自動で2個以内に制御）
- 凍結・シャドウバントリガーとなる過激な煽りワード・誘導ワードの検知と自動保留ロック（`flagged_hold`）

### 4. テーマ＆ペルソナ設計スタジオ（Persona Studio）
「どんなテーマで誰に向けて発信するか」を入力するだけで、アカウントのプロフィール文（Bio）、トーン＆マナー、ブレない「3つの発信の柱（Content Pillars）」をD1データベース上に自動設計します。

### 5. Claude Code / Cursor から直接動かせる「MCP Server」標準搭載
UIを開かなくても、普段使っているAIエディタから自然言語で全機能を操作できます。
- 「『レトロ風ドット絵＆10秒アクション開発室』というテーマで専用メールとペルソナを作って」➔ `provision_theme_mailbox_and_persona`
- 「さっき発行したメールアドレスに届いた6桁の認証コード（OTP）を教えて」➔ `fetch_latest_verification_code`
- 「『10秒だけ、ラスボス』のテストプレイ裏話をネタに、XスレッドとBluesky投稿を作って予約キューに入れて」➔ `generate_and_audit_sns_campaign`

---

## 5分で試せるクイックスタート

```bash
git clone https://github.com/reina20xx/social-harness.git
cd social-harness
npm install
npm run db:init
npm run dev
```

ブラウザで `http://localhost:8804` を開くと、テーマ別メール自動発行、6桁OTPコードの自動抽出、そしてシャドウバン回避機能付きのマルチSNS投稿生成をすぐに体験できます。

🔗 **GitHub**: https://github.com/reina20xx/social-harness
（ぜひ Star ⭐ をいただけると開発の励みになります！）
