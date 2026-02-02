# HK Legal Case Search

AI-powered semantic search through 5,000+ Hong Kong legal judgments.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)
![Supabase](https://img.shields.io/badge/Supabase-pgvector-green)
![AI](https://img.shields.io/badge/AI-DeepSeek_R1-red)

## ✨ Features

- 🔍 **Semantic Search** - Find relevant cases by meaning, not just keywords
- 🤖 **AI Analysis** - Get AI-generated summaries with proper citations (DeepSeek-R1)
- 🏛️ **Court Filtering** - Filter by CFA, CA, CFI, or DC
- 📜 **Search History** - Access your recent searches instantly
- 📄 **HKLII Links** - Direct links to full judgments
- ⚡ **Fast** - Sub-2-second response times
- 🔒 **Secure** - All API keys server-side only
- 📱 **Responsive** - Works on desktop and mobile

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend | Next.js 14 (App Router) |
| Styling | CSS (Custom Design System) |
| Vector DB | Supabase pgvector |
| Embeddings | OpenAI-compatible (iFlow) |
| AI Model | DeepSeek-R1 via iFlow |
| Hosting | Vercel |

## 📁 Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── search/      # Main search endpoint
│   │   │   └── route.ts # Semantic + AI search
│   │   ├── stats/       # Database statistics
│   │   │   └── route.ts
│   │   └── case/        # Case details
│   │       └── route.ts
│   ├── globals.css      # Styling
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Main search UI
├── .env.example         # Environment template
└── .env.local           # Your keys (git-ignored)
```

## 🚀 Setup

### 1. Clone Repository

```bash
git clone https://github.com/Readyyeahgoooo/Cabase.git
cd Cabase
npm install
```

### 2. Environment Variables

Create `.env.local`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
IFLOW_API_KEY=your-iflow-api-key
IFLOW_API_URL=https://apis.iflow.cn/v1
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 🌐 Deploy to Vercel

1. Push to GitHub
2. [Import to Vercel](https://vercel.com/new)
3. Add environment variables in Vercel dashboard
4. Deploy! 🎉

## 🔐 Security

- ✅ All API keys stored in environment variables
- ✅ Server-side API routes only (no client exposure)
- ✅ `.env.local` is git-ignored
- ✅ No secrets in client-side code

## 📊 API Endpoints

### POST `/api/search`
Search for relevant case law chunks.

**Request:**
```json
{
  "query": "What is the test for negligence?",
  "court": "hkcfa"  // optional
}
```

**Response:**
```json
{
  "query": "...",
  "results": [...],
  "aiAnswer": "Based on the sources...",
  "timeTaken": 1.23
}
```

### GET `/api/stats`
Get database statistics.

### GET `/api/case?id=123`
Get full case details by ID.

## 📝 License

Private - For demonstration purposes only.

## 🙏 Acknowledgments

- Data source: [HKLII](https://www.hklii.hk)
- Embeddings: [BGE-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5)
- AI: [DeepSeek](https://deepseek.com)
