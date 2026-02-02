# HK Legal Case Search

AI-powered semantic search through 5,000+ Hong Kong legal judgments.

## Features

- 🔍 **Semantic Search** - Find relevant cases by meaning, not just keywords
- 🤖 **AI Analysis** - Get AI-generated summaries with citations
- ⚡ **Fast** - Sub-2-second response times
- 🔒 **Secure** - All API keys server-side only

## Tech Stack

- **Frontend**: Next.js 14 (App Router)
- **Vector DB**: Supabase pgvector
- **Embeddings**: OpenAI-compatible (iFlow)
- **AI**: DeepSeek-R1 via iFlow
- **Hosting**: Vercel

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/YOUR_USERNAME/hk-legal-search.git
cd hk-legal-search
npm install
```

### 2. Environment Variables

Create `.env.local`:

```env
SUPABASE_URL=your-supabase-url
SUPABASE_ANON_KEY=your-supabase-key
IFLOW_API_KEY=your-iflow-key
IFLOW_API_URL=https://apis.iflow.cn/v1
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push to GitHub
2. Import to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy!

## Security

- ✅ All API keys stored in environment variables
- ✅ Server-side API routes only
- ✅ No client-side key exposure
- ✅ `.env.local` is git-ignored

## License

Private - For demonstration purposes only.
