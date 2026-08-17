# Axoura — Supabase account setup

The onboarding sign-up (email + Google) already works **locally** with no setup —
accounts are saved in the browser. To store accounts in a real backend and enable
**Google sign-in**, connect Supabase (free tier is fine). ~10 minutes.

---

## 1. Create the project
1. Go to <https://supabase.com> → **New project**. Pick a name + database password.
2. When it finishes provisioning, open **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key
3. In the project folder, copy the template and paste your values:
   ```bash
   cp supabase-config.example.js supabase-config.js
   ```
   ```js
   // supabase-config.js  (gitignored — never committed)
   window.SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi...your-anon-key...";
   ```
   > Both values are **public** and safe in the browser. Data is protected by the
   > Row Level Security policies you add in step 2.

## 2. Create the `profiles` table + security policies
Open **SQL Editor** in Supabase, paste this, and click **Run**:

```sql
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  name        text,
  motivation  text,
  improve     text,
  age         text,
  level       text,
  goal        text,
  subject     text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

-- Email sign-ups (anonymous): may create a row, but not read/change others'.
create policy "anon can insert profiles"
  on public.profiles for insert to anon with check (true);

-- Google sign-ins (authenticated): can create/update/read only their own row.
create policy "users manage their own profile"
  on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
```

## 3. Enable Google sign-in
1. In Supabase: **Authentication → Providers → Google → Enable**.
2. Create Google OAuth credentials (Google Cloud Console → **APIs & Services →
   Credentials → Create credentials → OAuth client ID → Web application**):
   - **Authorized redirect URI:** the callback shown on the Supabase Google page,
     i.e. `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client secret** into the Supabase Google form and
     **Save**.
3. In Supabase: **Authentication → URL Configuration**, add your app URLs to
   **Redirect URLs** (one per line):
   ```
   http://localhost:3006/dashboard.html
   http://localhost:3006/*
   ```
   Set **Site URL** to `http://localhost:3006`. (Add your production domain here too
   when you deploy.)

## 4. Test
- Restart nothing — just reload `http://localhost:3006/onboarding.html`, finish the
  flow, and on the last screen:
  - **Email + Sign up** → a row appears in **Table Editor → profiles**.
  - **Continue with Google** → Google popup → back to the dashboard; a row appears in
    profiles and a user in **Authentication → Users**.

---

### How it behaves
- **No `supabase-config.js` values** → local-only mode (account saved in the browser).
- **Configured** → email sign-ups insert into `profiles`; Google uses Supabase Auth
  and upserts the signed-in user's `profiles` row with their onboarding answers.

### Notes
- The onboarding answers (name, motivation, improve area, age, level, daily goal,
  first subject) are attached to the account row.
- For production, tighten the anon insert policy (e.g. rate-limit / captcha) and add
  your live domain to the redirect URLs.
