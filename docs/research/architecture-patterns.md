# Architecture Patterns & Decisions

*Research completed 2026-03-19*

## Separate Supabase Project vs Shared

### Current Decision: Separate Projects
- Pre-reg: project `vwfrmhbczwpvqonlpfzs`
- FeisTab Phase 1: project `acxyvouzwgvobtbmvoej`

### Trade-offs

**Separate projects (current approach):**
- Pros: Isolated auth/RLS, independent migrations, separate data sensitivity classes, independent scaling
- Cons: "Launch Feis Day" becomes a distributed systems problem, auth duplicated, no transactional integrity crossing the boundary

**Single project with schema separation (alternative):**
- Pros: Cross-schema queries are just SQL (no network hop), one auth pool, transactional "Launch Feis Day", one migration timeline
- Cons: Migration churn from both systems in one timeline, shared scaling

### Bridge Implications
With separate projects, the bridge (sub-project 3) must:
- Export data via API or Edge Function
- Handle partial failure gracefully
- Cannot use database transactions across the boundary
- May need to use Supabase Edge Functions with service_role keys for both projects

---

## Wizard Routing

### Recommendation: Client-Side Step State with Single URL

The plan uses `/organiser/feiseanna/[id]/setup` with client-side step state. This is appropriate because:
- The wizard creates a draft on step 1 and enriches through subsequent steps
- Each step saves to the database — no client-side-only state
- Browser back/forward can be handled with `history.pushState` or hash fragments
- Users can abandon and return (draft is in the database)
- "Edit Feis" is just the wizard reopened on existing draft

### Alternative: URL-Based Steps
```
/organiser/feiseanna/[id]/setup/details
/organiser/feiseanna/[id]/setup/syllabus
/organiser/feiseanna/[id]/setup/fees
/organiser/feiseanna/[id]/setup/deadlines
/organiser/feiseanna/[id]/setup/review
```
Pros: Native browser back/forward, bookmarkable, each step can be a server component.
Cons: More files, more routing complexity.

---

## Complex Operations: Server Actions vs API Routes vs Edge Functions

| Operation | Recommendation | Why |
|-----------|---------------|-----|
| Clone feis | Server Action | User-initiated, needs auth context, redirects after |
| Expand syllabus | Server Action or SQL function | CPU-bound expansion, batch insert |
| Transition status | Server Action | Same pattern as existing `canTransition()` |
| Close registration (time-based) | Edge Function + pg_cron | No user interaction, runs on schedule |
| Stripe webhook | API Route | External caller, needs raw request body |
| Launch Feis Day | SQL function via Server Action or Edge Function | Must be reliable, touches many tables |

---

## Batch Operations

When expanding a syllabus template generates 100-160 competition rows:

### Supabase Batch Upsert
```typescript
const { data, error } = await supabase
  .from('feis_competitions')
  .upsert(competitions, {
    onConflict: 'feis_listing_id,age_group_key,...',
    ignoreDuplicates: false
  })
```
Single SQL statement: `INSERT INTO ... VALUES (...), (...) ON CONFLICT DO UPDATE`
160 rows in one statement completes in under 100ms.

### Chunking (if needed for >1000 rows)
```typescript
const CHUNK_SIZE = 500
for (let i = 0; i < competitions.length; i += CHUNK_SIZE) {
  await supabase.from('feis_competitions').upsert(competitions.slice(i, i + CHUNK_SIZE))
}
```

---

## Shared Design System

### Current Approach: Copy-paste with convention
Copy `globals.css`, font setup, and shadcn components from FeisTab. Maintain convention: "pre-reg UI comes from FeisTab."

### Future: Turborepo monorepo
When maintaining two apps in earnest, migrate to:
```
feistab-platform/
  apps/
    feistab/          (day-of)
    prereg/           (pre-registration)
  packages/
    ui/               (shared shadcn components)
    tailwind-config/  (shared CSS variables)
```

---

## Optimistic UI

### Wizard Saves: No Optimistic UI
Steps are sequential and dependent. If step 2 fails optimistically and user is on step 3, you have to yank them back. Worse than waiting 200ms.

Pattern: **Disable-and-Confirm**
- Button shows "Saving..." and is disabled during save
- On failure, form state preserved, error toast
- On success, redirect to next step

### Where Optimistic IS Appropriate
Within a step for direct manipulation:
- Toggle competition on/off in syllabus picker
- Drag-and-drop reorder competitions
- Inline-edit competition name
