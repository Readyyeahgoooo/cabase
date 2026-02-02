import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
    title: 'HK Legal Case Search',
    description: 'AI-powered semantic search through Hong Kong case law',
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    )
}
