# Parent Registration UX Research: Best-in-Class Patterns

*Research completed 2026-03-19*

This report analyzes registration experiences across youth sports, dance competitions, race events, and kids' activity platforms to identify patterns FeisTab should adopt, adapt, or leapfrog.

---

## 1. Best-in-Class Registration Flows

### The Gold Standard: Sawyer (Kids' Activities)

Sawyer is the benchmark for parent registration UX. Built by parents, for parents.

**What makes it great:**
- **Family profile is the foundation.** Parents create one account with children's details (name, DOB, allergies, payment info). That profile follows them across every provider on the platform.
- **Repeat booking is effortless.** The profile pre-fills everything. Returning families register in under a minute.
- **"My Schedule" dashboard** — color-coded by child, syncs to Google/Apple Calendar.
- **Marketplace discovery** — classes searchable and filterable by location, age, day, time, category. Parents find and book in the same flow.
- **Modern, clean UI** — described by users as "modern and fun with an upscale look and feel." Mobile-first from the ground up.

**FeisTab takeaway:** Sawyer proves that a beautiful, parent-first experience creates loyalty. Parents will choose platforms that respect their time. The family profile as the atomic unit is the right architecture.

### TeamSnap (Youth Sports)

**What makes it great:**
- **Mobile-first registration** — parents complete everything from phones, reducing drop-off.
- **Digital agreements** — waivers, terms of service signed online during registration. No paper.
- **TeamSnap ONE (launched Nov 2025)** — unified platform where every schedule, message, live stream, and highlight lives in one app. Testimonials call registration "smooth" and the system "intuitive."
- **Saved profiles** — player information stored for future registrations.

**What's weak:**
- Designed for teams/seasons, not individual competition entries. The "select multiple competitions per dancer" pattern doesn't exist.
- No multi-child cart with running totals — it's one athlete at a time.

**FeisTab takeaway:** TeamSnap's strength is the unified post-registration experience (schedule, messages, highlights in one app). FeisTab should aspire to this for the post-registration period — don't just confirm, become the parent's companion app for the feis.

### SportsEngine (Youth Sports)

**What makes it great:**
- **Household model** — one account owner manages multiple child profiles ("sub-profiles"). Additional guardians can be invited with specific permissions (RSVP, message, view schedule).
- **Registration pre-fills** — information provided during first registration populates subsequent sign-ups.
- **One profile per athlete** — enforced globally to prevent duplicate records and technical issues.
- **Guardian permission tiers** — account owner has full control; invited guardians get view/RSVP/message access but cannot edit financial data.

**What's weak:**
- Clunky for multi-parent households (divorce/shared custody). "The parent who started registration owns the child and must share them" — this creates friction.
- Interface is functional but not beautiful.

**FeisTab takeaway:** The household/guardian model is essential. But handle shared custody gracefully — invitation model where either parent can be granted access, with no adjudication of custody disputes. SportsEngine's pain point here is our opportunity.

### DanceComp Genie (Dance Competitions)

**What makes it great:**
- **Studio Passport account** — stores dancers, teachers, routines, and studio info in one place. Transfer data across any competition using DanceComp Genie without re-entry.
- **Registration steps are clear:** Step 1: Who and Where → Step 2: Add Routines → Step 3: Check Out.
- **Cross-competition portability** — information entered once travels to every DanceComp Genie event.
- **24/7 access** — studios can add/modify dances, manage info, make payments anytime.

**What's weak:**
- Studio-centric, not parent-centric. The studio registers on behalf of families. Parents don't have direct accounts in most implementations.
- Interface is dated (ASP.NET-era design).

**FeisTab takeaway:** The "enter once, use everywhere" pattern is critical. But FeisTab should be parent-direct (parents own their accounts and data), not studio-mediated. The studio-as-gatekeeper model is a relic of paper-era Irish dance.

### CompetitionSuite (Dance/Cheer)

**What makes it great:**
- **Single dashboard** for registration, scheduling, and running events.
- **Judges score on tablets** — recaps generate instantly, results ready when last performance ends.
- **Live scores** — parents follow along from anywhere. Real-time public recaps.
- **Audio commentary** accessible immediately after events.

**What's weak:**
- More focused on the event-day experience than the registration flow itself.
- Registration is functional but not standout.

**FeisTab takeaway:** CompetitionSuite validates the "instant results + live scoring" model that FeisTab Phase 1 already delivers. The lesson is that parents value real-time transparency above almost everything else.

