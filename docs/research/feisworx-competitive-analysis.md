# FeisWorx Competitive Analysis

**Research Date:** March 20, 2026
**Confidence Level:** Moderate — FeisWorx is notably opaque about pricing and process. Much of this is pieced together from public syllabi, forum posts, and service descriptions. Pricing specifics are inferred from feis syllabus PDFs, not from FeisWorx directly.

---

## 1. Company Overview

**FeisWorx** is a family-owned business based in Parker, Colorado (PO Box 2046, Parker, CO 80134). They describe themselves as "the premier services provider for feiseanna in North America." The company has been operating since at least 2001 (copyright on their site says 2001-2026), with business databases showing operations from Parker since ~2010.

- **Revenue:** < $5M (ZoomInfo estimate)
- **Employees:** < 25 (ZoomInfo estimate)
- **Contact:** info@feisworx.com, payment@feisworx.com
- **Tech Stack:** PHP-based website, distinctly old-school HTML (table layouts, no responsive design, no JavaScript frameworks). The site looks like it was built in the early 2000s and has been maintained but never redesigned.
- **Related Properties:** feisworx.com (main), myfeis.com (self-service tabulation), fleadhworx.com (fleadh-specific variant of the same system)

**Key Observation:** The owner/founder name is not publicly listed anywhere I could find. This is a very private, low-profile operation.

---

## 2. How an Organizer Gets Their Feis Listed

**The process is entirely service-driven, not self-service.** There is no "sign up" button, no self-service portal for organizers, no pricing page.

The documented path:
1. Email info@feisworx.com requesting a proposal
2. FeisWorx responds with a custom proposal (presumably based on feis size, region, services needed)
3. Once engaged, FeisWorx handles the setup

**What FeisWorx sets up for the organizer:**
- Syllabus data entry into their system (competition codes, age groups, levels, fees)
- Registration portal configuration
- Payment processing setup (if the feis opts in)
- Stage scheduling tools
- Adjudicator book generation
- Backstage reports

**Regions currently served** (based on active feis listings):
- Western US
- Mid-America
- Southern US
- Western Canada
- Eastern Canada
- Mid-Atlantic US
- Middle America US
- New England US

As of the homepage snapshot (March 2026), approximately 20-30 feiseanna were listed as upcoming or "coming soon," spanning April through July 2026. This is a fraction of the 200+ annual North American feiseanna — FeisWorx does not serve the entire market. Their strongest presence appears to be Western US and Mid-America.

---

## 3. Setup / Onboarding Process

**This is a fully managed service, not a software product.** The organizer does not log into a dashboard and configure their feis. Instead:

1. **Organizer sends FeisWorx their syllabus** (typically a PDF they've already created)
2. **FeisWorx does the data entry** — they enter all competition codes, age groups, levels, fee structures, and eligibility rules into their system
3. **FeisWorx configures registration** — the system filters competitions shown to each dancer based on birthday, championship status, and gender. This filtering is "turned on or off on a feis by feis basis after discussion with the feis committee"
4. **FeisWorx opens registration** — dancers/parents can then register through feisworx.com
5. **Organizer gets admin access** — to view registration data, payment status, medal calculations, and stage scheduling. But the heavy lifting is done by FeisWorx.

**For TCRG (teacher) access:** Teachers get a portal where they can review and approve their school's entries, and build competition teams (e.g., figure dance groups). This is a feature FeisWorx configures per-feis.

**Critical Insight:** The organizer's syllabus PDF is hosted on FeisWorx's servers (e.g., `feisworx.com/feis/LavinCassidy2026Syllabus.pdf`). FeisWorx essentially becomes the registration and data layer for the feis.

---

## 4. Pricing / What FeisWorx Charges

**FeisWorx does not publish pricing.** You must request a custom proposal. However, from analyzing multiple feis syllabus PDFs, we can reverse-engineer their fee model:

### The "FeisWorx Service Fee"
Every feis using FeisWorx charges a **"FeisWorx Service Fee"** that is explicitly called out in syllabi as separate from other feis fees. This fee is:
- **Charged per family** (not per dancer, not per entry)
- **NOT included in the "Family Max"** cap that limits total competition fees
- **Variable by feis** — examples found:
  - $8.25 per family
  - $9.75 per family
  - $10.00 per family
  - $14.00 per family

The variation suggests FeisWorx may charge the feis a flat fee or per-registration fee, and the feis passes this through at whatever rate covers their cost.

### Revenue Model (Inferred)
Based on the evidence, FeisWorx likely generates revenue from:

1. **Per-family service fees** passed through to parents (the $8-14 fee visible in syllabi)
2. **Service fees for managed services** (registration processing, data entry, tabulation staff, equipment rental) — the proposal-based pricing that's never published
3. **Credit card processing fees** — FeisWorx handles payment processing directly (not through Stripe/PayPal) to "keep costs as low as possible." They accept Visa, MasterCard, and Discover. The feis decides whether to accept online payment. Multiple intermediaries take a cut, reducing what the feis receives.
4. **Tabulation day-of services** — FeisWorx provides equipment, networking, and staff for on-site tabulation at feiseanna they service

### What the Parent Sees
A typical registration might look like:
- Solo dance fees: $13-20 per dance
- Championship fees: $40-60 per championship
- Family Event Fee: $25-30 (includes admission, parking, online results)
- FeisWorx Service Fee: $8-14 per family
- Late Fee: $25-50 (if registering after deadline)
- Family Max: $150-175 (excludes FeisWorx fee, late fees, specials)

---

## 5. Services Beyond Software

This is where FeisWorx differs fundamentally from pure software plays. **FeisWorx is primarily a services company, not a software company.**

### Full-Service Offering (Core)
- **Registration management** — data entry, eligibility filtering, change processing
- **Paperwork preparation** — adjudicator books, backstage reports, stage assignments
- **Tabulation** — on-site equipment, networking, and staff to tabulate results
- **Results publishing** — online results accessible through feisworx.com
- **Awards generation** — solo, figures, and championship awards calculated
- **Stage scheduling** — tools for organizers to plan competition flow
- **Online payment processing** — credit card payments on behalf of feiseanna
- **Teacher summaries** — individual results reporting for TCRGs
- **Oireachtas scoring** — specialized scoring options for regional championships
- **Medal calculator** — online tool for feis administrators
- **Feedback collection** — post-feis survey system (available even to non-FeisWorx feiseanna)

### Who Does the Day-of Tabulation?
According to forum posts: **"FeisWorx is usually feis volunteers but could be the platform owner."** This contrasts with QuickFeis, which "always has its staff do tabulation."

This means FeisWorx offers a spectrum:
- Some feiseanna use FeisWorx for registration only + MyFeis for self-service tabulation
- Some feiseanna get full-service tabulation with FeisWorx staff on-site
- The level of service likely varies by the proposal/contract

### Number Card Printing
FeisWorx supports competitors printing their own number cards, but cards are not available until after registration closes ("typically Tuesday evening before the feis") to account for last-minute splits or rebalancing.

### Feis Progress Tracking
A newer feature: "Feis Progress" allows parents to track the progression of competitions at a current feis in real-time from their phone. This was poll-tested on the homepage (the Quick Poll asks users if they've tried it).

---

## 6. What is MyFeis?

**MyFeis (myfeis.com) is FeisWorx's self-service tabulation product.** Tagline: "Your Feis, Your Way — It's MyFeis!!!"

### What It Is
- A web-based tabulation system that **the feis committee uses to tabulate scores themselves**
- Results from MyFeis-tabulated feiseanna are published through the FeisWorx website
- It's an alternative to having FeisWorx provide full tabulation staff

### How It Works (Based on Available Documentation)
The MyFeis instructions document dates back to 2008 (drafted Feb 20, 2008, revised May 6). This is old technology. The system appears to be:
1. Organizer logs into myfeis.com
2. Competition data is pre-loaded (likely by FeisWorx from the registration data)
3. Feis volunteers enter scores on-site
4. System calculates placements and generates results
5. Results are published to FeisWorx website

### Key Limitation
I could not access the full MyFeis instruction manual (PDF was blocked). The login page is bare-bones: email + password, no feature descriptions, no marketing copy. This is clearly designed for existing customers who already know what it is, not for discovery.

### MyFeis vs Full Service
On the feis info page, each feis listing shows which tabulation service it uses. Some show "MyFeis" and others presumably use FeisWorx's full-service tabulation. This confirms the two-tier model:
- **MyFeis** = self-service tabulation (feis volunteers do the work)
- **FeisWorx full-service** = FeisWorx provides staff + equipment

---

## 7. Organizer Feedback and Community Sentiment

### What I Found
Public reviews of FeisWorx from the organizer perspective are essentially **nonexistent**. This is a closed, relationship-driven market. Key findings:

**Forum Posts (VoyForums):**
- One thread titled "Anyone else having a problem with feisworx?" referenced the site being down for maintenance in September 2025
- General mentions of FeisWorx being "good about posting adjudicators once the feis has them lined up"
- One post confirming the QuickFeis vs FeisWorx model difference: QuickFeis always uses its own staff; FeisWorx is usually volunteers

**Feis Feedback System:**
FeisWorx offers a "Feis Feedback" system where parents can tell feis committees what went right and wrong. Notably, this is available to ANY feis, not just FeisWorx customers — suggesting it's a lead-gen or community goodwill tool.

**No Reviews Found On:**
- Google Reviews
- Facebook (FeisWorx has a Facebook page but I could not access reviews)
- Reddit (no threads found)
- Trustpilot, G2, Capterra — not listed
- App stores (no mobile app)

**Oireachtas Controversy:**
There was a complaint that the Western US region required dancers to pay for FeisWorx access to view Oireachtas results, despite CLRG rules requiring public posting. This suggests FeisWorx may gate some results behind login.

---

## 8. Competitive Landscape Context

### FeisWorx's Position
FeisWorx is the **established incumbent in the Western/Central US**, operating as a managed-services business. They are NOT trying to be a software platform. They are a family business that runs feis registration and tabulation as a service.

### Key Competitors

| Platform | Model | Geography | Tabulation |
|----------|-------|-----------|------------|
| **FeisWorx** | Managed service | Western/Central US, Western Canada | Volunteers or FeisWorx staff |
| **QuickFeis** | Managed service | Mid-America, expanding | Always QuickFeis staff |
| **FeisWeb** | Software platform | Northeastern US | Feis-provided |
| **FeisFWD** | Software platform | Growing, multi-region | Remote via app or on-site |
| **iFeis** | Registration platform | Various | Feis-provided |
| **GoFeis** | Platform | Various (WIDA/Open Platform) | Feis-provided |
| **OpenFeis** | Open source (MIT) | New entrant | Self-hosted |

### FeisFWD (Newest Competitor)
Worth noting: FeisFWD positions itself as "the newest, hottest Irish Dance competition software" with:
- Online syllabus design (self-service)
- Video uploads for remote adjudication
- Remote tabulation via their app
- "Affordable" pricing (fees charged to committee, not parents)
- Customizable for regional rules and special categories

FeisFWD is the closest thing to a modern SaaS competitor in this space.

---

## 9. Strategic Implications for FeisTab Pre-Reg

### FeisWorx's Strengths (What We're Up Against)
1. **Deep relationships** — organizers who use FeisWorx have been using them for years, maybe decades
2. **Full-service model** — "just send us your syllabus and we handle it" is a powerful value prop for volunteer-run feiseanna
3. **Network effects** — parents create one profile and can register for any FeisWorx feis
4. **Regional lock-in** — if your region's feiseanna all use FeisWorx, switching is painful

### FeisWorx's Weaknesses (Our Opportunities)
1. **Ancient technology** — the website is table-based HTML from the early 2000s, no mobile responsiveness, no modern UX
2. **No self-service for organizers** — you can't set up your own feis. You email them and wait for a proposal
3. **Opaque pricing** — no public pricing, custom proposals create uncertainty
4. **Not a platform** — it's a family business with <25 employees. Scaling is constrained by human labor
5. **Tabulation gap** — MyFeis is dated (2008 design doc). The day-of tabulation experience is either DIY with old software or you hire FeisWorx staff
6. **No mobile experience** — the Quick Poll on their homepage asking about Feis Progress suggests they're just starting to think about mobile/real-time
7. **Registration-centric** — FeisWorx excels at the pre-feis registration workflow but the day-of experience (the "chaotic middle") is underserved
8. **Data lock-in concern** — results, registrations, and dancer profiles all live on feisworx.com. If you leave, you lose your data

### The Bundled Service Problem
FeisWorx bundles registration + data entry + tabulation + results into one package. An organizer considering FeisTab has to break apart a relationship, not just swap software. This is why the "wedge" strategy (own the day-of, not the registration) is important — you don't ask the organizer to leave FeisWorx, you complement it.

---

## 10. What I Could NOT Verify

- **Exact pricing FeisWorx charges organizers** — only the pass-through family fees are visible
- **Contract terms** — length, exclusivity, data ownership
- **MyFeis detailed functionality** — the instruction PDF was not accessible
- **Actual number of feiseanna served** — homepage showed ~20-30 upcoming, but historically may serve more
- **Owner identity** — family-owned but no public names found
- **Whether FeisWorx provides the equipment** (tablets, printers, etc.) or just software + staff
- **Facebook reviews** — could not access the Facebook page content
- **Any organizer who has left FeisWorx and why**

---

## Sources

- [FeisWorx Homepage](https://feisworx.com/)
- [FeisWorx Services Page](https://www.feisworx.com/services.php)
- [FeisWorx FAQ](https://www.feisworx.com/faq.php)
- [FeisWorx Feis Info / Listings](https://www.feisworx.com/feisinfo.php)
- [FeisWorx Online Payment FAQ](https://www.feisworx.com/pay_online_faq.php)
- [FeisWorx Links / Credits](https://www.feisworx.com/credit.php)
- [FeisWorx Feis Feedback](https://feisworx.com/feisfeedback.php)
- [MyFeis.com](http://myfeis.com/)
- [MyFeis Instructions PDF (referenced, not fully accessible)](http://www.myfeis.com/share/MyFeisInstructions.pdf)
- [FleadhWorx Services](http://www.fleadhworx.com/services.php)
- [Badger State Feis Registration & Fees](https://www.badgerstatefeis.com/syllabus/syllabus-copy/)
- [Lavin Cassidy 2026 Syllabus](https://www.feisworx.com/feis/LavinCassidy2026Syllabus.pdf)
- [Feile Denver 2025 Syllabus](https://www.feisworx.com/feis/FeileDenver2025Syllabus.pdf)
- [VoyForums: UK Irish Dance Board (QuickFeis vs FeisWorx tabulation)](http://www.voy.com/219460/4/497005.html)
- [VoyForums: FeisWorx problems thread](http://www.voy.com/60473/3/381701.html)
- [FeisWorx ZoomInfo Profile](https://www.zoominfo.com/c/feisworx/350634924)
- [FeisWorx Dun & Bradstreet](https://www.dandb.com/businessdirectory/feisworx-parker-co-33459057.html)
- [FeisFWD](https://www.feisfwd.com/)
- [FeisFWD FAQ](https://www.feisfwd.com/faq)
- [QuickFeis](https://www.quickfeis.com/)
- [Digital Feis - Open Platform Explained](http://digitalfeis.co/open-platform-irish-dancing/)
- [IDTANA Feis Directory](https://idtana.org/feiseanna/)
- [FeisWorx Facebook](https://www.facebook.com/FeisWorx/)
