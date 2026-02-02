'use client'

import { useState, useEffect } from 'react'

interface SearchResult {
    id: number
    case_id: number
    case_name: string
    neutral_citation: string
    court: string
    decision_date: string
    chunk_text: string
    section_type: string
    similarity: number
    hklii_id: string
}

interface SearchResponse {
    results: SearchResult[]
    aiAnswer?: string
    query: string
    timeTaken: number
    queryAnalysis?: {
        subQueries: string[]
        keywords: string[]
        legalConcepts: string[]
        queryType: string
    }
}

interface SearchHistoryItem {
    query: string
    timestamp: Date
    resultCount: number
}

export default function Home() {
    const [query, setQuery] = useState('')
    const [loading, setLoading] = useState(false)
    const [response, setResponse] = useState<SearchResponse | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [selectedCourt, setSelectedCourt] = useState<string>('all')
    const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([])
    const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
    const [showHistory, setShowHistory] = useState(false)

    useEffect(() => {
        const saved = localStorage.getItem('searchHistory')
        if (saved) setSearchHistory(JSON.parse(saved))
    }, [])

    const saveToHistory = (q: string, count: number) => {
        const newItem: SearchHistoryItem = { query: q, timestamp: new Date(), resultCount: count }
        const updated = [newItem, ...searchHistory.slice(0, 9)]
        setSearchHistory(updated)
        localStorage.setItem('searchHistory', JSON.stringify(updated))
    }

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!query.trim()) return

        setLoading(true)
        setError(null)
        setSelectedResult(null)

        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: query.trim(),
                    court: selectedCourt === 'all' ? null : selectedCourt,
                }),
            })

            if (!res.ok) throw new Error('Search failed')

            const data = await res.json()
            setResponse(data)
            saveToHistory(query.trim(), data.results.length)
        } catch (err) {
            setError('Search failed. Please try again.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const courts = [
        { value: 'all', label: 'All Courts' },
        { value: 'hkcfa', label: 'CFA' },
        { value: 'hkca', label: 'CA' },
        { value: 'hkcfi', label: 'CFI' },
        { value: 'hkdc', label: 'DC' },
    ]

    return (
        <div className="container">
            {/* Header */}
            <header className="header">
                <h1>⚖️ <span>Casebase</span></h1>
            </header>

            {/* Stats */}
            <div className="stats-bar">
                <div className="stat-item">
                    <div className="stat-value">5,000+</div>
                    <div className="stat-label">Cases</div>
                </div>
                <div className="stat-item">
                    <div className="stat-value">AI</div>
                    <div className="stat-label">Powered</div>
                </div>
            </div>

            {/* Search */}
            <form onSubmit={handleSearch} className="search-container">
                <div className="search-filters">
                    <select
                        className="court-filter"
                        value={selectedCourt}
                        onChange={(e) => setSelectedCourt(e.target.value)}
                    >
                        {courts.map(c => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                    </select>

                    {searchHistory.length > 0 && (
                        <button
                            type="button"
                            className="history-button"
                            onClick={() => setShowHistory(!showHistory)}
                        >
                            History
                        </button>
                    )}
                </div>

                {showHistory && searchHistory.length > 0 && (
                    <div className="history-dropdown">
                        {searchHistory.map((item, i) => (
                            <div key={i} className="history-item" onClick={() => { setQuery(item.query); setShowHistory(false) }}>
                                <span className="history-query">{item.query}</span>
                                <span className="history-count">{item.resultCount}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div className="search-input-wrapper">
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search legal cases..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={loading}
                    />
                    <button type="submit" className="search-button" disabled={loading || !query.trim()}>
                        {loading ? <><span className="spinner"></span></> : 'Search'}
                    </button>
                </div>

                <div className="quick-examples">
                    <span className="examples-label">Try:</span>
                    {['negligence', 'breach of contract', 'personal injury', 'judicial review'].map(ex => (
                        <button key={ex} type="button" className="example-chip" onClick={() => setQuery(ex)}>
                            {ex}
                        </button>
                    ))}
                </div>
            </form>

            {/* Error */}
            {error && (
                <div className="disclaimer" style={{ borderColor: '#ef4444', color: '#ef4444' }}>
                    {error}
                </div>
            )}

            {/* Query Analysis */}
            {response?.queryAnalysis?.legalConcepts && response.queryAnalysis.legalConcepts.length > 0 && (
                <div className="query-analysis">
                    <span className="analysis-label">Concepts:</span>
                    {response.queryAnalysis.legalConcepts.slice(0, 4).map((c: string, i: number) => (
                        <span key={i} className="concept-tag">{c}</span>
                    ))}
                </div>
            )}

            {/* AI Answer */}
            {response?.aiAnswer && (
                <div className="ai-answer">
                    <h3>📋 Analysis</h3>
                    <div className="ai-answer-content">{response.aiAnswer}</div>
                </div>
            )}

            {/* Results */}
            {response && (
                <>
                    <div className="results-header">
                        <strong>{response.results.length}</strong> results in <strong>{response.timeTaken.toFixed(1)}s</strong>
                    </div>

                    <div className="results-container">
                        {response.results.map((result, index) => (
                            <div
                                key={result.id}
                                className={`result-card ${selectedResult?.id === result.id ? 'selected' : ''}`}
                                onClick={() => setSelectedResult(result)}
                            >
                                <div className="result-header">
                                    <div className="result-title">
                                        {result.case_name || 'Untitled Case'}
                                    </div>
                                    <div className="result-score">
                                        {(result.similarity * 100).toFixed(0)}%
                                    </div>
                                </div>

                                <div className="result-meta">
                                    {result.neutral_citation && (
                                        <span className="meta-item">{result.neutral_citation}</span>
                                    )}
                                    {result.court && (
                                        <span className="meta-item">{result.court.toUpperCase()}</span>
                                    )}
                                    {result.decision_date && (
                                        <span className="meta-item">{result.decision_date}</span>
                                    )}
                                </div>

                                <div className="result-excerpt">
                                    {result.chunk_text.length > 400
                                        ? result.chunk_text.slice(0, 400) + '...'
                                        : result.chunk_text}
                                </div>

                                {result.hklii_id && (
                                    <div className="result-actions">
                                        <a
                                            href={(() => {
                                                const parts = result.hklii_id.split('_')
                                                if (parts.length === 3) {
                                                    return `https://www.hklii.hk/en/cases/${parts[0]}/${parts[1]}/${parts[2]}`
                                                }
                                                return `https://www.hklii.hk/en/search?q=${encodeURIComponent(result.neutral_citation || '')}`
                                            })()}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="view-full-button"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            View on HKLII →
                                        </a>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Modal */}
            {selectedResult && (
                <div className="modal-overlay" onClick={() => setSelectedResult(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setSelectedResult(null)}>×</button>
                        <h2>{selectedResult.case_name}</h2>
                        <div className="modal-meta">
                            <p><strong>Citation:</strong> {selectedResult.neutral_citation}</p>
                            <p><strong>Court:</strong> {selectedResult.court?.toUpperCase()}</p>
                            <p><strong>Date:</strong> {selectedResult.decision_date}</p>
                        </div>
                        <div className="modal-excerpt">
                            <h4>Excerpt</h4>
                            <p>{selectedResult.chunk_text}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="disclaimer">
                Not legal advice. Data from <a href="https://www.hklii.hk" target="_blank" rel="noopener noreferrer">HKLII</a>.
            </div>
        </div>
    )
}