### RunSignup (Race Registration)

**What makes it great:**
- **70%+ of views are mobile** — entire experience designed mobile-first.
- **Apple Pay checkout** — registered in under 30 seconds on iPhone.
- **Fee transparency** — signup fee shown upfront by default. Total cost always visible.
- **Saved profiles** for repeat participants — pre-fills name, address, emergency contact.
- **Repeat participant reports** — race directors can see who comes back year after year.
- **On-site registration** — same system works at the venue on race day.

**What's weak:**
- Designed for individual registrants, not family/multi-participant.
- No "household" concept — each runner is an independent account.

**FeisTab takeaway:** Apple Pay / Google Pay must be day-one for FeisTab. RunSignup proves that payment speed is a conversion lever. Their fee transparency approach (show the fee upfront, not as a surprise at checkout) matches the FTC direction and builds trust.

### Eventbrite (General Events)

**What makes it great:**
- **Two-click registration** for returning users.
- **Deferred data collection** — asks attendees extra questions AFTER registration is confirmed, not before. This dramatically improves conversion.
- **Ticket sections** — group ticket types visually (e.g., "Grade Levels" section, "Championship" section).
- **Per-attendee data collection** — can collect name/email per ticket, or only for the buyer.

**What's weak:**
- Not designed for competition registration (no eligibility filtering, no skill levels).
- No family/household model.
- Multi-attendee registration is awkward (add one at a time).

**FeisTab takeaway:** The "defer non-essential questions" pattern is powerful. Collect only what's needed to confirm the registration, then ask for waivers/medical/emergency info in a follow-up step or email. Don't block checkout with paperwork.

### LeagueApps (Youth Sports)

**What makes it great:**
- **Family accounts** with parent-child relationships. Multiple children, multiple parents/supervisors.
- **Reduced registration steps** — explicitly designed to minimize clicks to completion.
- **Stored credit cards** for faster future sign-ups.
- **Credits and discount codes** redeemable at checkout.

**What's weak:**
- Discount codes can't stack (only one per registration). Sibling discounts require workarounds with "Private Payment Plan Codes."
- Not designed for multi-event selection within a single registration.

**FeisTab takeaway:** Family discount/cap logic must be automatic, not coupon-based. Parents should never need to enter a code to get the family cap. The system should calculate it and show "Family cap applied — you saved $X."

---

## 2. "Register Again" / Returning Family Patterns

### The Spectrum of Repeat Registration

| Platform | Approach | Friction Level |
|----------|----------|---------------|
| **Sawyer** | Profile pre-fills everything. One-tap rebooking. | Lowest |
| **DanceComp Genie** | Studio Passport carries dancers/routines across events. | Low |
| **RunSignup** | Saved profile pre-fills personal info. Must re-select event/distance. | Medium |
| **SportsEngine** | Sub-profiles persist. Re-select program each season. | Medium |
| **TeamSnap** | Saved player info. Must re-register per season. | Medium |
| **LeagueApps** | Family account persists. Stored credit card. Must re-register. | Medium |
| **FeisWeb** | Family account exists but no "register again" shortcut. Full re-selection each feis. | High |

### The "Register Again" Gold Pattern

The killer implementation (described in existing research, validated by Sawyer and DanceComp Genie):

1. **Email trigger** — 2-4 weeks before registration opens, email last year's registrants: "Registration for [Feis Name] 2027 opens March 1. Your dancers' profiles are ready."
2. **Personalized link** — takes parent directly to a pre-filled registration:
   - Dancer profiles already loaded (name, DOB, school, level — with "confirm or update" prompt)
   - Last year's competition selections pre-checked (with visual diff: "Same as last year" / "New this year" / "No longer offered")
   - Payment method on file
3. **Review and adjust** — parent unchecks/adds competitions, confirms details
4. **One-click checkout** — saved payment method, familiar total format
5. **Confirmation** — "You're registered! Here's what changed from last year."

**Why this matters for Irish dance:** Feis families are creatures of habit. The same family enters the same 4-6 feiseanna every year, often selecting the same dances. A "register again" flow that pre-fills last year's selections could reduce registration time from 15 minutes to 2 minutes. This is the single highest-impact UX feature for returning families.

### Profile Persistence Patterns

