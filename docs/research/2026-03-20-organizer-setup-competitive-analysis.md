# How Organizers Set Up Feiseanna — Competitive Analysis

**Date:** 2026-03-20
**Sources:** Live web research + forum analysis

---

## The Big Finding

**Nobody has self-service organizer onboarding.** Every platform requires emailing or calling someone. FeisTab's wizard is already ahead of the entire market.

---

## Platform-by-Platform Breakdown

### FeisWeb (Northeast US incumbent)

**How organizers get listed:** Email Alan Schrader (alan@feisweb.com). One person runs it all. No self-service, no signup form, no pricing page. The entire onboarding is relationship-driven.

**What FeisWeb does:** Alan configures the feis listing, syllabus, fees, caps, deadlines. Maintains a master CLRG syllabus centrally and updates it when rules change. On competition day, FeisWeb provides tabulation — their person shows up with computers and proprietary software.

**Pricing:** ~$2/competitor (from organizer interview). Not publicly disclosed anywhere. Bundled — you can't buy just registration or just tabulation.

**Tech:** ASP.NET MVC 5.2 on Azure. Legacy framework (2016-era). Bootstrap frontend. PayPal payments.

**Territory:** ~16 feiseanna in 2026. NY, NJ, CT, PA, NH, VT + parts of Ontario.

**Moat:** Relationships and inertia. 20+ years of personal relationships with NE organizers. Parent account base (network effects). Not technology.

---

### FeisWorx (Western/Central US)

**How organizers get listed:** Email info@feisworx.com with "Proposal / Information Request." FeisWorx responds with a custom proposal. No self-service.

**What FeisWorx does:** Full-service — they bring staff AND hardware to your feis. Registration, data entry, syllabus setup, stage planning, backstage reports, adjudicator books, on-site tabulation with networked equipment, scoring, awards, teacher summaries.

**Pricing:** Opaque. Per-family "FeisWorx Service Fee" ranging $8.25-$14/family (visible in syllabi). Excluded from family max cap. Additional service fees in custom proposals.

**Self-service tier (MyFeis):** Web-based tabulation tool where feis volunteers enter scores themselves. Dates to 2008. Underdocumented, undermarketed.

**Tech:** PHP from early 2000s. Table-based HTML. No mobile responsiveness.

**Territory:** ~16 feiseanna in 2026. WA, CA, AZ, NV, CO, OK, TX, KY + Edmonton AB.

**Key insight:** FeisWorx's lock-in is relationships + bundled services, not technology. Their pitch: "We unload volunteers from the drudge work."

---

### FeisFWD (Canada, growing)

**How organizers get listed:** "Host a Feis" page → provide dates → FeisFWD builds syllabus or receives yours. Contact-based but more structured than competitors. Not fully self-service.

**Who runs it:** Sean O'Brien (director, FeisApp co-creator), Barbara Blakey O'Brien ADCRG (architect, experienced organizer from Western Canada), Mike Topper (lead dev, also works at Capital One). Family-scale operation.

**Pricing:** Semi-visible.
- Per-entry: $2-$5/grades dance, $9-$12/championship (2021 projections)
- Professional tabulation: $700+ plus travel
- Self-tabulation: included in platform
- Uses Stripe and PayPal

**Features:** Registration, online syllabus design, entry management, video uploads, online AND in-person adjudication, tabulation, results. Judge interface with checkbox feedback.

**Origin:** COVID-era online feis platform. Instructions heavily focus on video-based judging. In-person tablet-based scoring is their weakness — FeisTab's strength.

**Territory:** Strongest in Western Canada + Australia (handled Australian Nationals 2023). Some Mid-America presence. ~10-20 identifiable feiseanna.

**Community feedback:** Forum complaints about onboarding friction — schools not in system, payment failures, signup difficulties.

**Positioning:** "FeisFWD does not dictate how your event works — you do." CLRG approved.

---

### QuickFeis (Midwest/Southern US)

**How organizers get listed:** Contact support@quickfeis.com. No public onboarding flow.

**What they do:** Registration + live results via mobile app. Handles major IDTANA regional Oireachtasi (high-stakes events). Push notifications for dancer start times.

**Pricing:** Not publicly disclosed.

**Mobile app:** iOS, rated 3.2/5 (mixed — login issues reported).

**Territory:** Midwest and Southern US.

