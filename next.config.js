/** @type {import('next').NextConfig} */
const nextConfig = {
    // Ensure API routes are server-side only (secure)
    experimental: {
        serverActions: {
            bodySizeLimit: '2mb',
        },
    },
}

module.exports = nextConfig
