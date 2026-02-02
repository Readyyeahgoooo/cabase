import { NextRequest, NextResponse } from 'next/server'

// Server-side only - API keys are NEVER exposed to browser
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!
const IFLOW_API_KEY = process.env.IFLOW_API_KEY!
const IFLOW_API_URL = process.env.IFLOW_API_URL || 'https://apis.iflow.cn/v1'

export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const { query } = await request.json()

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 })
        }

        // Step 1: Generate embedding for the query using iFlow
        const embeddingResponse = await fetch(`${IFLOW_API_URL}/embeddings`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${IFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'text-embedding-3-small',
                input: query,
            }),
        })

        if (!embeddingResponse.ok) {
            // Fallback: Use a simple keyword search if embedding fails
            console.error('Embedding API failed, falling back to keyword search')
            return await keywordSearch(query, startTime)
        }

        const embeddingData = await embeddingResponse.json()
        const queryEmbedding = embeddingData.data[0].embedding

        // Step 2: Search Supabase for similar chunks
        const searchResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_legal_chunks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
            body: JSON.stringify({
                query_embedding: queryEmbedding,
                match_threshold: 0.4,
                match_count: 8,
            }),
        })

        if (!searchResponse.ok) {
            const errorText = await searchResponse.text()
            console.error('Supabase search failed:', errorText)
            return NextResponse.json({ error: 'Search failed' }, { status: 500 })
        }

        const results = await searchResponse.json()

        // Step 3: Generate AI answer with citations
        let aiAnswer = null
        if (results.length > 0) {
            aiAnswer = await generateAIAnswer(query, results)
        }

        const timeTaken = (Date.now() - startTime) / 1000

        return NextResponse.json({
            query,
            results,
            aiAnswer,
            timeTaken,
        })
    } catch (error) {
        console.error('Search error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

async function keywordSearch(query: string, startTime: number) {
    // Fallback keyword search using Supabase full-text search
    const searchResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/case_chunks?chunk_text=ilike.*${encodeURIComponent(query.split(' ')[0])}*&limit=5`,
        {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
        }
    )

    const results = await searchResponse.json()
    const timeTaken = (Date.now() - startTime) / 1000

    return NextResponse.json({
        query,
        results: results.map((r: any) => ({ ...r, similarity: 0.5 })),
        aiAnswer: null,
        timeTaken,
    })
}

async function generateAIAnswer(query: string, results: any[]) {
    try {
        // Build context from search results
        const context = results
            .slice(0, 5)
            .map((r, i) => `[Source ${i + 1}: ${r.case_name || 'Unknown'} (${r.neutral_citation || 'No citation'})]\n${r.chunk_text}`)
            .join('\n\n')

        const systemPrompt = `You are a Hong Kong legal research assistant. You help lawyers and legal professionals find relevant case law.

IMPORTANT RULES:
1. ONLY use information from the provided sources
2. ALWAYS cite the source number and case name when making claims
3. If the sources don't contain enough information, say "The retrieved sources do not contain sufficient information to answer this question."
4. Be concise but thorough
5. Never make up information not in the sources`

        const userPrompt = `Based on the following case law excerpts, answer this legal question:

Question: ${query}

Sources:
${context}

Provide a clear answer with citations to the source numbers.`

        const response = await fetch(`${IFLOW_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${IFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-r1',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 1000,
            }),
        })

        if (!response.ok) {
            console.error('AI response failed')
            return null
        }

        const data = await response.json()
        return data.choices[0]?.message?.content || null
    } catch (error) {
        console.error('AI generation error:', error)
        return null
    }
}