**Community trust:** HIGH. When the Southern Region Oireachtas switched FROM GoFeis TO QuickFeis, the community celebrated it as a "smart move." Considered a "proven system."

---

### Feis.link (US, smaller)

**How organizers get listed:** Has an actual organizer signup page at parent.feis.link/sign-up/organizer. **The ONLY platform with visible self-service onboarding.**

**Pricing:** Most transparent model. Small % on each registration, paid by the REGISTRANT (not the organizer). Zero cost to organizers. Direct deposit of funds to organizer.

**Status:** Smaller footprint. Less visible in community discussions. Parent portal returned 410 (Gone) error during testing — possible instability.

---

### GoFeis (UK/Ireland/International)

**How organizers get listed:** Contact via email, phone (+44), or WhatsApp. Free setup.

**Pricing:** Free to set up. "Fully transparent & all-inclusive service charges based on dancer entry." Also sells advertising (event ads, school page ads, number card ads: £25-£350).

**Territory:** 500+ dance schools, 30+ countries. UK, Ireland, Europe, Australia. Serves CLRG, WIDA, CRDM, and open-platform events.

**Community feedback:** NEGATIVE in North America. VoyForums: "confusing site right from the start," "not user friendly." Caused hours of delays posting results at Mid-America Oireachtas. Community asked to "go back to proven systems" (QuickFeis).

---

### Other Notable Platforms

| Platform | What it is |
|---|---|
| **Planxti** | Calendar/directory listing 1,115+ feiseanna worldwide. Not registration — aggregator. |
| **OpenFeis** | Open-source, MIT-licensed, self-hostable feis management. Beta. Born from frustration with incumbents. |
| **Love2Feis** | Discontinued January 2024. Its feiseanna had to migrate somewhere — market opportunity. |
| **FeisMark** | Windows desktop scoring software. Site unreachable (may be defunct). |
| **Treble Check** | Ireland/UK feis dates + results + tabulation services. |

---

## Market Map

| Platform | Region | Onboarding | Pricing | Model |
|---|---|---|---|---|
| **FeisWeb** | NE US | Email Alan | Hidden (~$2/dancer) | Full-service (one person) |
| **FeisWorx** | West/Central US | Email for proposal | Hidden ($8-14/family) | Full-service (staff + hardware) |
| **FeisFWD** | Canada + some US | Structured contact | Semi-visible ($700+ tabulation) | Software + optional services |
| **QuickFeis** | Midwest/South US | Contact support | Hidden | Platform + support |
| **Feis.link** | US (small) | Self-service signup | Transparent (% on reg) | Pure SaaS |
| **GoFeis** | UK/Ireland/Intl | Contact | Free setup, per-entry | Platform + advertising |

---

## What This Means for FeisTab

### 1. Self-service organizer setup is a genuine differentiator
No one else has it. Feis.link is closest but unstable. FeisTab's wizard is already more sophisticated than anything in the market.

### 2. "Self-service product, with optional assisted setup" is the right model
Traditional organizers want someone to hold their hand. Tech-comfortable organizers want to do it themselves. Offer both.

### 3. The market is geographically carved up
FeisWeb (NE), FeisWorx (West), QuickFeis (Midwest/South), FeisFWD (Canada), GoFeis (UK/Ireland). Almost no overlap. This means you can enter regions without directly competing — especially Southern US, Western US, and paper-only regions.

### 4. Pricing transparency is a weapon
Everyone hides their pricing. Being transparent ("$X per dancer, here's exactly what you get") builds trust instantly with organizers used to opaque proposals.

### 5. The "chaotic middle" positioning is validated
No single platform owns registration-to-results seamlessly. QuickFeis comes closest but has UX complaints. FeisTab owns the middle (scoring + tabulation) and now connects both ends.

### 6. Community trust is everything
Organizers are deeply risk-averse. They will not experiment with untested technology at major events. Start small (Bridget's feis), prove it works, let word-of-mouth spread.

### 7. Love2Feis dying created opportunity
Feiseanna that were on Love2Feis had to migrate. Some are still shopping.

### 8. FeisFWD is the closest competitor to watch
Only modern platform with Stripe, CLRG approval, and a software-first pitch. But their weakness is in-person day-of experience (their origin is COVID-era online feis). FeisTab's tablet-based live scoring is fundamentally different.
