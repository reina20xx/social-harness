const assert = require('assert');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8804';

async function runTests() {
  console.log('=== Running Social Harness E2E Tests ===');

  // 1. Check initial dashboard & seed data
  const dashRes = await fetch(`${BASE_URL}/api/dashboard`);
  assert.strictEqual(dashRes.status, 200, 'Dashboard API should return 200');
  const dash = await dashRes.json();
  assert.ok(dash.kpis.total_personas >= 2, 'Should have at least 2 seeded theme personas');
  assert.ok(dash.kpis.otp_extracted_count >= 2, 'Should have extracted OTP codes from seed emails');
  console.log('1. Seed dashboard verified:', dash.kpis);

  // 2. Auto-provision a new theme email address + AI persona
  const createPersonaRes = await fetch(`${BASE_URL}/api/personas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      theme_name: 'レトロ風ドット絵＆10秒アクション開発室',
      slug_hint: 'pixel-action',
      target_audience: 'インディーゲーム好き・ドット絵ファン',
      tone_style: '親しみやすい開発日記トーン',
      simulate_welcome_otp: true
    })
  });
  assert.strictEqual(createPersonaRes.status, 201, 'Persona creation should return 201');
  const createdPersona = await createPersonaRes.json();
  assert.ok(createdPersona.persona.email_address.startsWith('pixel-action-'), 'Email address should start with slug prefix');
  assert.ok(createdPersona.persona.email_address.endsWith('@mail.harness-ops.dev'), 'Email address should use harness domain');
  console.log('2. Auto-provisioned Theme Email & Persona:', createdPersona.persona.email_address, createdPersona.persona.account_handle);

  // 3. Test Inbound Email Webhook & 6-digit OTP extraction
  const inboundRes = await fetch(`${BASE_URL}/api/mailboxes/inbound`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_email: createdPersona.persona.email_address,
      sender_email: 'verify@x.com',
      subject: 'Your X verification code is 582910',
      raw_body: 'Enter 582910 to verify your new theme account or visit https://x.com/verify?code=582910'
    })
  });
  assert.strictEqual(inboundRes.status, 201, 'Inbound email webhook should return 201');
  const inboundData = await inboundRes.json();
  assert.strictEqual(inboundData.email.extracted_otp, '582910', 'Should extract 6-digit OTP 582910');
  assert.strictEqual(inboundData.email.verification_url, 'https://x.com/verify?code=582910', 'Should extract verification URL');
  console.log('3. Inbound Email OTP & URL extraction verified:', inboundData.email.extracted_otp);

  // 4. Test Multi-SNS Post Generation & URL-to-Reply Separation (Shadowban Safe)
  const postRes = await fetch(`${BASE_URL}/api/posts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_id: createdPersona.persona.id,
      source_topic: '10秒間の攻撃パターンを自分で避けきらないと公開できない仕組みにしたら、開発者自身がクリアできずに30分ハマりました',
      target_url: 'https://ten-second-boss.reina20xx.workers.dev/'
    })
  });
  assert.strictEqual(postRes.status, 201, 'Post generation should return 201');
  const postData = await postRes.json();
  assert.ok(!postData.post.x_main_post.includes('https://'), 'X main post must NOT contain external URL to avoid reach penalty');
  assert.ok(postData.post.x_reply_comment.includes('https://ten-second-boss.reina20xx.workers.dev/'), 'X reply must contain the target URL');
  assert.ok(postData.post.algorithm_score >= 90, 'Algorithm score should be >= 90 for clean post');
  console.log('4. Multi-SNS Post + Reply URL Separation verified! Score:', postData.post.algorithm_score);

  // 5. Test Spam/Shadowban Trigger Detection
  const spamRes = await fetch(`${BASE_URL}/api/posts/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      persona_id: createdPersona.persona.id,
      source_topic: '絶対儲かる裏技暴露！相互フォロー100で無料配布企画やります #副業 #稼げる #相互フォロー #プレゼント #裏技'
    })
  });
  assert.strictEqual(spamRes.status, 201);
  const spamData = await spamRes.json();
  assert.strictEqual(spamData.post.publish_status, 'flagged_hold', 'Spammy post must be held from auto-publishing');
  assert.ok(spamData.post.algorithm_score < 60, 'Spammy post must receive low algorithm safety score');
  console.log('5. Shadowban & Spam Guardrail verified! Status:', spamData.post.publish_status, 'Score:', spamData.post.algorithm_score);

  console.log('✅ Social Harness E2E tests passed!');
}

runTests().catch((err) => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
