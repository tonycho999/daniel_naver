export async function onRequestGet(context) {
    // 💡 Cloudflare Pages 환경의 요청 URL에서 파라미터 추출
    const url = new URL(context.request.url);
    const keyword = url.searchParams.get('keyword');
    const category = url.searchParams.get('category');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    // 💡 Cloudflare 환경 변수 가져오기
    const clientId = context.env.NAVER_CLIENT_ID;
    const clientSecret = context.env.NAVER_CLIENT_SECRET;

    // 응답을 JSON 형태로 반환하기 위한 헬퍼 함수
    const jsonResponse = (data, status) => {
        return new Response(JSON.stringify(data), {
            status: status,
            headers: { 'Content-Type': 'application/json' }
        });
    };

    if (!clientId || !clientSecret) return jsonResponse({ error: 'API 키 누락 (서버 환경변수를 확인하세요)' }, 500);
    if (!keyword) return jsonResponse({ error: '검색어를 입력해주세요' }, 400);
    if (!startDate || !endDate) return jsonResponse({ error: '날짜 범위가 지정되지 않았습니다.' }, 400);

    const shopCategory = category || '50000000'; 

    try {
        // 1. 연관어 추출 (네이버 자동완성 API)
        const autoUrl = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(keyword)}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_k_org=1&q_enc=UTF-8&st=100&is_scui=0`;
        const autoRes = await fetch(autoUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const autoData = await autoRes.json();
        
        let related = [];
        if (autoData && autoData.items && autoData.items[0]) {
            related = autoData.items[0]
                .map(item => Array.isArray(item) ? item[0].trim() : item.trim())
                .filter(item => item && item !== keyword.trim())
                .slice(0, 14); 
        }

        const apiHeaders = {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            'Content-Type': 'application/json'
        };

        // 2. 통합 검색 트렌드 조회
        const fetchSearchTrend = async () => {
            const results = { [keyword]: 0 };
            
            for (let i = 0; i < related.length; i += 4) {
                const chunk = related.slice(i, i + 4);
                const currentKeywords = [keyword, ...chunk]; 
                
                const body = {
                    startDate, 
                    endDate,   
                    timeUnit: 'date', 
                    keywordGroups: currentKeywords.map(kw => ({ groupName: kw, keywords: [kw] }))
                };
                
                const res = await fetch('https://openapi.naver.com/v1/datalab/search', {
                    method: 'POST', headers: apiHeaders, body: JSON.stringify(body)
                });
                
                if (!res.ok) {
                    const errData = await res.text();
                    throw new Error(`[통합검색 API 에러] ${res.status} - ${errData}`);
                }
                
                const data = await res.json();
                if (data.results) {
                    data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            
            return Object.entries(results)
                .map(([name, score]) => ({ name, score }))
                .filter(item => item.score > 0 || item.name === keyword)
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 3. 쇼핑 검색 트렌드 조회 (최대 3개)
        const fetchShoppingTrend = async () => {
            const results = { [keyword]: 0 };
            
            for (let i = 0; i < related.length; i += 2) {
                const chunk = related.slice(i, i + 2);
                const currentKeywords = [keyword, ...chunk]; 
                
                const body = {
                    startDate, 
                    endDate,   
                    timeUnit: 'date',
                    category: shopCategory,
                    keyword: currentKeywords.map(kw => ({ name: kw, param: [kw] }))
                };
                
                const res = await fetch('https://openapi.naver.com/v1/datalab/shopping/category/keywords', {
                    method: 'POST', headers: apiHeaders, body: JSON.stringify(body)
                });
                
                if (!res.ok) {
                    const errData = await res.text();
                    throw new Error(`[쇼핑검색 API 에러] ${res.status} - ${errData}`);
                }
                
                const data = await res.json();
                if (data.results) {
                    data.results.forEach(item => {
                        const max = item.data.length > 0 ? Math.max(...item.data.map(d => d.ratio)) : 0;
                        results[item.title] = Math.max(results[item.title] || 0, max);
                    });
                }
            }
            
            return Object.entries(results)
                .map(([name, score]) => ({ name, score }))
                .filter(item => item.score > 0 || item.name === keyword)
                .sort((a, b) => b.score - a.score)
                .slice(0, 15);
        };

        // 동시 실행
        const [trendData, shopData] = await Promise.all([fetchSearchTrend(), fetchShoppingTrend()]);
        return jsonResponse({ trend: trendData, shop: shopData }, 200);

    } catch (error) {
        return jsonResponse({ error: error.message }, 500);
    }
}