**What to save permanently (until parent updates):**
- Parent name, email, phone
- Payment method (tokenized via Stripe)
- Each dancer: name, DOB, gender, school/studio, current level
- Emergency contact
- Medical notes / allergies
- Waiver acceptance (with expiry — re-sign annually)

**What to carry forward per event (editable):**
- Competition selections from last year at this feis
- Level (may have advanced since last year — prompt for confirmation)

**What to reset each event:**
- Payment status
- Competition numbers
- Schedule/stage assignments

---

## 3. Eligibility Filtering

### How Platforms Handle Filtering

| Platform | Approach | UX Pattern |
|----------|----------|------------|
| **Jumbula** | Auto-blocks ineligible programs based on child's age/grade | Gate: can't even see ineligible options |
| **National Sports ID** | AI-verified age/grade before event | Pre-verification, not during registration |
| **FeisWorx** | "Limits competition choices" to reduce scroll fatigue | Filtered list based on dancer profile |
| **DanceComp Genie** | Studio selects from available categories | Manual selection, no auto-filter |
| **SportsEngine** | Age calculated at registration, allows or blocks | Gate at registration time |
| **Eventbrite** | No eligibility filtering | Shows everything |

### The Right Pattern for Irish Dance

Irish dance has a two-dimensional eligibility matrix: **age group** (calculated from DOB and competition date) AND **level** (Beginner through Open Championship). Both must be correct.

**Recommended approach — Smart Filter with Override:**

1. **Auto-calculate age group** from dancer's DOB and the feis date. Show the calculated group prominently: "Siobhan is Under 12 for this feis."
2. **Filter competitions to dancer's level and age group by default.** Show only eligible competitions. This is 6-8 dances, not 100+.
3. **Allow "Show all competitions" toggle** for edge cases (teacher-approved level changes, exhibition entries).
4. **Visual grouping** — group available competitions by dance type (Reel, Light Jig, Slip Jig, etc.) within the filtered set.
5. **Level confirmation prompt** — if dancer was Novice last year but Prizewinner this year, prompt: "Has Siobhan advanced to Prizewinner? [Yes / Not yet]" This prevents accidental wrong-level entry.
6. **Validation gate at checkout** — if any selection looks wrong (e.g., Open Championship for a Beginner), warn before payment.

**Why this matters:** The #1 registration error in Irish dance is entering the wrong level. Teachers catch some of these (FeisWorx gives teachers approval access). FeisTab should make wrong-level entry nearly impossible through smart defaults while still allowing manual override.

---

## 4. Fee Transparency During Registration

### How Platforms Show Pricing

| Platform | When Total Shown | Running Total | Itemized | Discount Display |
|----------|-----------------|---------------|----------|-----------------|
| **RunSignup** | During selection | Yes | Yes | Fee shown upfront by default |
| **Eventbrite** | At checkout | No running total during selection | Yes at checkout | Coupon code field |
| **LeagueApps** | At checkout | Limited | Yes | Discount codes at checkout |
| **TeamSnap** | During registration | Yes | Yes | Automatic |
| **Sawyer** | During booking | Yes | Yes | Packages shown |
| **FeisWeb** | At checkout only | No | Minimal | Not shown |

### The Gold Standard Pattern

Based on research and FTC direction (all-in pricing becoming the expectation):

```
┌─────────────────────────────────────────────────┐
│  YOUR CART                              $74.60  │  ← Sticky footer on mobile
│  3 dances, 2 dancers  ·  View details ▾        │
└─────────────────────────────────────────────────┘

Expanded view:
┌─────────────────────────────────────────────────┐
│  Siobhan O'Brien (Under 12)                     │
│    ☑ Reel                              $15.00   │
│    ☑ Slip Jig                          $15.00   │
│    ☑ Treble Jig                        $15.00   │
│                              Subtotal: $45.00   │
│                                                 │
│  Liam O'Brien (Under 10)                        │
│    ☑ Reel                              $15.00   │
│                              Subtotal: $15.00   │
│                                                 │
│  ─────────────────────────────────────────────  │
│  Event fee (per family)                $30.00   │
│  Family cap applied                   -$15.40   │  ← Green, with explanation
│  Processing fee (3.2%)                  $2.39   │  ← Shown, not hidden
│  ─────────────────────────────────────────────  │
│  TOTAL                                 $76.99   │
│                                                 │
│  💡 Add 1 more dance to save $5                 │  ← Next discount threshold
│  with the multi-dance discount                  │
│                                                 │
│  [Continue to Payment →]                        │
└─────────────────────────────────────────────────┘
```

