# PRELUDE
**Process and Replay for LLM Usage and Drafting Events**

A research tool for tracking and analyzing student writing processes with LLM assistance.

## Overview

PRELUDE captures character-level writing interactions to help educators understand how students use LLM tools during writing assignments. The system records editing patterns, LLM conversations, and copy-paste behaviors, then provides an interactive replay interface for analysis.

## Key Features

### Phase 1: Student Portal ✅
- ✅ **Character-level tracking** - BlockNote document snapshots every 5 steps or 10 seconds
- ✅ **Rich text editor** - BlockNote with headings, lists, code blocks, and formatting
- ✅ **ChatGPT-like interface** - Multiple conversation threads with editable titles
- ✅ **Copy-paste validation** - Detects and blocks external content, allows chatbot responses
- ✅ **Auto-save** - Batched event storage every 30 seconds or 10 events
- ✅ **Resizable split view** - Adjustable editor/chat panel widths (300-800px)
- ✅ **Assignment instructions** - Toggleable view panel above editor
- ✅ **Real-time chat timestamps** - User messages saved immediately, not after AI response

### Phase 2: Instructor Portal ✅
- ✅ **Email authentication** - One-time email verification, then email+password login
- ✅ **Assignment management** - Create assignments with custom system prompts and deadlines
- ✅ **Student progress dashboard** - View all student sessions with word counts and activity
- ✅ **Interactive replay** - Full-fidelity BlockNote rendering with all block types
- ✅ **Conversation management** - View chat history alongside writing process
- ✅ **Timeline visualization** - Chat messages, paste events, and typing activity markers

## Tech Stack

- **Framework**: Next.js 15 + React 19
- **Editor**: BlockNote 0.42 (Notion-like UX)
- **Chat**: Assistant UI + OpenAI API
- **Database**: PostgreSQL (Vercel Postgres)
- **ORM**: Drizzle ORM
- **Email**: Resend API
- **Deployment**: Vercel (free tier)

## Getting Started

### Prerequisites
- Node.js 18+ or Bun 1.x
- OpenAI API key
- PostgreSQL database (Vercel Postgres for production, local Postgres for dev)

### Installation

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your configuration

# Setup database (requires POSTGRES_URL in .env)
npm run db:generate
npm run db:migrate

# Start development server
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Required variables:
- `POSTGRES_URL` - PostgreSQL connection string (Vercel Postgres or local)
- `OPENAI_API_KEY` - Your OpenAI API key
- `NEXT_PUBLIC_APP_URL` - Application URL
- `JWT_SECRET` - Random secret for authentication (generate with `openssl rand -base64 32`)
- `RESEND_API_KEY` - Resend API key for email verification
- `EMAIL_FROM` - Sender email address (e.g., "PRELUDE <onboarding@resend.dev>")
- `ALLOWED_EMAIL_DOMAINS` - Comma-separated allowed domains (e.g., "vt.edu")

