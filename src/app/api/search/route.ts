import { NextRequest, NextResponse } from 'next/server'

// Server-side only - API keys are NEVER exposed to browser
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!
const IFLOW_API_KEY = process.env.IFLOW_API_KEY!
const IFLOW_API_URL = process.env.IFLOW_API_URL || 'https://apis.iflow.cn/v1'

// HuggingFace Inference API for bge-small-en-v1.5 (free, 384 dimensions - matches our stored embeddings)
const HF_EMBEDDING_API = 'https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-small-en-v1.5'

export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const { query, court } = await request.json()

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 })
        }

        // Step 1: Generate embedding using HuggingFace (same model as stored embeddings)
        let queryEmbedding: number[] | null = null

        try {
            // Use HuggingFace Inference API for bge-small-en-v1.5 (384 dimensions)
            const embeddingResponse = await fetch(HF_EMBEDDING_API, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    inputs: query,
                    options: { wait_for_model: true }
                }),
            })

            if (embeddingResponse.ok) {
                const embedding = await embeddingResponse.json()
                // HuggingFace returns the embedding directly as an array
                if (Array.isArray(embedding) && embedding.length === 384) {
                    queryEmbedding = embedding
                } else if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
                    // Sometimes it returns [[...embedding...]]
                    queryEmbedding = embedding[0]
                }
            } else {
                console.error('HuggingFace embedding failed:', await embeddingResponse.text())
            }
        } catch (e) {
            console.error('Embedding API error:', e)
        }

        let results: any[] = []

        if (queryEmbedding && queryEmbedding.length === 384) {
            // Step 2a: Use semantic search with embeddings
            const searchBody: any = {
                query_embedding: queryEmbedding,
                match_threshold: 0.35,
                match_count: 10,
            }

            if (court && court !== 'all') {
                searchBody.filter_court = court
            }

            const searchResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/match_legal_chunks`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
                body: JSON.stringify(searchBody),
            })

            if (searchResponse.ok) {
                results = await searchResponse.json()
            } else {
                console.error('Supabase search error:', await searchResponse.text())
            }
        }

        // Step 2b: Fallback to keyword search if embedding failed or no results
        if (results.length === 0) {
            console.log('Falling back to keyword search...')
            const keywords = query.split(' ').filter((w: string) => w.length > 3).slice(0, 3)

            if (keywords.length > 0) {
                const searchTerms = keywords.map((k: string) => `chunk_text.ilike.*${k}*`).join(',')

                let url = `${SUPABASE_URL}/rest/v1/case_chunks?or=(${searchTerms})&limit=10&select=id,case_id,case_name,neutral_citation,court,decision_date,chunk_text,section_type,hklii_id`

                if (court && court !== 'all') {
                    url += `&court=eq.${court}`
                }

                const fallbackResponse = await fetch(url, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                    },
                })

                if (fallbackResponse.ok) {
                    const fallbackResults = await fallbackResponse.json()
                    results = fallbackResults.map((r: any) => ({ ...r, similarity: 0.5 }))
                }
            }
        }

        // Step 3: Generate AI answer with citations (if we have results)
        let aiAnswer: string | null = null
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
        return NextResponse.json({
            error: 'Search failed. Please try again.',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}

async function generateAIAnswer(query: string, results: any[]): Promise<string | null> {
    try {
        // Build context from search results
        const context = results
            .slice(0, 6)
            .map((r, i) => {
                const citation = r.neutral_citation || r.hklii_id || 'No citation'
                const caseName = r.case_name || 'Unknown case'
                return `[Source ${i + 1}: ${caseName} (${citation})]\n${r.chunk_text?.slice(0, 800) || ''}`
            })
            .join('\n\n---\n\n')

        const systemPrompt = `You are a Hong Kong legal research assistant. You help lawyers and legal professionals understand case law.

CRITICAL RULES:
1. ONLY use information from the provided case law sources
2. ALWAYS cite sources using [Source X] format when making claims
3. If sources don't contain enough information, clearly state: "The retrieved sources do not contain sufficient information to fully answer this question."
4. Be precise and professional
5. Never fabricate information or cite non-existent sources
6. Use proper legal terminology
7. Format your response clearly with paragraphs`

        const userPrompt = `Based on the following Hong Kong case law excerpts, answer this legal question:

QUESTION: ${query}

CASE LAW SOURCES:
${context}

Provide a clear, well-structured answer with citations to the relevant source numbers. If multiple sources are relevant, synthesize the information.`

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
                temperature: 0.2,
                max_tokens: 1500,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error('AI API error:', response.status, errorText)
            return null
        }

        const data = await response.json()
        return data.choices?.[0]?.message?.content || null
    } catch (error) {
        console.error('AI generation error:', error)
        return null
    }
}
