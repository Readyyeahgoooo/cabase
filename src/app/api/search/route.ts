import { NextRequest, NextResponse } from 'next/server'

// Server-side only - API keys are NEVER exposed to browser
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!
const IFLOW_API_KEY = process.env.IFLOW_API_KEY!
const IFLOW_API_URL = process.env.IFLOW_API_URL || 'https://apis.iflow.cn/v1'

// HuggingFace Inference API for bge-small-en-v1.5
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
    matchedQueries?: string[]
}

export async function POST(request: NextRequest) {
    const startTime = Date.now()

    try {
        const { query, court } = await request.json()

        if (!query || typeof query !== 'string') {
            return NextResponse.json({ error: 'Query is required' }, { status: 400 })
        }

        // =========================================================================
        // STEP 1: Query Analysis & Decomposition
        // =========================================================================
        const queryAnalysis = await analyzeQuery(query)
        console.log('Query analysis:', queryAnalysis)

        // =========================================================================
        // STEP 2: Multi-Query Semantic Search
        // =========================================================================
        let allResults: SearchResult[] = []

        // Search with main query
        const mainResults = await semanticSearch(query, court, 0.40)
        allResults.push(...mainResults.map(r => ({ ...r, matchedQueries: ['main'] })))

        // Search with decomposed sub-queries
        for (const subQuery of queryAnalysis.subQueries) {
            const subResults = await semanticSearch(subQuery, court, 0.45)
            for (const result of subResults) {
                const existing = allResults.find(r => r.id === result.id)
                if (existing) {
                    existing.matchedQueries?.push(subQuery)
                    // Boost similarity for multi-match
                    existing.similarity = Math.min(1, existing.similarity * 1.15)
                } else {
                    allResults.push({ ...result, matchedQueries: [subQuery] })
                }
            }
        }

        // =========================================================================
        // STEP 3: Keyword Search for Specific Terms
        // =========================================================================
        if (queryAnalysis.keywords.length > 0) {
            const keywordResults = await keywordSearch(queryAnalysis.keywords, court)
            for (const result of keywordResults) {
                const existing = allResults.find(r => r.id === result.id)
                if (existing) {
                    existing.matchedQueries?.push('keyword')
                    existing.similarity = Math.min(1, existing.similarity * 1.1)
                } else {
                    allResults.push({ ...result, matchedQueries: ['keyword'] })
                }
            }
        }

        // =========================================================================
        // STEP 4: Re-rank and Deduplicate
        // =========================================================================
        // Score boost for matching multiple queries
        allResults = allResults.map(r => ({
            ...r,
            similarity: r.similarity * (1 + (r.matchedQueries?.length || 1) * 0.05)
        }))

        // Sort by boosted similarity
        allResults.sort((a, b) => b.similarity - a.similarity)

        // Take top results, ensure diversity (not all from same case)
        const finalResults = diversifyResults(allResults, 10)

        // =========================================================================
        // STEP 5: Generate Professional Legal Analysis
        // =========================================================================
        let aiAnswer: string | null = null
        if (finalResults.length > 0) {
            aiAnswer = await generateLegalAnalysis(query, queryAnalysis, finalResults)
        } else {
            aiAnswer = generateNoResultsGuidance(query, queryAnalysis)
        }

        const timeTaken = (Date.now() - startTime) / 1000

        return NextResponse.json({
            query,
            queryAnalysis,
            results: finalResults,
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

// =============================================================================
// QUERY ANALYSIS - Break complex queries into searchable components
// =============================================================================
async function analyzeQuery(query: string): Promise<{
    originalQuery: string
    subQueries: string[]
    keywords: string[]
    legalConcepts: string[]
    queryType: 'simple' | 'complex' | 'factual'
}> {
    // Use AI to decompose complex queries
    try {
        const response = await fetch(`${IFLOW_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${IFLOW_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'glm-4-flash',  // Fast model for query analysis
                messages: [
                    {
                        role: 'system',
                        content: `You are a legal search query analyzer. Given a legal research question, extract:
1. 2-3 simpler sub-queries that capture different aspects
2. Key legal keywords (specific terms to search for)
3. Legal concepts/doctrines mentioned

Respond in JSON format only:
{
  "subQueries": ["sub query 1", "sub query 2"],
  "keywords": ["keyword1", "keyword2"],
  "legalConcepts": ["concept1", "concept2"],
  "queryType": "simple|complex|factual"
}`
                    },
                    { role: 'user', content: query }
                ],
                temperature: 0.1,
                max_tokens: 300,
            }),
        })

        if (response.ok) {
            const data = await response.json()
            const content = data.choices?.[0]?.message?.content || ''

            // Parse JSON from response
            const jsonMatch = content.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                return {
                    originalQuery: query,
                    subQueries: parsed.subQueries || [],
                    keywords: parsed.keywords || [],
                    legalConcepts: parsed.legalConcepts || [],
                    queryType: parsed.queryType || 'complex'
                }
            }
        }
    } catch (e) {
        console.error('Query analysis error:', e)
    }

    // Fallback: Simple extraction
    const words = query.toLowerCase().split(/\s+/)
    const legalTerms = words.filter(w =>
        ['negligence', 'liability', 'damages', 'breach', 'duty', 'care', 'defendant',
            'plaintiff', 'injury', 'compensation', 'contract', 'tort', 'defense'].includes(w)
    )

    return {
        originalQuery: query,
        subQueries: [query],  // Just use original
        keywords: words.filter(w => w.length > 4).slice(0, 5),
        legalConcepts: legalTerms,
        queryType: query.split(' ').length > 8 ? 'complex' : 'simple'
    }
}

// =============================================================================
// SEMANTIC SEARCH
// =============================================================================
async function semanticSearch(query: string, court: string | null, threshold: number): Promise<SearchResult[]> {
    try {
        // Generate embedding
        const embeddingResponse = await fetch(HF_EMBEDDING_API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: query, options: { wait_for_model: true } }),
        })

        if (!embeddingResponse.ok) return []

        const embedding = await embeddingResponse.json()
        let queryEmbedding = Array.isArray(embedding) && embedding.length === 384
            ? embedding
            : (Array.isArray(embedding[0]) ? embedding[0] : null)

        if (!queryEmbedding) return []

        // Search Supabase
        const searchBody: any = {
            query_embedding: queryEmbedding,
            match_threshold: threshold,
            match_count: 15,
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
            let results = await searchResponse.json()
            if (court && court !== 'all') {
                results = results.filter((r: any) => r.court === court)
            }
            return results
        }
    } catch (e) {
        console.error('Semantic search error:', e)
    }
    return []
}

// =============================================================================
// KEYWORD SEARCH
// =============================================================================
async function keywordSearch(keywords: string[], court: string | null): Promise<SearchResult[]> {
    try {
        if (keywords.length === 0) return []

        const searchTerms = keywords.slice(0, 4).map(k => `chunk_text.ilike.*${k}*`).join(',')
        let url = `${SUPABASE_URL}/rest/v1/case_chunks?or=(${searchTerms})&limit=10&select=id,case_id,case_name,neutral_citation,court,decision_date,chunk_text,section_type,hklii_id`

        if (court && court !== 'all') {
            url += `&court=eq.${court}`
        }

        const response = await fetch(url, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
        })

        if (response.ok) {
            const results = await response.json()
            return results.map((r: any) => ({ ...r, similarity: 0.45 }))
        }
    } catch (e) {
        console.error('Keyword search error:', e)
    }
    return []
}

// =============================================================================
// RESULT DIVERSIFICATION - Avoid too many chunks from same case
// =============================================================================
function diversifyResults(results: SearchResult[], maxResults: number): SearchResult[] {
    const seenCases = new Map<number, number>()  // case_id -> count
    const diversified: SearchResult[] = []
    const maxPerCase = 3

    for (const result of results) {
        const caseCount = seenCases.get(result.case_id) || 0
        if (caseCount < maxPerCase) {
            diversified.push(result)
            seenCases.set(result.case_id, caseCount + 1)
        }
        if (diversified.length >= maxResults) break
    }

    return diversified
}

// =============================================================================
// PROFESSIONAL LEGAL ANALYSIS GENERATION
// =============================================================================
async function generateLegalAnalysis(
    query: string,
    analysis: { legalConcepts: string[], queryType: string },
    results: SearchResult[]
): Promise<string> {
    try {
        const context = results
            .slice(0, 8)
            .map((r, i) => {
                const citation = r.neutral_citation || 'No citation'
                const caseName = r.case_name || 'Unknown case'
                const score = (r.similarity * 100).toFixed(0)
                return `[Source ${i + 1}: ${caseName} (${citation}) - ${score}% match]
Court: ${r.court?.toUpperCase() || 'Unknown'}
Date: ${r.decision_date || 'Unknown'}
Section: ${r.section_type || 'General'}

${r.chunk_text?.slice(0, 1000) || ''}`
            })
            .join('\n\n' + '─'.repeat(50) + '\n\n')

        const systemPrompt = `You are a senior Hong Kong legal research assistant providing professional analysis for lawyers and legal professionals.

YOUR TASK:
1. Analyze the provided case law sources
2. Identify relevant legal principles and holdings
3. Synthesize findings into a structured legal analysis
4. Always cite sources using [Source X] format
5. Note any limitations in the available sources

IMPORTANT RULES:
- ONLY use information from provided sources
- If sources are insufficient, clearly state this
- Be precise with legal terminology
- Distinguish between ratio decidendi and obiter dicta when relevant
- Note the court level (CFA, CA, CFI, DC) as it affects precedential value`

        const userPrompt = `LEGAL RESEARCH QUESTION:
${query}

${analysis.legalConcepts.length > 0 ? `RELEVANT LEGAL CONCEPTS: ${analysis.legalConcepts.join(', ')}` : ''}

RETRIEVED CASE LAW SOURCES:
${context}

Please provide a structured legal analysis with:
1. **Summary of Relevant Authorities** - Key cases and their holdings
2. **Legal Principles Identified** - What rules/tests apply
3. **Application to Query** - How these authorities might apply
4. **Limitations** - Gaps in the retrieved sources or need for further research`

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
                max_tokens: 2000,
            }),
        })

        if (response.ok) {
            const data = await response.json()
            return data.choices?.[0]?.message?.content || 'Analysis generation failed.'
        }
    } catch (error) {
        console.error('AI analysis error:', error)
    }
    return 'Unable to generate analysis. Please review the case excerpts directly.'
}

// =============================================================================
// NO RESULTS GUIDANCE
// =============================================================================
function generateNoResultsGuidance(query: string, analysis: any): string {
    return `## No Directly Relevant Cases Found

Your query: "${query}"

### Suggestions:
1. **Try broader terms**: Instead of specific fact patterns, search for legal concepts like:
   - "liability defense"
   - "personal injury damages"
   - "contributory negligence"

2. **Break down your query**: 
   - Search: "defendant escapes liability"
   - Then: "skull fracture personal injury"

3. **Check your terminology**: Hong Kong courts may use different terms:
   - "no liability" → "defense succeeded"
   - "get out of" → "avoid liability" or "establish defense"

${analysis.legalConcepts.length > 0 ? `
4. **Related concepts detected**: ${analysis.legalConcepts.join(', ')}
   Try searching these terms individually.` : ''}

### Database Coverage
The current database contains cases from HKCA and HKCFI. If you need cases from specific courts or time periods, please let us know.`
}