**Email Configuration:**
Using Resend (https://resend.com) for email verification:
- **Development**: Verification links logged to console (no email sent)
- **Production**:
  - Sign up at Resend and get API key
  - Use `onboarding@resend.dev` for testing (100 emails/day free)
  - Verify your own domain for production use

### Accessing the Application

**Root URL:**
- `http://localhost:3000/` - Redirects to instructor login

**Instructor Portal:**
- `http://localhost:3000/instructor/login` - Login/Signup page
- `http://localhost:3000/instructor/dashboard` - Assignment dashboard
- `http://localhost:3000/instructor/replay/[sessionId]` - Student session replay

**Student Portal:**
- `http://localhost:3000/s/[shareToken]` - Assignment landing page
- `http://localhost:3000/s/[shareToken]/editor` - Writing editor with AI chat

**First-time instructors:**
1. Go to `/instructor/login`
2. Click "Sign Up" tab
3. Enter your allowed domain email (configured in `ALLOWED_EMAIL_DOMAINS`)
4. Check email for verification link (or console in development)
5. Click link and set your password
6. Auto-login after password setup

**Returning instructors:**
- Use "Login" tab with email + password
- Session lasts 30 days (JWT cookie)

## Project Structure

```
prelude/
├── src/
│   ├── app/
│   │   ├── page.tsx                          # Root redirect to /instructor/login
│   │   ├── s/[shareToken]/                   # Student portal
│   │   │   ├── page.tsx                      # Assignment landing
│   │   │   └── editor/page.tsx               # Writing interface
│   │   ├── instructor/
│   │   │   ├── login/page.tsx                # Login/Signup
│   │   │   ├── verify/                       # Email verification + password setup
│   │   │   ├── dashboard/page.tsx            # Assignment list
│   │   │   ├── assignments/[id]/page.tsx     # Student sessions
│   │   │   └── replay/[sessionId]/           # Replay viewer
│   │   └── api/
│   │       ├── auth/                         # Authentication endpoints
│   │       ├── chat/route.ts                 # OpenAI streaming chat
│   │       ├── conversations/                # Chat CRUD operations
│   │       └── editor-events/save/route.ts   # Event batching endpoint
│   ├── components/
│   │   ├── editor/
│   │   │   ├── TrackedEditor.tsx             # BlockNote with event tracking
│   │   │   └── EditorClient.tsx              # Editor + chat split view
│   │   └── chat/
│   │       ├── ChatPanel.tsx                 # Chat container with conversations
│   │       └── ChatMessages.tsx              # Message rendering
│   ├── lib/
│   │   ├── event-tracker.ts                  # BlockNote transaction tracking
│   │   ├── copy-validator.ts                 # Paste detection and validation
│   │   ├── auth.ts                           # JWT session management
│   │   └── password.ts                       # bcryptjs password hashing
│   └── db/
│       ├── schema.ts                         # PostgreSQL schema (Drizzle ORM)
│       └── migrations/                       # SQL migration files
```

## Development Status

**Completed:**
- ✅ Full-stack application with Next.js 15 + PostgreSQL
- ✅ Student writing portal with AI chat assistance
- ✅ Instructor dashboard with session replay
- ✅ Email authentication with Resend
- ✅ Vercel deployment configuration
- ✅ Real-time event tracking and replay
- ✅ Copy-paste detection and prevention

**Production Ready:**
- ✅ Deployed on Vercel with PostgreSQL
- ✅ Email verification for instructor signup
- ✅ Session-based authentication (30-day cookies)
- ✅ Environment variable configuration
- ✅ Database migrations

## Architecture Highlights

### Document Tracking System
**BlockNote Editor Integration:**
- Full document snapshots every 5 editor steps or 10 seconds
- Captures all block types: paragraphs, headings, lists, code blocks
- Preserves inline formatting: bold, italic, code, links
- JSON-based document structure for reliable replay

**Event Timeline:**
- User chat messages timestamped at send time (not after AI response)
- Editor snapshots with sequence numbers
- Paste events (internal vs external) with content validation
- All events stored with millisecond-precision timestamps

### Copy-Paste Detection
**Smart Content Validation:**
- Fuzzy matching (95% similarity) to identify AI-generated content
- Allows pasting from AI assistant, blocks external sources
- Toast notifications for blocked paste attempts
- Configurable content length thresholds

**Detection Modes:**
- Exact match: Character-for-character comparison
- Substring match: Finds AI content within larger selections (10+ chars)
- Fuzzy match: Levenshtein distance for edited AI responses (20+ chars)

### Real-Time Event Storage
**Batched Saves:**
- Client-side event queue with automatic batching
- Saves every 30 seconds or after 10 events (whichever comes first)
- Force save on tab close to prevent data loss
- Visual "Saved" indicator for user feedback

**Database Design:**
- PostgreSQL with Drizzle ORM
- Separate tables for editor events and chat messages
- Indexed by session ID and timestamp for fast replay queries
- Foreign key relationships for data integrity

### Interactive Replay
**Full-Fidelity Rendering:**
- Uses same BlockNote editor in read-only mode
- All formatting and block types displayed exactly as written
- Side-by-side editor and chat view
- Timeline scrubbing with visual event markers

**Playback Controls:**
- Variable speed: 0.5x to 10x
- Click timeline to jump to any point
- Pause/resume with keyboard shortcuts
- Color-coded markers for chat, internal paste, external paste attempts

## Production Deployment

### Deploy to Vercel (Recommended)

**Step 1: Prepare GitHub Repository**
```bash
# Ensure all changes are committed
git add -A
git commit -m "Prepare for Vercel deployment"
git push origin main
```

**Step 2: Create Vercel Project**
1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click "Add New" → "Project"
3. Import your GitHub repository
4. Framework Preset: Next.js (auto-detected)
5. Click "Deploy" (initial deployment will fail - database not configured yet)

**Step 3: Create Vercel Postgres Database**
1. In your Vercel project, go to "Storage" tab
2. Click "Create Database" → "Postgres"
3. Name: `prelude-db` (or any name)
4. Region: `iad1` (Washington D.C. - closest to VT)
5. Click "Create"

**Step 4: Configure Environment Variables**
1. Go to "Settings" → "Environment Variables"
2. Add the following variables:

```bash
# Database (automatically added by Vercel Postgres)
POSTGRES_URL=<automatically populated>

# OpenAI
OPENAI_API_KEY=sk-...

# Authentication
JWT_SECRET=<generate with: openssl rand -base64 32>

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=PRELUDE <onboarding@resend.dev>
ALLOWED_EMAIL_DOMAINS=vt.edu

# Application
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app
NODE_ENV=production
```

**Step 5: Run Database Migrations**
```bash
# Connect to Vercel Postgres from local machine
# Get POSTGRES_URL from Vercel dashboard → Storage → your database → .env.local tab
export POSTGRES_URL="postgres://..."

# Run migrations
npm run db:migrate
```

**Step 6: Redeploy**
1. Go to "Deployments" tab
2. Click "Redeploy" on the latest deployment
3. Check "Use existing Build Cache" is off
4. Click "Redeploy"

**Step 7: Verify Deployment**
1. Visit your Vercel URL (e.g., `https://prelude.vercel.app`)
2. Go to `/instructor/login`
3. Test signup and login flow

### Vercel Free Tier Limits
- **Compute**: 60 hours/month (sufficient for research projects)
- **Database**: 256MB PostgreSQL (thousands of assignments)
- **Bandwidth**: 100GB/month
- **Deployments**: Unlimited

### Production Checklist

- [ ] ✅ Push code to GitHub
- [ ] ✅ Create Vercel project
- [ ] ✅ Create Vercel Postgres database
- [ ] ✅ Set environment variables
- [ ] ✅ Run database migrations
- [ ] ✅ Redeploy application
- [ ] 🔲 Test instructor signup/login
- [ ] 🔲 Create test assignment
- [ ] 🔲 Test student portal
- [ ] 🔲 Verify Resend email delivery
- [ ] 🔲 Set up custom domain (optional)
- [ ] 🔲 Configure database backups (Vercel auto-backups included)

## Database Management

```bash
# Generate new migration after schema changes
npm run db:generate

# Apply migrations to database
npm run db:migrate

# View database in Vercel dashboard
# Go to Storage → your database → Data tab

# Or connect with psql locally
psql $POSTGRES_URL
```

## License

MIT

## Contact

For questions or collaboration opportunities, please open an issue on GitHub.
