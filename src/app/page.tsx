'use client'

import { useState } from 'react'

interface SearchResult {
    id: number
    case_name: string
    neutral_citation: string
    court: string
    decision_date: string
    chunk_text: string
    section_type: string
    similarity: number
}

interface SearchResponse {
    results: SearchResult[]
    aiAnswer?: string
    query: string
    timeTaken: number
}

export default function Home() {
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [response, setResponse] = useState<SearchResponse | null>(null)
    const [error, setError] = useState<string | null>(null)

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!query.trim()) return

        setLoading(true)
        setError(null)

        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.trim() }),
            })

            if (!res.ok) {
                throw new Error('Search failed')
            }

            const data = await res.json()
            setResponse(data)
        } catch (err) {
            setError('Failed to search. Please try again.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="container">
            {/* Header */}
            <header className="header">
                <h1>⚖️ HK Legal Case Search</h1>
                <p>AI-powered semantic search through 5,000+ Hong Kong judgments</p>
            </header>

            {/* Stats */}
            <div className="stats-bar">
                <div className="stat-item">
                    <div className="stat-value">5,000+</div>
                    <div className="stat-label">Cases Indexed</div>
                </div>
                <div className="stat-item">
                    <div className="stat-value">AI</div>
                    <div className="stat-label">Powered Search</div>
                </div>
                <div className="stat-item">
                    <div className="stat-value">&lt;2s</div>
                    <div className="stat-label">Response Time</div>
                </div>
            </div>

            {/* Search Box */}
            <form onSubmit={handleSearch} className="search-container">
                <div className="search-input-wrapper">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Ask a legal question... e.g., 'What is the test for negligence?'"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={loading}
                    />
                    <button type="submit" className="search-button" disabled={loading || !query.trim()}>
                        {loading ? (
                            <>
                                <span className="spinner"></span>
                                Searching...
                            </>
                        ) : (
                            <>🔍 Search</>
                        )}
                    </button>
                </div>
            </form>

            {/* Error */}
            {error && (
                <div className="disclaimer" style={{ borderColor: '#ef4444', color: '#ef4444' }}>
                    ❌ {error}
                </div>
            )}

            {/* AI Answer */}
            {response?.aiAnswer && (
                <div className="ai-answer">
                    <h3>🤖 AI Analysis</h3>
                    <div className="ai-answer-content">{response.aiAnswer}</div>
                </div>
            )}

            {/* Results */}
            {response && (
                <>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                        Found {response.results.length} relevant excerpts in {response.timeTaken.toFixed(2)}s
                    </p>

                    <div className="results-container">
                        {response.results.map((result, index) => (
                            <div key={result.id} className="result-card">
                                <div className="result-header">
                                    <div className="result-title">
                                        {index + 1}. {result.case_name || 'Unknown Case'}
                                    </div>
                                    <div className="result-score">
                                        {(result.similarity * 100).toFixed(0)}% match
                                    </div>
                                </div>

                                <div className="result-meta">
                                    {result.neutral_citation && (
                                        <span className="meta-item">
                                            <span className="meta-icon">📋</span>
                                            {result.neutral_citation}
                                        </span>
                                    )}
                                    {result.court && (
                                        <span className="meta-item">
                                            <span className="meta-icon">🏛️</span>
                                            {result.court.toUpperCase()}
                                        </span>
                                    )}
                                    {result.decision_date && (
                                        <span className="meta-item">
                                            <span className="meta-icon">📅</span>
                                            {result.decision_date}
                                        </span>
                                    )}
                                </div>

                                {result.section_type && (
                                    <span className="section-badge">{result.section_type}</span>
                                )}

                                <div className="result-excerpt">
                                    {result.chunk_text}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Disclaimer */}
            <div className="disclaimer">
                ⚠️ <strong>Disclaimer:</strong> These excerpts are retrieved from case law judgments.
                They are not legal advice. Always consult the full judgment and seek qualified legal counsel.
            </div>
        </div>
    )
}
