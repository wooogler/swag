# PRELUDE
**Process and Replay for LLM Usage and Drafting Events**

A research tool for tracking and analyzing student writing processes with LLM assistance.

## Overview

PRELUDE captures character-level writing interactions to help educators understand how students use LLM tools during writing assignments. The system records editing patterns, LLM conversations, and copy-paste behaviors, then provides an interactive replay interface for analysis.

## Key Features

### Phase 1: Student Portal ✅
- ✅ **Character-level tracking** - ProseMirror transaction-based recording with snapshots
- ✅ **ChatGPT-like interface** - Multiple conversation threads with editable titles
- ✅ **Copy-paste validation** - Detects and blocks external content, allows chatbot responses
- ✅ **Auto-save** - Batched event storage every 30 seconds or 10 events
- ✅ **Notion-style editor** - BlockNote with full markdown support
- ✅ **Resizable split view** - Adjustable editor/chat panel widths

### Phase 2: Instructor Portal ✅
- ✅ **Magic link authentication** - Email-based login for @vt.edu addresses
- ✅ **Assignment management** - Create assignments with custom system prompts and deadlines
- ✅ **Student progress dashboard** - View all student sessions with word counts and activity
- ✅ **Interactive replay** - Snapshot-based playback of student writing process
- ✅ **Conversation management** - Collapsible list with edit/delete functionality

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

**Student Portal:**
Access via assignment share token:
```
http://localhost:3000/s/[shareToken]
```

**Instructor Portal:**
```
http://localhost:3000/instructor/login
```

**First-time instructors:**
1. Click "Sign Up" tab
2. Enter your @vt.edu email
3. Check email for verification link
4. Click link and set your password
5. Login with email + password

**Returning instructors:**
- Use "Login" tab with email + password
- Session lasts 30 days

## Project Structure

```
prelude/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── s/[shareToken]/  # Student portal
│   │   └── api/             # API routes
│   ├── components/          # React components
│   │   ├── editor/          # Tracked editor
│   │   └── chat/            # Chat interface
│   ├── lib/                 # Utilities
│   │   ├── event-tracker.ts # Transaction tracking
│   │   └── copy-validator.ts # Paste validation
│   └── db/                  # Database
│       ├── schema.ts        # Drizzle schema
│       └── migrations/      # SQL migrations
```

## Development Workflow

1. **Project scaffolding** ✅
2. **Database setup** (Current)
3. **Student access flow**
4. **Editor with transaction tracking**
5. **Chat interface (ChatGPT-like)**
6. **Copy/Paste validation**
7. **UI Polish**
8. **Testing**

## Architecture Highlights

### Character-Level Tracking
Uses ProseMirror's transaction system to capture exact editing operations:
- Insert/delete operations with transaction steps
- Full document snapshots every 5 steps or 10 seconds
- Browser-independent replay capability

### Copy-Paste Detection
- Fuzzy matching (95% similarity threshold) to validate chatbot content
- Blocks external pastes with toast notifications
- Logs internal vs external paste attempts for analysis
- Minimum content length requirements (3 chars for general, 10 for substring, 20 for fuzzy)

### Batched Event Storage
- Client-side queue with debounced saves
- 30-second intervals or 10-event batches
- Force save on page unload
- Visual "Saved" indicator on successful saves

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