### Key Rules

1. **Sticky running total** — always visible as parent adds/removes competitions. On mobile, this is a fixed footer bar showing total + item count. Tap to expand.
2. **Itemize by dancer** — each dancer's selections are a separate section.
3. **Show discounts proactively** — "Family cap applied — you saved $15.40" in green. Don't make parents wonder if they got the discount.
4. **Show the next discount threshold** — "Add 1 more dance to save $5" creates positive urgency, not dark-pattern urgency.
5. **Processing fee visible from the start** — never surprise at checkout. The FTC Junk Fees Rule (May 2025) applies to audience events, but the principle applies everywhere. Trust is the product.
6. **Total at checkout must match or be lower** than what was shown during selection. Never higher.
7. **Late fee clearly labeled** — if registration is in the late period, show the surcharge per line item, not buried.

---

## 5. Mobile Registration UX

### The Data

- **70%+ of RunSignup traffic** is mobile
- **Apple Pay users complete registration in under 30 seconds**
- **Multi-step forms show 18% higher conversion** than single-page forms (Instapage)
- **Bottom sheets get 25-30% higher engagement** than traditional modals on mobile

### What Works on Mobile

**Step-by-step wizard (not a long scroll):**
- Multi-step works better when the form is complex (which feis registration is — parent info, multiple dancers, competition selection, payment)
- Break into logical chunks: (1) Your info → (2) Dancer profiles → (3) Select competitions → (4) Review cart → (5) Payment
- **One decision per screen** — don't ask parent info and dancer info on the same step
- Progress indicator mandatory (e.g., "Step 3 of 5 — Select Competitions")
- Save state on each step (server-side, not just localStorage) — parent can close phone and resume later

**Mobile-specific patterns:**
- **Large tap targets** (min 44x44pt) — parents are tapping while kids are pulling on their arm
- **Single-column layout** — no side-by-side fields on mobile
- **Sticky bottom bar** — running total and "Continue" button always visible
- **Bottom sheets for sub-selections** — when selecting competitions, a bottom sheet slides up showing available dances. More thumb-friendly than a dropdown or new page.
- **Native keyboard types** — `type="tel"` for phone, `type="email"` for email, `inputmode="numeric"` for numbers
- **Apple Pay / Google Pay** — the single biggest mobile conversion lever. One biometric tap vs. typing 16 card digits.
- **Autofill-friendly markup** — `autocomplete="given-name"`, `autocomplete="cc-number"`, etc.

**What doesn't work on mobile:**
- Long scrolling forms with 20+ fields
- Tiny checkboxes for competition selection
- Dropdowns with 100+ options (all competitions in one list)
- Requiring desktop for any step ("please use a computer to complete registration")

### Recommended Feis Registration Mobile Flow

```
Step 1: WHO ARE YOU?
┌────────────────────────┐
│  [Name pre-filled]     │
│  [Email pre-filled]    │
│  [Phone pre-filled]    │
│                        │
│  [Continue →]          │
└────────────────────────┘

Step 2: YOUR DANCERS
┌────────────────────────┐
│  Siobhan O'Brien       │
│  Age 11 · Novice       │
│  [Edit] [Remove]       │
│                        │
│  Liam O'Brien          │
│  Age 9 · Beginner      │
│  [Edit] [Remove]       │
│                        │
│  [+ Add another dancer]│
│                        │
│  [Continue →]          │
└────────────────────────┘

Step 3: SELECT COMPETITIONS (per dancer)
┌────────────────────────┐
│  Siobhan · Under 12    │
│  Novice                │
│                        │
│  ☑ Reel         $15    │
│  ☑ Slip Jig     $15    │
│  ☐ Treble Jig   $15    │
│  ☐ Hornpipe     $15    │
│  ☐ Light Jig    $15    │
│  ☐ Set Dance    $15    │
│                        │
│ ┌────────────────────┐ │
│ │ 2 selected · $30   │ │  ← Sticky subtotal
│ │ [Next dancer →]    │ │
│ └────────────────────┘ │
└────────────────────────┘

Step 4: REVIEW & PAY
┌────────────────────────┐
│  [Itemized cart]       │
│  [Total: $74.60]       │
│                        │
│  [Apple Pay]           │
│  [Google Pay]          │
│  [Pay with card]       │
└────────────────────────┘
```

