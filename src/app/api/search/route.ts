import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!
const IFLOW_API_KEY = process.env.IFLOW_API_KEY!
const IFLOW_API_URL = process.env.IFLOW_API_URL || 'https://apis.iflow.cn/v1'

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
    source?: string
}

export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const { query, court } = await request.json()

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 })
        }

        console.log('=== SEARCH DEBUG ===')
        console.log('Query:', query)

        // Extract keywords for fallback search
        const keywords = query.toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 3)
            .filter(w => !['from', 'with', 'that', 'this', 'have', 'been', 'were', 'what', 'when', 'where'].includes(w))

        console.log('Keywords extracted:', keywords)

        let allResults: SearchResult[] = []

        // =========================================================================
        // STEP 1: Try semantic search with HuggingFace embedding
        // =========================================================================
        let embeddingSuccess = false
        try {
            const embeddingResponse = await fetch(HF_EMBEDDING_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs: query, options: { wait_for_model: true } }),
            })

            if (embeddingResponse.ok) {
                const embedding = await embeddingResponse.json()
                let queryEmbedding = null

                if (Array.isArray(embedding) && embedding.length === 384) {
                    queryEmbedding = embedding
                } else if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
                    queryEmbedding = embedding[0]
                }

                if (queryEmbedding && queryEmbedding.length === 384) {
                    embeddingSuccess = true
                    console.log('Embedding generated successfully, dim:', queryEmbedding.length)

                    // Semantic search with lower threshold to get more candidates
                    const searchBody: any = {
                        query_embedding: queryEmbedding,
                        match_threshold: 0.30,  // Lower threshold to get more results
                        match_count: 20,
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
                        const results = await searchResponse.json()
                        console.log('Semantic search returned:', results.length, 'results')
                        allResults.push(...results.map((r: any) => ({ ...r, source: 'semantic' })))
                    } else {
                        console.error('Semantic search failed:', await searchResponse.text())
                    }
                }
            } else {
                console.error('Embedding API failed:', embeddingResponse.status)
            }
        } catch (e) {
            console.error('Embedding error:', e)
        }

        // =========================================================================
        // STEP 2: ALWAYS do keyword search as well (critical for relevance)
        // =========================================================================
        console.log('Running keyword search for:', keywords)

        for (const keyword of keywords.slice(0, 5)) {
            try {
                // Use text search for each important keyword
                const keywordUrl = `${SUPABASE_URL}/rest/v1/case_chunks?chunk_text=ilike.*${encodeURIComponent(keyword)}*&limit=10&select=id,case_id,case_name,neutral_citation,court,decision_date,chunk_text,section_type,hklii_id`

                const keywordResponse = await fetch(keywordUrl, {
                    headers: {
                        'apikey': SUPABASE_KEY,
                        'Authorization': `Bearer ${SUPABASE_KEY}`,
                    },
                })

                if (keywordResponse.ok) {
                    const keywordResults = await keywordResponse.json()
                    console.log(`Keyword "${keyword}" found:`, keywordResults.length, 'results')

                    // Add results with keyword match score
                    for (const result of keywordResults) {
                        const existing = allResults.find(r => r.id === result.id)
                        if (!existing) {
                            allResults.push({ ...result, similarity: 0.6, source: 'keyword' })
                        } else if (existing.source === 'keyword') {
                            // Boost score for multiple keyword matches
                            existing.similarity = Math.min(0.9, existing.similarity + 0.1)
                        }
                    }
                }
            } catch (e) {
                console.error('Keyword search error for', keyword, e)
            }
        }

        // =========================================================================
        // STEP 3: Score and rerank results
        // =========================================================================

        // Boost results that contain more query keywords
        const queryLower = query.toLowerCase()
        allResults = allResults.map(result => {
            const textLower = result.chunk_text?.toLowerCase() || ''
            let keywordMatches = 0

            for (const kw of keywords) {
                if (textLower.includes(kw)) {
                    keywordMatches++
                }
            }

            // Significant boost for keyword matches
            const boost = keywordMatches > 0 ? 1 + (keywordMatches * 0.15) : 1

            return {
                ...result,
                similarity: Math.min(0.99, result.similarity * boost),
                keywordMatches
            }
        })

        // Sort by boosted similarity
        allResults.sort((a, b) => b.similarity - a.similarity)

        // Deduplicate by id
        const seen = new Set()
        allResults = allResults.filter(r => {
            if (seen.has(r.id)) return false
            seen.add(r.id)
            return true
        })

        // Take top 10
        const finalResults = allResults.slice(0, 10)

        console.log('Final results:', finalResults.length)
        console.log('Result sources:', finalResults.map(r => r.source))

        // =========================================================================
        // STEP 4: Generate AI analysis
        // =========================================================================
        let aiAnswer: string | null = null

        if (finalResults.length > 0) {
            aiAnswer = await generateAnalysis(query, finalResults)
        } else {
            aiAnswer = `No relevant cases found for "${query}".\n\nThis could mean:\n1. The database doesn't contain cases on this topic yet\n2. Try different search terms (e.g., "personal injury" instead of specific injuries)\n3. Try broader legal concepts (e.g., "negligence", "damages", "compensation")`
        }

        return NextResponse.json({
            query,
            results: finalResults,
            aiAnswer,
            timeTaken: (Date.now() - startTime) / 1000,
            debug: {
                embeddingSuccess,
                keywordsUsed: keywords,
                totalCandidates: allResults.length,
            }
        })

    } catch (error) {
        console.error('Search error:', error)
        return NextResponse.json({
            error: 'Search failed',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}

async function generateAnalysis(query: string, results: SearchResult[]): Promise<string> {
    try {
        const context = results.slice(0, 6).map((r, i) =>
            `[${i + 1}] ${r.case_name || 'Unknown'} (${r.neutral_citation || 'No citation'})\n${r.chunk_text?.slice(0, 600) || ''}`
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
                        content: `You are a Hong Kong legal research assistant. Analyze the provided case excerpts and answer the user's question. Always cite sources using [1], [2], etc. If the cases don't seem relevant to the query, say so clearly.`
                    },
                    {
                        role: 'user',
                        content: `Question: ${query}\n\nCase excerpts:\n${context}\n\nProvide a concise legal analysis.`
                    }
                ],
                temperature: 0.2,
                max_tokens: 1000,
            }),
        })

        if (response.ok) {
            const data = await response.json()
            return data.choices?.[0]?.message?.content || 'Analysis unavailable.'
        }
    } catch (e) {
        console.error('AI analysis error:', e)
    }
    return 'Unable to generate analysis.'
}
