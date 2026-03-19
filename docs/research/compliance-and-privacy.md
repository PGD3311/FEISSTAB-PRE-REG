# Compliance & Data Privacy Guide

*Research completed 2026-03-19*

## COPPA (US)

### When It Applies
COPPA applies to FeisTab because the platform knowingly collects personal data about children under 13 (name, DOB, school, competition level).

### Core Requirements
1. **Privacy policy** — posted prominently, describes what's collected, how used, who gets it
2. **Direct parental notice** — before collecting data
3. **Verifiable Parental Consent (VPC)** — before collecting/using/disclosing child info
4. **Data minimization** — only what's necessary for participation
5. **Written data retention policy** — purposes, business need, deletion timeframe
6. **Written security program** — mandatory as of 2025 amendments

### 2025 Amendments (Effective June 23, 2025; Compliance Deadline April 22, 2026)
- Separate consent for third-party data sharing
- **Written security program** mandatory: designated coordinator, risk assessments, incident response, encryption, annual updates
- **Written data retention policy** required
- Penalties up to **$53,088 per violation**

### VPC Methods
For FeisTab, **credit card transaction** is ideal (registration involves payment). For pre-payment interactions, use **email-plus** (consent email with confirmation link).

### FeisTab's Structural Advantage
The parent is the user; the child is a profile. The parent creating a child profile IS the consent moment.

---

## GDPR (Ireland/UK/EU)

### Ireland (Strictest in EU)
- **Age of digital consent: 16** (highest in EU)
- DPC: "zero interference" with child's best interests for legitimate interest
- Must conduct **DPIA** when processing children's data at scale
- Fines up to 4% of global annual turnover or EUR 20 million

### UK
- Age of digital consent: **13**
- **Children's Code (AADC)**: 15 standards for online services accessed by children

### Canada (PIPEDA)
- Under 13: parental consent required
- Meaningful consent in understandable language

### Australia
- ~15 (capacity-based assessment)
- Children's Online Privacy Code expected 2026

### Practical Approach
Apply **Ireland's 16-year threshold globally** (highest common standard). Since parents register children, this is architecturally built-in.

---

## Family Account Architecture

### Core Rules
1. **Parents are users; children are profiles, not users.** No login credentials for children.
2. **One parent account, multiple child profiles.** Name, DOB, gender, school/studio, level.
3. **Multiple parents per child.** Invitation model — primary parent invites second by email.
4. **Do NOT require proof of custody.** Let dance schools handle disputes offline.
5. **Studio linkage is a data field, not an access grant.**

### Data Model
```
families
  id, created_at, billing_email

family_members (parents)
  id, family_id, user_id (auth), role (primary|secondary),
  name, email, phone

children
  id, family_id, first_name, last_name, date_of_birth,
  gender, studio_id, competition_level, medical_notes (encrypted)

child_guardians (many-to-many for shared custody)
  child_id, family_member_id, relationship, can_register, can_view_results
```

---

## Consent Flow

```
1. Parent creates account -> email verification
2. Parent adds child profile -> consent checkpoint:
   "I am the parent/legal guardian and consent to collection
    of their personal information as described."
   -> Record: timestamp, IP, user ID, consent version
3. Registration + payment -> credit card serves as additional VPC
4. Results publication -> separate consent: name public vs anonymous
```

---

## Data Collection

### Required
- Child: first name, last name, DOB, gender, studio/school, competition level
- Parent: name, email, phone
- Payment: processed by Stripe, never stored

### Never Collect
- Home address (unless mailing physical items)
- Government ID numbers
- Photos/images of children
- Social media handles
- Biometric data
- Location tracking data

---

## Data Retention

| Category | Retention | Justification |
|----------|-----------|---------------|
| Active child profile | While active + 1 year | Service provision |
| Competition results | Indefinite (anonymized) | Historical record |
| Personal registration data | 3 years after last competition | Audit/disputes |
| Payment records | 7 years | Tax/accounting |
| Medical/allergy notes | Delete after competition day | Safety fulfilled |
| Consent records | Processing + 3 years | Compliance proof |

### Right to Erasure
- Hard delete PII on request
- Anonymize competition results (replace name with "Competitor [hash]")
- Retain anonymized aggregate data
- Breach notification: 72 hours (GDPR), varies by US state

---

## Security Requirements (COPPA Written Security Program)

1. **Designated coordinator** for security program
2. **Risk assessments** — regular
3. **TLS 1.2+**, AES-256 at rest (Supabase default), app-level encryption for medical notes
4. **RLS policies** — parents see only their children, organizers see only their events, judges see numbers not names
5. **Incident response plan**
6. **Audit logging** of all PII access
7. **Annual review** of security program
8. **Vendor oversight** — Stripe, Supabase maintain equivalent security

---

## Recent Enforcement
- **Genshin Impact developer**: $20 million (Jan 2025)
- **Disney/YouTube**: $10 million (Sept 2025)
- **TikTok/ByteDance**: DOJ + FTC lawsuit (Aug 2024)
- **NGL Labs**: Settlement (July 2024)
