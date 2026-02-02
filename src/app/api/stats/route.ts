import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY!

export async function GET() {
    try {
        // Get chunk statistics
        const statsResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/get_chunk_stats`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
            }
        )

        if (!statsResponse.ok) {
            throw new Error('Failed to fetch stats')
        }

        const stats = await statsResponse.json()

        // Get court distribution
        const courtsResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/case_chunks?select=court&limit=10000`,
            {
                headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                },
            }
        )

        let courtDistribution: Record<string, number> = {}
        if (courtsResponse.ok) {
            const courts = await courtsResponse.json()
            courts.forEach((c: { court: string }) => {
                const court = c.court || 'unknown'
                courtDistribution[court] = (courtDistribution[court] || 0) + 1
            })
        }

        return NextResponse.json({
            totalChunks: stats[0]?.total_chunks || 0,
            totalCases: stats[0]?.total_cases || 0,
            avgChunksPerCase: stats[0]?.avg_chunks_per_case || 0,
            courtDistribution,
            lastUpdated: new Date().toISOString(),
        })
    } catch (error) {
        console.error('Stats error:', error)
        return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
    }
}
