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

    const prompt = `당신은 인플루언서 마케팅 에이전시 전문 카피라이터입니다. 아래 정보만 보고 DM 구성요소 3가지를 작성하세요. 반드시 한국어(한글)만 사용하세요.

인플루언서 아이디: @${username}
브랜드: ${brandName} / 제품: ${productName}
제안 유형: ${dmType || '공동구매'}

[인플루언서 분석 방법]
아이디를 보고 이 채널이 어떤 콘텐츠를 하는지 유추하세요.
예: promhananim → 프롬하나님 → 홈술/안주/요리 채널
예: fitness_jane → 피트니스/다이어트 채널
예: dailymom_yoon → 육아/일상 채널

[제품 분석 방법]
브랜드명+제품명으로 제품의 특징, 장점, 차별점을 알고 있는 정보로 분석하세요.
수치나 구체적인 묘사가 있으면 더 좋습니다.

[참고 예시 - 이 수준으로 작성하세요]
후킹 예시: "안주인데 다이어트가 되는 먹태, 있습니다."
연락이유 예시: "냉장고 털기부터 홈술 안주까지 팔로워분들이 진짜 따라 만드는 채널이잖아요.\n그 채널에 인생먹태 한 번 올라가면 댓글에 \"이거 어디꺼요\" 폭탄 맞을 것 같아서 연락드렸습니다."
포인트 예시: "• 안주이면서 닭가슴살 3.5배 고단백, 저칼로리\n• 결대로 찢어 두 번 구워 — 뜯는 순간 소리부터 다름\n• 100% 최상급 먹태순살, 파지·중국산 없음\n• 마성의 갈릭마요 비법소스 — 소스 때문에 재구매 생김"

반드시 아래 형식 그대로 출력:

후킹: (한 문장. "안녕하세요" 절대 금지. 제품의 가장 강렬한 특징과 이 채널의 연결고리. 마케팅 카피처럼. 예: "OO인데 OO이 되는 OO, 있습니다." 형식 참고.)

연락이유: (이 채널을 오래 봐온 팬처럼 구체적으로. 채널의 특징을 콕 집어서. 이 제품이 올라갔을 때 팔로워 반응까지 상상해서. 2~3문장. 이름/아이디 포함 금지.)

포인트목록:
• (제품 핵심 특징 — 수치나 감각적 묘사 포함)
• (제품 핵심 특징 — 구체적으로)
• (제품 핵심 특징 — 차별점)
• (이 채널 팔로워들이 특히 좋아할 이유)

규칙: 한국어만. 영어 절대 금지. 후킹: 연락이유: 포인트목록: 키워드 반드시 포함. 형식만 출력. 4개 포인트만.`;

    const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: '당신은 한국어 전용 인플루언서 마케팅 카피라이터입니다. 반드시 한국어(한글)만 씁니다. 영어·중국어·일본어 절대 금지. 살아있는 구어체로, 마치 그 채널 팬이 쓴 것처럼 자연스럽게 쓰세요.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 700,
        temperature: 0.75,
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
          if (token) {
            aiText += token;
            send({ chunk: token }); // 실시간 스트리밍
          }
        } catch {}
      }
    }

    // 파싱
    const hooking  = (aiText.match(/후킹:\s*([\s\S]*?)(?=연락이유:|$)/) || [])[1]?.trim() || '';
    const reason   = (aiText.match(/연락이유:\s*([\s\S]*?)(?=포인트목록:|$)/) || [])[1]?.trim() || '';
    const bullets  = (aiText.match(/포인트목록:\s*([\s\S]*)/) || [])[1]?.trim() || '';

    const nameLabel = `${username}님`;
    const sender = senderName ? `${brandName} ${senderName}` : brandName;

    const dm = `${hooking}

안녕하세요. ${nameLabel}

${sender}입니다.

${nameLabel}의 피드를 보고
${reason}
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
