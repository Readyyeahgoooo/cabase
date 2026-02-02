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

    // Load search history from localStorage
    useEffect(() => {
        const saved = localStorage.getItem('searchHistory')
        if (saved) {
            setSearchHistory(JSON.parse(saved))
        }
    }, [])

    const saveToHistory = (q: string, count: number) => {
        const newItem: SearchHistoryItem = {
            query: q,
            timestamp: new Date(),
            resultCount: count,
        }
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

            if (!res.ok) {
                throw new Error('Search failed')
            }

            const data = await res.json()
            setResponse(data)
            saveToHistory(query.trim(), data.results.length)
        } catch (err) {
            setError('Failed to search. Please try again.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const handleHistoryClick = (q: string) => {
        setQuery(q)
        setShowHistory(false)
    }

    const courts = [
        { value: 'all', label: 'All Courts' },
        { value: 'hkcfa', label: 'Court of Final Appeal' },
        { value: 'hkca', label: 'Court of Appeal' },
        { value: 'hkcfi', label: 'Court of First Instance' },
        { value: 'hkdc', label: 'District Court' },
    ]

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
                    <div className="stat-value">DeepSeek-R1</div>
                    <div className="stat-label">AI Model</div>
                </div>
                <div className="stat-item">
                    <div className="stat-value">&lt;2s</div>
                    <div className="stat-label">Response Time</div>
                </div>
            </div>

            {/* Search Box */}
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

                    <button
                        type="button"
                        className="history-button"
                        onClick={() => setShowHistory(!showHistory)}
                    >
                        📜 History ({searchHistory.length})
                    </button>
                </div>

                {showHistory && searchHistory.length > 0 && (
                    <div className="history-dropdown">
                        {searchHistory.map((item, i) => (
                            <div
                                key={i}
                                className="history-item"
                                onClick={() => handleHistoryClick(item.query)}
                            >
                                <span className="history-query">{item.query}</span>
                                <span className="history-count">{item.resultCount} results</span>
                            </div>
                        ))}
                    </div>
                )}

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

                {/* Quick Examples */}
                <div className="quick-examples">
                    <span className="examples-label">Try:</span>
                    {['negligence test', 'duty of care', 'contract breach damages', 'judicial review grounds'].map(ex => (
                        <button
                            key={ex}
                            type="button"
                            className="example-chip"
                            onClick={() => setQuery(ex)}
                        >
                            {ex}
                        </button>
                    ))}
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
                    <h3>🤖 AI Analysis (DeepSeek-R1)</h3>
                    <div className="ai-answer-content">{response.aiAnswer}</div>
                </div>
            )}

            {/* Results */}
            {response && (
                <>
                    <div className="results-header">
                        <p>
                            Found <strong>{response.results.length}</strong> relevant excerpts in <strong>{response.timeTaken.toFixed(2)}s</strong>
                        </p>
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
                                    {result.chunk_text.length > 500
                                        ? result.chunk_text.slice(0, 500) + '...'
                                        : result.chunk_text}
                                </div>

                                {result.hklii_id && (
                                    <div className="result-actions">
                                        <a
                                            href={`https://www.hklii.hk/en/cases/${result.court}/${result.hklii_id.split('/').pop()}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="view-full-button"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            📄 View Full Judgment on HKLII
                                        </a>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Selected Result Modal */}
            {selectedResult && (
                <div className="modal-overlay" onClick={() => setSelectedResult(null)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button className="modal-close" onClick={() => setSelectedResult(null)}>×</button>
                        <h2>{selectedResult.case_name}</h2>
                        <div className="modal-meta">
                            <p><strong>Citation:</strong> {selectedResult.neutral_citation}</p>
                            <p><strong>Court:</strong> {selectedResult.court?.toUpperCase()}</p>
                            <p><strong>Date:</strong> {selectedResult.decision_date}</p>
                            <p><strong>Section:</strong> {selectedResult.section_type}</p>
                            <p><strong>Relevance:</strong> {(selectedResult.similarity * 100).toFixed(1)}%</p>
                        </div>
                        <div className="modal-excerpt">
                            <h4>Full Excerpt:</h4>
                            <p>{selectedResult.chunk_text}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Disclaimer */}
            <div className="disclaimer">
                ⚠️ <strong>Disclaimer:</strong> These excerpts are retrieved from case law judgments.
                They are not legal advice. Always consult the full judgment and seek qualified legal counsel.
                <br /><br />
                Data source: <a href="https://www.hklii.hk" target="_blank" rel="noopener noreferrer">HKLII</a>
            </div>
        </div>
    )
}
