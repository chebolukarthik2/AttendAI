# AttendAI

A web-based attendance management system built with Vite + React (frontend) and Supabase (backend + database). The frontend is deployed on Vercel and the backend is managed via Lovable.

## Tech Stack

- **Frontend** — HTML, CSS, JavaScript, React, TypeScript, Tailwind CSS, shadcn/ui
- **Backend** — Supabase (PostgreSQL database, Auth, Edge Functions, Storage)
- **Deployment** — Vercel (frontend), Supabase Cloud (backend)
- **Built with** — Vite, Lovable

## Features

- Student and faculty login / registration with voice sample enrollment
- Voice check-in — two-layer verification (speech-to-text + voice biometric via Edge Function)
- Geo-fence verification — confirms student is within 50 m of classroom before check-in
- Manual attendance entry (faculty/admin only)
- Course management
- Student and faculty management
- Attendance reports with CSV export
- Role-based access (student / faculty / admin)
- Real-time dashboard
- PWA support — installable on mobile and desktop

## Project Structure

```
support-main/
├── public/               # Main app pages (HTML/CSS/JS)
│   ├── js/
│   │   └── api.js        # Supabase API layer
│   ├── icons/            # PWA icons
│   ├── manifest.json     # PWA manifest
│   ├── attendance.html
│   ├── dashboard.html
│   ├── courses.html
│   ├── students.html
│   ├── report.html
│   ├── login.html
│   └── ...
├── src/                  # React/TypeScript shell
│   └── integrations/
│       └── supabase/     # Supabase client + generated types
├── supabase/
│   ├── functions/
│   │   ├── manage-users/   # User management Edge Function
│   │   └── verify-voice/   # Voice biometric Edge Function
│   └── migrations/         # Database migrations
├── vercel.json           # SPA routing config for Vercel
├── vite.config.ts
└── package.json
```

## Deployment

### Frontend — Vercel

1. Push this repo to GitHub
2. Import the repo in [vercel.com](https://vercel.com)
3. Set **Root Directory** to `support-main`
4. Set **Framework Preset** to Vite
5. Add the Supabase environment variables in Vercel → Settings → Environment Variables
6. Click Deploy

### Backend — Lovable + Supabase

The backend (database, auth, edge functions, storage) is managed through Lovable and hosted on Supabase Cloud. Any backend changes should be made in Lovable — they automatically sync to Supabase and the frontend picks them up without redeployment.

## Voice Check-in

Voice check-in uses a two-layer verification system:

**Layer 1 — Speech-to-Text (browser built-in)**
Uses the Web Speech API to transcribe what the student says in real time. Checks the transcript contains their name and roll number. Fuzzy matching handles mispronunciations.

**Layer 2 — Voice Biometric (Supabase Edge Function)**
Uploads the audio to Supabase Storage and calls the `verify-voice` Edge Function, which compares it against the enrolled voice sample from registration. Supports Azure Speaker Recognition (production) or a built-in fallback heuristic.

> **Note:** Speech-to-text works on Chrome and Edge only. Firefox and Safari fall back to biometric-only mode. All browsers and mobile devices are supported for audio recording.

### Setting up Voice Biometric for Production (optional)

1. Go to [portal.azure.com](https://portal.azure.com) → Create resource → **Speaker Recognition** → Free F0 tier
2. Copy your **Key** and **Region**
3. In Supabase Dashboard → Settings → Edge Functions → Secrets, add:
   - `AZURE_SPEAKER_KEY` = your key
   - `AZURE_SPEAKER_REGION` = e.g. `centralindia`

## Workflow — Making Changes

| Change type | Where to make it |
|---|---|
| UI, pages, frontend logic | Edit files locally → push to GitHub → Vercel auto-deploys |
| New database table / column | Lovable |
| New Edge Function | Lovable |
| RLS / auth policies | Lovable / Supabase dashboard |
| Voice biometric secrets | Supabase Dashboard → Settings → Edge Functions |