---

## 6. Family Dashboard After Registration

### What Parents See Across Platforms

| Platform | Dashboard Features |
|----------|-------------------|
| **Sawyer** | "My Schedule" (color-coded by child), calendar sync, class history, payment history |
| **SportsEngine** | Household tab, child profiles, team schedules, RSVP, messages, guardian management |
| **TeamSnap** | Schedule, messages, live streams, highlights, team roster, availability |
| **PlayMetrics** | Calendar view, attendance tracking, Google Maps directions, push notifications |
| **ClassDojo** | Activity feed (photos/videos), two-way messaging, portfolio, behavior points |
| **ID Dance Competition** | Dancer profiles, Photogenic registration, feedback/critiques after events |
| **FeisWeb** | Registration history, results (expire in 10 min), print number card |

### The Ideal Feis Parent Dashboard

**Immediate post-registration:**
```
┌─────────────────────────────────────────────────┐
│  SPRING FEIS 2027                               │
│  March 15, 2027 · Hilton Garden Inn, Boston     │
│                                                 │
│  ✅ Registered · Paid $74.60                     │
│                                                 │
│  Siobhan O'Brien (Under 12, Novice)             │
│    Reel · Slip Jig · Treble Jig                 │
│                                                 │
│  Liam O'Brien (Under 10, Beginner)              │
│    Reel                                         │
│                                                 │
│  [📅 Add to Calendar]  [✏️ Edit Registration]    │
│  [📄 View Receipt]     [📍 Get Directions]       │
└─────────────────────────────────────────────────┘
```

**As feis day approaches (1 week before):**
```
┌─────────────────────────────────────────────────┐
│  SPRING FEIS 2027 — 7 DAYS AWAY                 │
│                                                 │
│  📋 SCHEDULE RELEASED                            │
│                                                 │
│  Siobhan O'Brien                                │
│    Reel — Stage 2, ~10:30 AM (Competition #42)  │
│    Slip Jig — Stage 1, ~11:15 AM (#58)          │
│    Treble Jig — Stage 2, ~2:00 PM (#71)         │
│                                                 │
│  Liam O'Brien                                   │
│    Reel — Stage 1, ~9:00 AM (#12)               │
│                                                 │
│  Check-in opens: 8:00 AM                        │
│  Venue: Hilton Garden Inn · [Get Directions]    │
│  Competitor numbers: Print from link below       │
│                                                 │
│  [🖨️ Print Number Cards]  [📋 Full Schedule]     │
└─────────────────────────────────────────────────┘
```

**After the feis (results available):**
```
┌─────────────────────────────────────────────────┐
│  SPRING FEIS 2027 — RESULTS                     │
│                                                 │
│  Siobhan O'Brien                                │
│    🥈 Reel — 2nd of 14                           │
│    🏅 Slip Jig — 4th of 12                       │
│    🥉 Treble Jig — 3rd of 16                     │
│                                                 │
│  Liam O'Brien                                   │
│    🥇 Reel — 1st of 8                            │
│                                                 │
│  [View Detailed Scores]  [View Judge Comments]  │
│  [Share Results]                                 │
│                                                 │
│  🗓️ Next feis: Summer Showcase, June 7           │
│  [Register Now — Early Bird until May 1]        │
└─────────────────────────────────────────────────┘
```

### Key Dashboard Principles

1. **Time-contextual** — show different information based on where you are relative to the feis date.
2. **Per-dancer organization** — every piece of information grouped by child, not by data type.
3. **Actionable** — every card has a clear next action (add to calendar, view schedule, see results).
4. **Persistent results** — FeisWeb's 10-minute expiry is absurd. Results live forever in the parent's dashboard.
5. **Cross-feis view** — parent can see all upcoming feiseanna and past results in one timeline.
6. **Bridge to next registration** — always surface the next opportunity to register.

---

## 7. Confirmation and Communication Lifecycle

### What the Best Platforms Send

