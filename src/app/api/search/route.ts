import { NextRequest, NextResponse } from 'next/server'

// Force dynamic rendering (fixes the static generation error)
export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!
const IFLOW_API_KEY = process.env.IFLOW_API_KEY!
const IFLOW_API_URL = process.env.IFLOW_API_URL || 'https://apis.iflow.cn/v1'

// Qdrant Cloud configuration
const QDRANT_URL = process.env.QDRANT_URL!
const QDRANT_API_KEY = process.env.QDRANT_API_KEY!
const QDRANT_COLLECTION = 'legal_chunks'

const HF_EMBEDDING_API = 'https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-small-en-v1.5'

interface SearchResult {
    id: number
    case_id: number
    case_name: string
    neutral_citation: string
    court: string
    decision_date: string
    chunk_text: string
    section_type: string
    hklii_id: string
    similarity: number
    relevanceScore?: number
    source?: string
}

export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const { query, court } = await request.json()

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 })
        }

        // Extract keywords
        const keywords = query.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3)
            .filter(w => !['from', 'with', 'that', 'this', 'have', 'been', 'were', 'what', 'when', 'where', 'cases'].includes(w))

        let allResults: SearchResult[] = []

        // =========================================================================
        // STEP 1: Semantic search via Qdrant Cloud
        // =========================================================================
        try {
            // Generate embedding
            const embeddingResponse = await fetch(HF_EMBEDDING_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs: query, options: { wait_for_model: true } }),
            })

            if (embeddingResponse.ok) {
                const embedding = await embeddingResponse.json()
                let queryEmbedding = Array.isArray(embedding) && embedding.length === 384
                    ? embedding
                    : (Array.isArray(embedding[0]) ? embedding[0] : null)

                if (queryEmbedding) {
                    // Build Qdrant filter if court is specified
                    const filter = court ? {
                        must: [{
                            key: "court",
                            match: { value: court.toLowerCase() }
                        }]
                    } : undefined

                    // Search Qdrant Cloud
                    const qdrantResponse = await fetch(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points/query`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'api-key': QDRANT_API_KEY,
                        },
                        body: JSON.stringify({
                            query: queryEmbedding,
                            limit: 25,
                            score_threshold: 0.25,
                            with_payload: true,
                            filter: filter,
                        }),
                    })

                    if (qdrantResponse.ok) {
                        const qdrantData = await qdrantResponse.json()
                        const results = qdrantData.result?.points || []

                        allResults.push(...results.map((r: any) => ({
                            id: r.id,
                            case_id: r.payload?.case_id,
                            case_name: r.payload?.case_name || '',
                            neutral_citation: r.payload?.neutral_citation || '',
                            court: r.payload?.court || '',
                            decision_date: r.payload?.decision_date || '',
                            chunk_text: r.payload?.chunk_text || '',
                            section_type: r.payload?.section_type || '',
                            hklii_id: r.payload?.hklii_id || '',
                            similarity: r.score || 0,
                            source: 'semantic'
                        })))
                    } else {
                        console.error('Qdrant search failed:', await qdrantResponse.text())
                    }
                }
            }
        } catch (e) {
            console.error('Semantic search error:', e)
        }

        // =========================================================================
        // STEP 2: Keyword search
        // =========================================================================
        for (const keyword of keywords.slice(0, 4)) {
            try {
                const keywordUrl = `${SUPABASE_URL}/rest/v1/case_chunks?chunk_text=ilike.*${encodeURIComponent(keyword)}*&limit=8&select=id,case_id,case_name,neutral_citation,court,decision_date,chunk_text,section_type,hklii_id`

                const keywordResponse = await fetch(keywordUrl, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                    },
                })

                if (keywordResponse.ok) {
                    const keywordResults = await keywordResponse.json()
                    for (const result of keywordResults) {
                        if (!allResults.find(r => r.id === result.id)) {
                            allResults.push({ ...result, similarity: 0.5, source: 'keyword' })
                        }
                    }
                }
            } catch (e) { }
        }

        // Deduplicate
        const seen = new Set()
        allResults = allResults.filter(r => {
            if (seen.has(r.id)) return false
            seen.add(r.id)
            return true
        })

        // =========================================================================
        // STEP 3: AI RE-RANKING - Filter out irrelevant results
        // =========================================================================
        if (allResults.length > 0) {
            const rerankedResults = await rerankWithAI(query, allResults.slice(0, 15))
            allResults = rerankedResults
        }

        // Take top results
        const finalResults = allResults.slice(0, 10)

        // =========================================================================
        // STEP 4: Generate analysis
        // =========================================================================
        let aiAnswer: string | null = null

        if (finalResults.length > 0) {
            aiAnswer = await generateAnalysis(query, finalResults)
        } else {
            aiAnswer = `No relevant cases found for "${query}".`
        }

        return NextResponse.json({
            query,
            results: finalResults,
            aiAnswer,
            timeTaken: (Date.now() - startTime) / 1000,
        })

    } catch (error) {
        console.error('Search error:', error)
        return NextResponse.json({ error: 'Search failed' }, { status: 500 })
    }
}

// =============================================================================
// AI RE-RANKING - Score each result for actual relevance
// =============================================================================
async function rerankWithAI(query: string, results: SearchResult[]): Promise<SearchResult[]> {
    try {
        // Build batch for scoring
        const resultsToScore = results.map((r, i) => ({
            index: i,
            caseName: r.case_name || 'Unknown',
            text: r.chunk_text?.slice(0, 300) || ''
        }))

        const prompt = `You are a legal search relevance scorer. For each case excerpt below, rate its relevance to the user's query on a scale of 0-10.

QUERY: "${query}"

CASES TO SCORE:
${resultsToScore.map(r => `[${r.index}] ${r.caseName}: ${r.text}...`).join('\n\n')}

Respond with ONLY a JSON array of scores in order, like: [8, 2, 9, 1, 7, ...]
Consider:
- 9-10: Directly addresses the query topic
- 6-8: Related to the query, useful context  
- 3-5: Tangentially related
- 0-2: Completely unrelated, different topic

JSON array only:`

        const response = await fetch(`${IFLOW_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${IFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'glm-4-flash',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 200,
            }),
        })

        if (response.ok) {
            const data = await response.json()
            const content = data.choices?.[0]?.message?.content || ''

            // Parse scores
            const match = content.match(/\[[\d,\s]+\]/)
            if (match) {
                const scores = JSON.parse(match[0]) as number[]

                // Apply scores and filter low-relevance results
                const scoredResults = results.map((r, i) => ({
                    ...r,
                    relevanceScore: scores[i] ?? 5,
                    similarity: r.similarity * (1 + (scores[i] ?? 5) / 20)  // Boost by relevance
                }))

                // Filter out results with score < 4 (clearly irrelevant)
                const filtered = scoredResults.filter(r => (r.relevanceScore ?? 5) >= 4)

                // Sort by combined score
                filtered.sort((a, b) => {
                    const scoreA = (a.relevanceScore ?? 5) * 0.7 + a.similarity * 10 * 0.3
                    const scoreB = (b.relevanceScore ?? 5) * 0.7 + b.similarity * 10 * 0.3
                    return scoreB - scoreA
                })

                return filtered
            }
        }
    } catch (e) {
        console.error('Rerank error:', e)
    }

    // Fallback: return original sorted by similarity
    return results.sort((a, b) => b.similarity - a.similarity)
}

