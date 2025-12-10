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

- **Runtime**: Bun 1.x (10-25x faster than npm)
- **Framework**: Next.js 15 + React 19
- **Editor**: BlockNote 0.42 (Notion-like UX)
- **Chat**: Assistant UI + OpenAI API
- **Database**: SQLite with WAL mode (Bun native)
- **ORM**: Drizzle ORM
- **Deployment**: Docker Compose + Nginx

## Getting Started

### Prerequisites
- Bun 1.x or later
- OpenAI API key

### Installation

```bash
# Install dependencies
bun install

# Setup database
bun run db:generate
bun run db:migrate
bun run db:seed

# Start development server
bun run dev
```

### Environment Variables

Copy `.env.example` to `.env` and update the values:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL` - SQLite file path (dev) or PostgreSQL URL (prod)
- `OPENAI_API_KEY` - Your OpenAI API key
- `NEXT_PUBLIC_APP_URL` - Application URL
- `JWT_SECRET` - Random secret for authentication (generate with `openssl rand -base64 32`)

Email configuration (for email verification):
- **Development**: Email not required - verification links are logged to console
- **Production**: Using Resend (https://resend.com)
  - Sign up and get API key
  - Set `RESEND_API_KEY` and `EMAIL_FROM` in `.env`
  - Free tier: 100 emails/day (sufficient for instructor registration)

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

### Build and Test

```bash
# Type check
bun run type-check

# Build for production
bun run build

# Test production build locally
bun run start
```

### Deployment Options

**Option 1: Vercel (Recommended)**
1. Push to GitHub
2. Import project to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

**Option 2: Docker**
```bash
# Build image
docker build -t prelude .

# Run container
docker run -p 3000:3000 --env-file .env prelude
```

**Option 3: Self-hosted**
```bash
# Build
bun run build

# Start with PM2
pm2 start "bun run start" --name prelude

# Or with systemd
sudo systemctl start prelude
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Generate secure `JWT_SECRET` (`openssl rand -base64 32`)
- [ ] Configure SMTP for production email
- [ ] Update `NEXT_PUBLIC_APP_URL` to production domain
- [ ] Set up PostgreSQL (optional, for scale)
- [ ] Enable HTTPS/SSL
- [ ] Configure rate limiting for API routes
- [ ] Set up monitoring/logging
- [ ] Regular database backups

## Database Management

```bash
# Generate new migration
bun run db:generate

# Apply migrations
bun run db:migrate

# View database (SQLite)
sqlite3 data/prelude.db
```

## License

MIT

## Contact

For questions or collaboration opportunities, please open an issue on GitHub.