| Timing | Channel | Content | Best Example |
|--------|---------|---------|--------------|
| **Immediate** | Email | Confirmation + receipt + "Add to Calendar" | Eventbrite, RunSignup |
| **Immediate** | In-app | Dashboard updated with registration details | Sawyer, TeamSnap |
| **If edited** | Email | Change confirmation with old vs. new highlighted | RunSignup |
| **4 weeks before** | Email | Schedule preview, logistics overview, what to bring | TeamSnap |
| **1 week before** | Email + Push | Detailed dancer schedule with times and stages | PlayMetrics |
| **1 day before** | SMS | Quick reference: check-in time, venue address (tappable) | SMS best practice |
| **Morning of** | SMS | "Doors open in 1 hour. [Venue link]. Good luck!" | — |
| **Day of** | Push / SMS | Stage delays, schedule changes (keep SHORT) | CompetitionSuite |
| **Results ready** | Push + Email | Results with placement per dancer | FeisTab differentiator |
| **1 day after** | Email | Thank you + full results + feedback request | — |
| **2 weeks after** | Email | "Save the date" for next year + early bird teaser | — |

### Confirmation Email Must-Haves

Based on analysis of 20+ confirmation email patterns:

1. **Subject line:** Clear and scannable — "You're registered for Spring Feis 2027"
2. **Hero block:** Event name, date, venue — immediately visible
3. **Itemized receipt:** Every dancer, every competition, every fee line
4. **"Add to Calendar" button** — Google, Outlook, Apple Calendar. Reduces no-shows.
5. **Edit link** — "Need to make changes? [Edit Registration]"
6. **Venue details** — address (tappable for maps), parking info, check-in time
7. **What's next** — "We'll email your schedule 1 week before the feis."
8. **Contact** — organizer email/phone for questions

### SMS Best Practices

- **98% open rate** — far higher than email (20-30%)
- **Get opt-in during registration** — checkbox: "Send me text updates about this feis"
- **Keep messages ultra-short** — under 160 characters
- **Include one tappable link** — venue directions, schedule, results
- **Respect timing** — no texts before 8 AM or after 9 PM
- **Critical for day-of** — "Stage 2 running 30 min behind. Siobhan's Reel now ~11:00 AM"

---

## 8. What FeisTab Should Build (Synthesis)

### The "10x Better" Opportunities

These are areas where the competition is so weak that FeisTab can deliver a dramatically better experience:

| Area | Current State (FeisWeb et al.) | FeisTab Opportunity |
|------|-------------------------------|---------------------|
| **Mobile registration** | Desktop-first, often broken on mobile | Mobile-first wizard with Apple/Google Pay |
| **Returning families** | Re-enter everything each feis | "Register Again" with pre-filled selections |
| **Fee transparency** | Total shown only at checkout, no breakdown | Running total from first selection, itemized by dancer |
| **Eligibility filtering** | 100+ competitions in one list | Auto-filtered to dancer's age + level (6-8 choices) |
| **Results persistence** | Expire in 10 minutes (FeisWeb) | Permanent dashboard with full history |
| **Communication** | One confirmation email, maybe | Full lifecycle: confirm → remind → day-of SMS → results |
| **Family dashboard** | Registration list only | Time-contextual dashboard: schedule, results, next feis |
| **Multi-child registration** | One child at a time, separate flows | Single cart, all dancers, one checkout |
| **Shared custody** | Not supported | Invitation model, multiple guardians per child |
| **Payment speed** | Credit card form on every transaction | Saved payment methods, Apple Pay, Google Pay |

### Architecture Implications

Based on this research, the parent registration portal (sub-project 2) should be built around these core entities:

1. **Family Account** — parent's login, payment methods, contact info
2. **Guardian Invitations** — additional adults linked to family (shared custody, grandparents)
3. **Dancer Profiles** — children, each with name, DOB, gender, school, level, medical notes
4. **Registration Cart** — multi-dancer, multi-competition, with real-time fee calculation
5. **Registration Record** — frozen snapshot of what was paid for (immutable after payment)
6. **Communication Preferences** — email, SMS, push notification opt-ins
7. **Dashboard State** — time-contextual view per feis (registered → scheduled → day-of → results)

### Priority Order for Sub-Project 2

1. Family account + dancer profiles (the foundation everything else builds on)
2. Competition selection with eligibility filtering (the core registration flow)
3. Cart with running total + fee calculation (integrated with engine from sub-project 1)
4. Stripe Checkout (Apple Pay, Google Pay, saved cards)
5. Confirmation email with "Add to Calendar"
6. Family dashboard (registered feiseanna, time-contextual)
7. "Register Again" flow for returning families
8. SMS notification opt-in + day-of messaging
9. Results integration (bridge from Phase 1)
10. Guardian invitation model

---

## Sources

