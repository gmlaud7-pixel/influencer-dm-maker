const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const OPENAI_KEY = process.env.OPENAI_KEY || '';

app.post('/api/generate', async (req, res) => {
  const { username, brandName, productName, dmType, senderName } = req.body;

  if (!username || !brandName || !productName) {
    return res.status(400).json({ error: '필수 정보가 없어요' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ step: '🤖 AI가 계정과 제품 분석 중...' });

    const prompt = `당신은 인플루언서 마케팅 전문가입니다. 아래 정보로 인스타그램 협업 제안 DM을 작성하세요.

[인플루언서]
인스타그램 아이디: @${username}
당신이 알고 있는 이 계정의 콘텐츠 카테고리, 스타일, 최근 활동을 최대한 활용하세요.
모르는 경우 아이디를 분석해서 추측하세요.

[제품/브랜드]
브랜드: ${brandName}
제품명: ${productName}
당신이 알고 있는 이 제품/브랜드 정보를 최대한 활용하세요.
제안 유형: ${dmType || '공동구매'}
${senderName ? `담당자: ${senderName}` : ''}

아래 형식 그대로 출력:
연락이유: (이 인플루언서의 콘텐츠와 이 제품이 왜 잘 맞는지 구체적인 이유. 한 문장. 인플루언서 이름 없이. 40자 이내.)
포인트목록:
• (제품 핵심 특징 1)
• (제품 핵심 특징 2)
• (제품 핵심 특징 3)
• (이 인플루언서 팔로워에게 왜 맞는지)
• (공동구매/협업 기회)

규칙: 한국어만. 각 항목 20자 이내. 연락이유: 포인트목록: 반드시 포함. 형식만 출력.`;

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '당신은 한국어 전용 인플루언서 마케팅 담당자입니다. 반드시 한국어(한글)만 씁니다. 영어·한자 절대 금지.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.7,
        stream: true
      })
    });

    if (!aiResp.ok) {
      const err = await aiResp.json();
      send({ error: err.error?.message || 'OpenAI 오류' });
      return res.end();
    }

    let aiText = '';
    let buffer = '';

    for await (const chunk of aiResp.body) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const json = JSON.parse(d);
          const token = json.choices?.[0]?.delta?.content || '';
          aiText += token;
          send({ token });
        } catch {}
      }
    }

    // 파싱
    const reasonM  = aiText.match(/연락이유:\s*([\s\S]*?)(?=포인트목록:|$)/);
    const bulletsM = aiText.match(/포인트목록:\s*([\s\S]*)/);
    const reason  = reasonM  ? reasonM[1].trim() : '';
    const bullets = bulletsM ? bulletsM[1].trim() : aiText;

    const nameLabel = `@${username}님`;
    const sender = senderName ? `${brandName} ${senderName}` : brandName;
    const reasonLine = reason
      ? `${reason} ${nameLabel}께 소개하고 싶어`
      : `${nameLabel}의 피드를 보고 잘 맞으실 것 같아`;

    const dm = `안녕하세요. ${nameLabel}

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

    send({ done: true, dm });
    res.end();

  } catch (e) {
    send({ error: e.message });
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
