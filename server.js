const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const OPENAI_KEY = process.env.OPENAI_KEY || '';

// ── 인스타그램 계정 + 제품 웹 검색 ──────────────────────────
async function searchWeb(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const data = await resp.json();

  let results = '';
  if (data.AbstractText) results += data.AbstractText + '\n';
  if (data.RelatedTopics) {
    data.RelatedTopics.slice(0, 5).forEach(t => {
      if (t.Text) results += t.Text + '\n';
    });
  }
  return results.trim();
}

// ── 메인 API ─────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { username, brandName, productName, dmType, senderName } = req.body;

  if (!username || !brandName || !productName) {
    return res.status(400).json({ error: '필수 정보가 없어요' });
  }

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // ── 1단계: 인스타그램 계정 검색 ──
    sendEvent({ step: '🔍 인스타그램 계정 분석 중...' });
    const instaInfo = await searchWeb(`instagram ${username} 인플루언서 최근 콘텐츠 게시물`);

    // ── 2단계: 제품 정보 검색 ──
    sendEvent({ step: '📦 제품 정보 검색 중...' });
    const productInfo = await searchWeb(`${brandName} ${productName} 특징 성분 효능 후기`);

    // ── 3단계: AI DM 생성 ──
    sendEvent({ step: '✍️ DM 작성 중...' });

    const prompt = `아래 정보를 바탕으로 인스타그램 협업 제안 DM을 작성해줘. 반드시 한국어만.

[인플루언서]
인스타그램 아이디: @${username}
검색으로 파악한 정보: ${instaInfo || '정보 없음'}

[제품/브랜드]
브랜드: ${brandName}
제품명: ${productName}
검색으로 파악한 제품 정보: ${productInfo || '정보 없음'}
제안 유형: ${dmType || '공동구매'}

아래 형식으로 출력:
연락이유: (인플루언서 콘텐츠와 제품 연결, 왜 맞는지 한 문장, 40자 이내, 이름 없이)
포인트목록:
• (제품 핵심 특징 20자 이내)
• (제품 핵심 특징 20자 이내)
• (제품 핵심 특징 20자 이내)
• (이 인플루언서 팔로워에게 왜 맞는지)
• (공동구매/협업 기회)

규칙: 한국어만. 이름 포함 금지. 형식만 출력.`;

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '당신은 한국어 전용 인플루언서 마케팅 담당자입니다. 반드시 한국어(한글)만 씁니다.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.7,
        stream: true
      })
    });

    let aiText = '';
    const reader = aiResp.body;
    let buffer = '';

    for await (const chunk of reader) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const token = json.choices?.[0]?.delta?.content || '';
          aiText += token;
          sendEvent({ token });
        } catch {}
      }
    }

    // ── 파싱 후 DM 조립 ──
    const reasonM  = aiText.match(/연락이유:\s*([\s\S]*?)(?=포인트목록:|$)/);
    const bulletsM = aiText.match(/포인트목록:\s*([\s\S]*)/);
    const reason  = reasonM  ? reasonM[1].trim()  : '';
    const bullets = bulletsM ? bulletsM[1].trim() : aiText;

    const nameLabel = username;
    const sender = senderName ? `${brandName} ${senderName}` : brandName;
    const reasonLine = reason
      ? `${reason} @${username}님께 소개하고 싶어`
      : `@${username}님의 피드를 보고 잘 맞으실 것 같아`;

    const dm = `안녕하세요. @${username}님

${sender}입니다.

${reasonLine}
조심스럽게 연락드리게 되었습니다.

이번에 소개드리고 싶은 상품은
${brandName} / ${productName} 입니다.


핵심 point
${bullets}


혹시 제품에 관심 있으시면
편하게 답장 주세요 :)
간단히 관심 있다고만 말씀 주셔도 괜찮습니다.
원하시면 제안서와 함께 자세히 안내드리겠습니다.

오늘도 좋은 하루 보내세요!
감사합니다.`;

    sendEvent({ done: true, dm });
    res.end();

  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