### Platform-Specific
- [TeamSnap — Top Features in Online Registration Software](https://www.teamsnap.com/blog/for-business/top-features-online-sports-registration-software)
- [TeamSnap ONE Announcement](https://www.teamsnap.com/blog/announcements/teamsnap-unveils-teamsnap-one-next-generation-platform-future-youth-sports-technology)
- [SportsEngine — Add a Person to Household](https://help.sportsengine.com/en/articles/10509528-add-a-person-in-myse)
- [SportsEngine — Parent & Athlete Software](https://www.sportsengine.com/roles/parents-and-athletes/)
- [CompetitionSuite](https://competitionsuite.com/)
- [DanceComp Genie Studio Registration Guide](https://support.inchol.com/ClientData/Modules/Articles/file/DanceComp%20Genie%20Studio%20Registration.pdf)
- [DanceComp Genie Studio Passport](https://studio.dancecompgenie.com/)
- [RunSignup — Registration Product](https://info.runsignup.com/products/registration/)
- [RunSignup — Repeat Participant Reports](https://runsignup.blog/2015/10/01/repeat-participant-reports/)
- [RunSignup — Fee Transparency Laws](https://info.runsignup.com/about-us/fee-transparency-laws/)
- [Eventbrite — Registration Platform](https://www.eventbrite.com/organizer/features/registration-online/)
- [Eventbrite — Collect Info from Attendees](https://www.eventbrite.com/help/en-us/articles/246376/how-to-collect-information-from-all-event-attendees/)
- [Sawyer — Parent Experience](https://www.hisawyer.com/for-business/features/parent-experience)
- [Sawyer — Class Management Review](https://designtlc.com/archive/sawyer-class-management-review/)
- [LeagueApps — Registration](https://leagueapps.com/youth-sports-management-platform/registration/)
- [LeagueApps — Family Accounts](https://support.leagueapps.com/hc/en-us/sections/1500002034362-Family-Accounts)
- [LeagueApps — How to Register Children](https://support.leagueapps.com/hc/en-us/articles/360036472274-How-to-register-your-children-for-a-program)
- [PlayMetrics — Youth Sports Platform](https://home.playmetrics.com/)
- [PlayMetrics — G2 Reviews](https://www.g2.com/products/playmetrics/reviews)
- [ClassDojo — Family Engagement](https://www.classdojo.com/districts/solutions/family-engagement/)
- [ID Dance Competition — Parent Portal](https://www.iddancecomp.com/parentportal)

### UX Patterns and Best Practices
- [NNGroup — Bottom Sheets: Definition and UX Guidelines](https://www.nngroup.com/articles/bottom-sheet/)
- [Mobbin — Bottom Sheet Design Best Practices](https://mobbin.com/glossary/bottom-sheet)
- [WeWeb — Multi-Step Form Design](https://www.weweb.io/blog/multi-step-form-design)
- [Bird Marketing — Multi-Step vs Single-Step Forms](https://bird.marketing/blog/digital-marketing/guide/conversion-rate-optimization/multi-step-vs-single-step-forms-conversions/)
- [Zuko — Mobile Form UX Tips](https://www.zuko.io/blog/8-tips-to-optimize-your-mobile-form-ux)
- [Swoogo — 20 Event Registration Confirmation Emails](https://swoogo.events/blog/event-registration-confirmation-emails/)
- [Campaign Monitor — 10 Confirmation Emails for Events](https://www.campaignmonitor.com/blog/email-marketing/10-confirmation-emails-for-events-with-examples/)
- [Event Espresso — Multi-Event Registration Cart](https://eventespresso.com/product/eea-multi-event-registration/)
- [Contentsquare — Shopping Cart UX Framework](https://contentsquare.com/guides/ecommerce-ux/shopping-cart/)

### Industry and Compliance
- [Stax — Evolving Landscape of Youth Sports Management Platforms](https://www.stax.com/insights/navigating-the-evolving-landscape-of-youth-sports-management-platforms-insights-from-the-field)
- [Jumbula — Youth Sports Registration Software](https://jumbula.com/markets/sports-management-software/)
- [National Sports ID — Age & Grade Verification](https://www.nationalsportsid.com/sports-age-and-grade-verification/)
- [EZ Texting — Sports Text Alerts](https://www.eztexting.com/nonprofits/sports-text-alerts)
- [RevText — Youth Sports Text Messaging](https://revtext.io/how-youth-sports-teams-can-improve-communication-through-text-messaging/)
