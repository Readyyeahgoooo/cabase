import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const caseId = searchParams.get('id')

        if (!caseId) {
            return NextResponse.json({ error: 'Case ID required' }, { status: 400 })
        }

        // Get all chunks for this case
        const chunksResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/case_chunks?case_id=eq.${caseId}&order=chunk_index.asc&select=id,chunk_index,chunk_text,section_type,case_name,neutral_citation,court,decision_date,hklii_id`,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
            }
        )

        if (!chunksResponse.ok) {
            throw new Error('Failed to fetch case')
        }

        const chunks = await chunksResponse.json()

        if (chunks.length === 0) {
            return NextResponse.json({ error: 'Case not found' }, { status: 404 })
        }

        // Combine all chunks to get full text
        const fullText = chunks.map((c: any) => c.chunk_text).join('\n\n')
        const metadata = chunks[0]

        return NextResponse.json({
            caseId: parseInt(caseId),
            caseName: metadata.case_name,
            neutralCitation: metadata.neutral_citation,
            court: metadata.court,
            decisionDate: metadata.decision_date,
            hkliiId: metadata.hklii_id,
            totalChunks: chunks.length,
            chunks: chunks.map((c: any) => ({
                index: c.chunk_index,
                text: c.chunk_text,
                section: c.section_type,
            })),
        })
    } catch (error) {
        console.error('Case fetch error:', error)
        return NextResponse.json({ error: 'Failed to fetch case' }, { status: 500 })
    }
}
