# Competitive Landscape: Irish Dance Feis Software

*Research completed 2026-03-19*

## FeisWeb (feisweb.com)

### Company Profile
- **Owner:** Alan Schrader
- **Location:** 295 Stewart Ave, Garden City, New York
- **Founded:** 1985 (one of the oldest platforms)
- **Size:** 6-10 employees, $1M-$5M revenue
- **Tech stack:** ASP.NET 4.0 / MVC 5.2, Microsoft IIS, Bootstrap, Microsoft Azure
- **Coverage:** Primarily **Northeastern United States**

### How It Works
FeisWeb provides the full pipeline: online entries, event-day tabulation, and results publishing.

**Parent/dancer registration flow:**
1. Create a family account (email-based, dancer profiles added separately)
2. Browse upcoming feiseanna listed on the site
3. Select a feis, click "Enter" under each dancer's name
4. Choose competitions by level/age/dance type
5. Pay via credit card
6. Before the feis, print dancer's number card from FeisWeb
7. After the feis, results appear within a couple days

**Organizer flow:**
- Bundled service: registration platform + day-of tabulation
- The tabulation person physically shows up with computers and proprietary software
- Handles score entry, sorting, results printing, and posting
- Organizer gets admin access to registration data

### Known Issues
- Password reset problems ("cannot send a new password at this time" errors)
- Login session issues ("You must return to the home page and login")
- Results links expire in ~10 minutes
- Outdated technology (ASP.NET 4.0, homepage returns 404 at root)
- Regional lock-in (Northeast US only)

### Business Model
- Per-competitor platform fee (~$2 per competitor)
- Bundled registration + tabulation (cannot buy registration alone)
- If you use FeisWeb for registration, their tabulation staff shows up on competition day

### Lock-in Dynamics
- **Data captivity:** Parent accounts, dancer profiles, registration history all inside FeisWeb
- **Bundled services:** Registration and tabulation are a package deal
- **Regional network effects:** Northeast parents already have FeisWeb accounts — switching means parents need new accounts
- **Exports exist:** CSV export is the bridge FeisTab already exploits

---

## Other Competitors

### FeisWorx (feisworx.com)
- **Type:** Family-owned, premier registration + tabulation provider
- **Coverage:** Broad North American coverage
- **Services:** Online registration, payment processing (Visa/MC/Discover), tabulation (on-site with equipment and staff), medal calculators, stage scheduling
- **Key features:**
  - TCRGs (teachers) can review/approve their school's entries
  - Dancers can track registration status and payment status
  - Changes allowed up to 5 days before feis
  - Limits competition choices to reduce scroll fatigue
- **Tabulation:** Full-service tabulation (staff + equipment on-site) AND **MyFeis** (self-service tabulation software organizers run with their own volunteers)
- **Payment model:** Service fees separate from entry fees. Does not store credit card numbers.

### QuickFeis (quickfeis.com)
- **Founded:** 2012, Northville, Michigan
- **Owner:** Bettina Sohnigen
- **Size:** 2-10 employees
- **Coverage:** Mid-America region, expanding
- **Services:** Online registration and tabulation
- **Notable:** Staff does the tabulation (not volunteers). Best mobile app with live updates.

### FeisFWD (feisfwd.com)
- **Positioning:** "The newest, hottest Irish Dance competition software"
- **Founded:** Concept in 2016, revitalized December 2020 (COVID driver)
- **CLRG Approved**
- **Services:** Full suite — planning tools, online syllabus design, entries, video uploads, online AND in-person adjudication, tabulation, results
- **Key differentiator:** **Customization** — "we will not dictate how your event works"
- **Pricing:**
  - Fees charged to committee at "reasonable rates"
  - Includes remote tabulation via app using organizer's volunteers
  - Professional tabulation (FeisFWD staff): **$700 + travel expenses**
  - Uses **Stripe** for payment processing
- **Teacher features:** Free account, school management, can see entries from their school
- **Automatic emails** for every interaction

### GoFeis (gofeis.net)
- **Coverage:** International (WIDA events in Europe, Australia, Netherlands)
- **Pricing:** Free to setup, transparent per-dancer service charges
- **Features:** User-friendly interface, secure registration/payment, real-time updates

### Feis.link
- **Services:** Online registration, secure payments, day-of-event tabulation
- **Pricing:** Small percentage per registration **paid by the registrant** (not organizer)
- **Key feature:** Zero additional charges to organizers

### eFeis (efeis.com)
- **Positioning:** "All-in-one solution for Irish dancing competitions"
- **Coverage:** North America

### iFeis (ifeis.net)
- **Services:** Registration platform with payment processing
- **Requires** Google or Facebook account
- **Does not work with IE or Edge**

### FeisMark (feismark.com)
- **Type:** Scoring-only desktop software (Windows)
- **Scope:** Championship scoring only (not grade, not registration)
- **Distribution:** Global (England, Ireland, US, Canada, NZ, South Africa)

### Instep Feis Management (instepfm.com)
- **Coverage:** UK/Europe
- **Used by:** Great Britain Championships, British National Championships

### feisentry.com / feisresults.com
- **Type:** Combined entry + tabulation + results service
- **Coverage:** International (major championships)
- **Notable:** Live commentary service for real-time updates

---

## Pain Points

### For Parents
1. **Multiple accounts** — Different platforms per feis, must re-enter dancer info on each
2. **Password/login problems** — FeisWeb specifically has reset failures and session errors
3. **Results delays** — "over an hour" waiting, "nearly 2 hours waiting for results"
4. **Results errors** — "so many errors," "incorrect solo rounds being given"
5. **Score opacity** — Can only compare scores to top placers after the fact
6. **Expiring results links** — FeisWeb results expire in ~10 minutes
7. **High costs** — $13/dance + $30 family fee + championship fees + hotel + service fees
8. **No-show fees** — Non-refundable once processed

### For Organizers
1. **Volunteer-dependent tabulation** — Envelope chaos requires volunteer labor, error-prone
2. **Printing burden** — Score sheets, check-in sheets, envelopes, stickers, results sheets
3. **Paper chain errors** — Illegible handwriting, wrong numbers, transposed scores, mixups
4. **Bundled vendor lock-in** — FeisWeb registration = FeisWeb tabulation
5. **Rigid software** — No customization for regional rules or special categories
6. **Technology gap** — Aging tech stacks, no real-time tablet-based scoring
7. **Results posting is manual** — Someone prints and posts on a wall

### For Teachers (TCRGs)
1. **Limited visibility** — Only FeisWorx gives teachers entry review/approval
2. **No cross-platform view** — Students across multiple platforms, no unified dashboard

---

## Strategic Implications for FeisTab

### Where FeisTab Wins
1. **The chaotic middle is uncontested by modern software.** Every competitor handles registration and results. Nobody has modern, real-time, tablet-based scoring and tabulation.
2. **CSV import from FeisWeb/FeisWorx is the adoption bridge** — organizers keep existing registration and add FeisTab for the middle.
3. **Trust/transparency angle is unique.** Post-scandal, the community wants audit trails.

### The Threat
- **FeisFWD** is the only modern competitor with Stripe integration, customization, and in-person adjudication tools. If they nail the day-of experience, they become the real competitor.

### Geographic Opportunity
- FeisWeb = Northeast US only
- FeisWorx = broader North America but aging
- QuickFeis = Mid-America
- GoFeis = International (WIDA)
- **Gap:** Southern US, Western US, Canada, and regions using paper-only tabulation
