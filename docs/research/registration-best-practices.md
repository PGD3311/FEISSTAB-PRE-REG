# Event Registration Platform Best Practices

*Research completed 2026-03-19*

## 1. Multi-Step Wizard UX

### Why Multi-Step
Multi-step forms outperform single-page forms: **18% increase in conversion** (Instapage). Breaking complex forms into steps reduces cognitive cost.

### Rules
- **1-3 fields per step**, under 10 steps total
- **Group logically**: parent info -> dancer profiles -> competition selection -> review/payment
- **One decision per screen**
- **Progress indicator mandatory** — users need to know where they are
- **Save-and-resume** — save form state to server on each step (not just localStorage)
- **Allow back-navigation without data loss** — most common wizard anti-pattern
- **Inline real-time validation** per field, step-level validation before progression
- **Mobile-first** — parents register from phones. Single column, large tap targets.

### Smart Defaults
- Pre-select age group from DOB
- Default to competitions entered last year
- Auto-calculate age from DOB and competition date
- Pre-fill parent contact from account

### Abandonment Recovery
- Server-side draft persistence (cross-device resume)
- Email reminder after 24-48 hours with direct resume link
- Recovers 5-15% of abandoned registrations

---

## 2. Fee Calculation and Display

### FTC Junk Fees Rule (May 12, 2025)
Currently applies to audience-based events, not participation events like a feis. But the direction is clear: **all-in pricing is becoming the expectation.** Build for it from day one.

### Display Rules
- **Show total price prominently** (largest font), breakdown underneath or on tap
- **Running total / live cart** — as parent adds competitions, total updates in real time
- **Itemize everything** — every line item, discount, and surcharge visible and labeled
- **Explain discounts proactively** — "You saved $10 with the family discount"
- **Show what triggers next discount** — "Add 1 more event to unlock family discount"
- **No math surprises** — total at checkout must match or be lower than what was shown during selection

### Example Display
```
Dancer: Siobhan O'Brien
  Reel (U12)              $15.00
  Slip Jig (U12)          $15.00
  Treble Jig (U12)        $15.00
                    Subtotal: $45.00

Dancer: Liam O'Brien
  Reel (U10)              $15.00
                    Subtotal: $15.00

Family discount              -$10.00
Late registration surcharge  +$20.00
Processing fee                 $4.60
────────────────────────────────────
Total                        $74.60
```

---

## 3. Organizer Setup UX

### Template System
- **Start from a syllabus template, not a blank slate**
- Provide standard templates ("Standard CLRG Feis", "Championship Feis", "Full CLRG")
- Organizer enables/disables competitions they want
- Dramatically faster than building from scratch

### Bulk Operations (essential for 100+ categories)
- Select all / select none for category groups
- Bulk set fee: select 20 competitions, set price in one action
- Bulk set capacity cap
- Bulk enable/disable entire age group or level
- Filter and sort by dance type, age group, level

### Matrix/Grid View
Display competitions in a grid: rows = dance types, columns = age groups. Each cell is a toggle with a fee field. Bird's-eye view of entire syllabus on one screen.

### Validation
- Warn if age group has gaps (U10 and U14 but no U12)
- Warn if fee is $0 (likely oversight)
- Warn if capacity unreasonably low/high
- Summary before publishing: "87 competitions across 6 age groups"

---

## 4. Clone/Repeat Event Patterns

### What to Clone (carry forward)
- Competition categories and structure
- Fee schedules (with option to bulk-adjust)
- Registration form fields
- Waiver/agreement text
- Email templates
- Organizer team/permissions

### What to Reset (start fresh)
- Registration data
- Dates and deadlines
- Venue (if changed)
- Capacity counters
- Financial records

### "Register Again" Pattern (killer feature for sub-project 2)
Email last year's registrants with personalized link that pre-fills dancer profiles and last year's competition selections. Parent reviews, makes changes, checks out in minutes. Dramatically increases return rates.

---

## 5. Deadline Management

### Tier Structure
| Tier | Timing | Typical |
|------|--------|---------|
| Early | Opens ~3 months before | No late fee |
| Standard | Until 2 weeks before | Full price |
| Late | Until 1 week before | +$20-50 surcharge |

### Rules
- **Automated tier transitions** — no manual intervention
- **Store deadlines in UTC**, display in event's timezone
- **Set transitions at midnight in event's timezone**
- **Always show timezone label**: "Registration closes March 15 at 11:59 PM EST"
- **Countdown timers** when deadline is within 7 days (8-25% conversion lift)
- **Scarcity messaging**: "Only 12 spots remaining" (up to 17.8% conversion lift)
- **Grace period** (15 min) for registrations started before deadline but not completed

### Email Urgency Sequence
- 1 week before: "Early bird pricing ends in 7 days"
- 48 hours: "Last chance"
- Day of: "Ends tonight at midnight"
- Day after: "Still open at standard pricing"

---

## 6. Capacity Management

### Hold/Timer Pattern (industry standard for race conditions)
1. When parent adds competition to cart, **place temporary hold** on spot
2. Hold has **countdown timer** (15-20 minutes)
3. Checkout completes -> hold converts to confirmed registration
4. Timer expires -> hold released, spot available again
5. Show timer prominently

### Technical Implementation
- **PostgreSQL `SELECT FOR UPDATE`** for capacity checks — sufficient for feis-scale contention
- **Database unique constraint** on `competition_id + dancer_id` as safety net
- **Check capacity at add-to-cart AND at checkout** (may have changed between)

### Waitlist
- Parent joins waitlist (free, no charge until promoted)
- Automatic promotion when spot opens
- Time-limited offer (24 hours to claim)
- Position transparency: "You are #3 on the waitlist"

---

## 7. Communication Lifecycle

### Phase 1: Confirmation (Immediate)
- Event name, date, venue with address
- Itemized receipt
- List of competitions per dancer
- "Add to Calendar" button
- Link to modify registration
- Next steps

### Phase 2: Change Notifications (As Needed)
- Competition added/removed
- Competition cancelled by organizer (with refund info)
- Schedule change (old vs new highlighted)

### Phase 3: Pre-Event Reminders
| Timing | Content |
|--------|---------|
| 4 weeks | Schedule preview, logistics overview |
| 1 week | Detailed schedule with dancer's competition times, venue logistics |
| 1 day | Final reminder: check-in time, stage assignments, what to bring |
| Morning of | Quick-reference: venue address (tappable), check-in time |

### Phase 4: Day-Of
- SMS for real-time updates (faster than email)
- Stage delays, schedule changes
- Keep messages extremely short

### Phase 5: Post-Event
- Results notification
- Thank you + feedback request
- "Save the date" for next year + early bird teaser
