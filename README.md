# ScamVideo Studio — Project Requirements

## Objective
Build and maintain **ScamVideo Studio** as a **fully working full-stack web application** that is deployable on **Render.com Free Tier**, with reliable persistence, efficient background processing, and end-to-end functional Settings workflows.

---

## 1) Deployment & Runtime Constraints (Render Free Tier)

### Required outcomes
- The full application (frontend + backend + file-based persistence) must run reliably within Render Free Tier limits.
- Background processing must run **only when active schedules exist**.
- The system must avoid unnecessary CPU usage (no always-on busy loops / no constant polling when idle).
- On service restart, the backend must:
  - reload schedules from file-based storage,
  - restore scheduler state,
  - continue scheduled processing correctly.

### Acceptance criteria
- App starts successfully on Render Free Tier with documented environment configuration.
- Scheduler is idle when no schedules are configured.
- Existing schedules survive restart and resume automatically.

---

## 2) Settings Module (Fully Functional + Persistent)

All Settings UI controls and actions must be wired to real backend APIs and persistent file-based storage. No placeholder or mock behavior is acceptable.

### 2.1 Unlimited API Key Management (Required)

Implement complete key management for:
- **Cerebras API Keys**
- **UnrealSpeech API Keys**
- **Cloudflare Workers AI Keys**

#### Functional requirements
- Users can **add, view, edit, and delete unlimited keys** per provider.
- Keys are saved permanently in file-based storage.
- API key label/name is optional:
  - If omitted, auto-generate a readable label (e.g., `Key #3`) or masked suffix-based name.

#### Runtime behavior requirements
- Requests must use provider keys with **round-robin rotation**.
- On key failure, the system must **automatically fail over** to the next available key.
- Key deletion must remove the key from:
  - persistent storage,
  - in-memory runtime rotation pool,
  - immediate subsequent request selection.

#### Visibility / observability requirements
For each key, the UI must display:
- success count,
- failure count,
- last used timestamp.

---

### 2.2 Facebook Page Connection (Required)

In **Settings → Facebook Pages**:
- Provide input for **Facebook Page Access Token**.
- On save, backend must automatically:
  1. validate token,
  2. call Facebook Graph API,
  3. fetch associated pages,
  4. return and persist connected page records.

#### UI requirements
- “Connected Pages” must update immediately after successful save.
- Each connected page entry must show:
  - page name,
  - page ID,
  - token status (`valid` / `expired`).
- Users can remove a connected page; removal must be immediate in both UI and file storage.

---

### 2.3 Catbox Upload Configuration (Required)

In **Settings → Catbox**:
- Provide input for **Catbox User Hash**.
- Save and load this value from file-based storage.
- Backend upload pipeline must use this stored hash for later Facebook-posting media upload flow (images and videos).

---

## 3) End-to-End Quality Requirements

### Functional completeness
- Every Settings action must work end-to-end:
  - Add
  - Save
  - Edit
  - Delete
  - Connect
  - Remove
  - Refresh

### Integration correctness
- Provider services must use stored keys at runtime without missing-key regressions.
- Settings data and core site behavior must be backed by real backend endpoints.
- All persisted configuration must survive restart via file-based storage.

### Non-goals / scope guard
- Keep implementation focused on delivering a robust, deployable full-stack app.
- Avoid introducing unrelated features that do not improve required deployment reliability or Settings completeness.


## Supabase API Key Storage

API keys are now stored in Supabase (table: `api_keys`) instead of file-based JSON.

Required environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Create table SQL:

```sql
create table if not exists public.api_keys (
  id text primary key,
  provider text not null,
  name text not null,
  key text not null,
  last_used timestamptz null,
  success_count integer not null default 0,
  fail_count integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_provider on public.api_keys(provider);
```


## 2) Settings Module (Fully Functional + Persistent)

All Settings UI controls and actions must be wired to real backend APIs and persistent file-based storage. No placeholder or mock behavior is acceptable.

### 2.1 Unlimited API Key Management (Required)

Implement complete key management for:
- **Cerebras API Keys**
- **UnrealSpeech API Keys**
- **Cloudflare Workers AI Keys**

#### Functional requirements
- Users can **add, view, edit, and delete unlimited keys** per provider.
- Keys are saved permanently in file-based storage.
- API key label/name is optional:
  - If omitted, auto-generate a readable label (e.g., `Key #3`) or masked suffix-based name.

#### Runtime behavior requirements
- Requests must use provider keys with **round-robin rotation**.
- On key failure, the system must **automatically fail over** to the next available key.
- Key deletion must remove the key from:
  - persistent storage,
  - in-memory runtime rotation pool,
  - immediate subsequent request selection.

#### Visibility / observability requirements
For each key, the UI must display:
- success count,
- failure count,
- last used timestamp.

---

### 2.2 Facebook Page Connection (Required)

In **Settings → Facebook Pages**:
- Provide input for **Facebook Page Access Token**.
- On save, backend must automatically:
  1. validate token,
  2. call Facebook Graph API,
  3. fetch associated pages,
  4. return and persist connected page records.

#### UI requirements
- “Connected Pages” must update immediately after successful save.
- Each connected page entry must show:
  - page name,
  - page ID,
  - token status (`valid` / `expired`).
- Users can remove a connected page; removal must be immediate in both UI and file storage.

---

### 2.3 Catbox Upload Configuration (Required)

In **Settings → Catbox**:
- Provide input for **Catbox User Hash**.
- Save and load this value from file-based storage.
- Backend upload pipeline must use this stored hash for later Facebook-posting media upload flow (images and videos).

---

## 3) End-to-End Quality Requirements

### Functional completeness
- Every Settings action must work end-to-end:
  - Add
  - Save
  - Edit
  - Delete
  - Connect
  - Remove
  - Refresh

### Integration correctness
- Provider services must use stored keys at runtime without missing-key regressions.
- Settings data and core site behavior must be backed by real backend endpoints.
- All persisted configuration must survive restart via file-based storage.

### Non-goals / scope guard
- Keep implementation focused on delivering a robust, deployable full-stack app.
- Avoid introducing unrelated features that do not improve required deployment reliability or Settings completeness.