// =============================================================================
// ANALYSIS GENERATION
// =============================================================================
async function generateAnalysis(query: string, results: SearchResult[]): Promise<string> {
    try {
        const context = results.slice(0, 6).map((r, i) =>
            `[${i + 1}] ${r.case_name || 'Unknown'} (${r.neutral_citation || 'No citation'})${r.relevanceScore ? ` [Relevance: ${r.relevanceScore}/10]` : ''}\n${r.chunk_text?.slice(0, 500) || ''}`
        ).join('\n\n---\n\n')

        const response = await fetch(`${IFLOW_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${IFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-r1',
                messages: [
                    {
                        role: 'system',
                        content: `You are a Hong Kong legal research assistant. Analyze the case excerpts and answer the query. Cite sources as [1], [2], etc. Focus on the most relevant cases. If some cases seem off-topic, acknowledge this.`
                    },
                    {
                        role: 'user',
                        content: `Question: ${query}\n\nCase excerpts:\n${context}`
                    }
                ],
                temperature: 0.2,
                max_tokens: 1200,
            }),
        })

        if (response.ok) {
            const data = await response.json()
            return data.choices?.[0]?.message?.content || 'Analysis unavailable.'
        }
    } catch (e) {
        console.error('Analysis error:', e)
    }
    return 'Unable to generate analysis.'
}
