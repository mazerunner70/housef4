---
title: Stage 1 MVP Requirements
stage: Discovery & Requirements
phase: Stage 1 - Understanding
---

# Stage 1: MVP Product Requirements Document (PRD)

According to the **Personal Finances Domain Expert** and **Design Architect** skills, the development of a robust personal finance application should begin with the "Discovery & Requirements" stage, focusing specifically on **Stage 1: Clarity & Understanding**. 

Before building budgeting or investing features, the application must provide absolute visibility into the user's standard baseline.

## 1. Description & Goals (PRD)
**Goal**: Establish an absolute, clear picture of the user's current financial reality. We cannot expect users to optimize their finances if they do not accurately understand their baseline.
**User Persona**: Users feeling financial anxiety or simply lacking a macro-level view of their cash flow. They need a system that does the heavy lifting of organizing their money automatically.

### User Psychology & Needs
- **Need for Visibility**: Users often avoid checking their multiple bank apps due to anxiety. This MVP must aggregate everything into one non-judgmental, clear baseline.
- **Relief through Automation**: Even without direct bank syncing initially, users need the system to cleanly categorize and visualize their uploaded export files, saving them from tedious spreadsheet maintenance.
- **Need for Safety & Control**: Financial records carry high emotional and practical stakes. Users must be able to **take their data with them** (backup) and **recover confidently** after mistakes, device loss, or migration — without guessing whether old and new rows were blended together.

## 2. Functional Requirements & Agreed Scope (ML & Finance Alignment)
To achieve undeniable financial clarity without over-engineering Day 1 machine learning infrastructure, the Personal Finance and Transaction Analysis experts have agreed to the following scoped MVP features:
- **Account Data Ingestion**: Parse and process user-uploaded data exports (CSV, OFX, QIF). The ML engine will initially process these locally (or via low-cost serverless execution) to avoid expensive, always-on cloud compute.
- **Transaction Clustering & Active Learning**: 100% automated categorization is unrealistic for an MVP. Instead, use lightweight text cleaning to group similar merchants into 'Clusters'. High-confidence clusters (e.g., matching known big merchants) will be mapped to the 10 established categories automatically. Ambiguous clusters will be pushed to a **User Review Queue** for manual tagging, allowing the system to actively 'learn' rules for future transactions.
- **Recurring Subscription Detection**: Instead of complex predictive modeling, recurring subscriptions will be flagged by identifying consistent time intervals and amounts within the identical transaction Clusters.
- **Baseline Metrics Dashboard**: Calculate and visualize simple "money in vs. money out" baseline metrics, relying strictly on the explicitly mapped categories, without enforcing strict budgeting limits yet.

### Backup & restore (user financial data safety)

Users upload **real bank and PFM exports**; the application persists derived transactions, categories, clusters, rules, and related metadata. That dataset is valuable and sensitive. The product **must** therefore support:

1. **Backup (export)**  
   - The user can download a **complete, portable snapshot** of their own financial dataset held by the application — **all persisted DynamoDB-backed entities** for that user (accounts, transactions, clusters, profile, metrics, **import history metadata**).  
   - **V1 scope:** export is **synchronous** (single request/response — no async job queue). **Raw uploaded bank files** are **not** included in the JSON (`TRANSACTION_FILE` **metadata only**; see [`database/data_model.md`](../03_detailed_design/database/data_model.md) §8 and [`import_file_blob_storage.md`](../03_detailed_design/import_file_blob_storage.md)).  
   - Purpose: **safety** (local copy before risky operations), **migration**, and **peace of mind** that structured data is not trapped in the service.

2. **Restore (import snapshot)**  
   - The user can upload a previously generated backup and **restore** their account state from it.  
   - **Restore semantics (mandatory):** restore **fully overwrites** all existing user-scoped application data covered by the backup format with the contents of that backup. The system **must not merge** backup rows with current database rows (no duplicate-resolution-by-merge, no additive union). After a successful restore, the live dataset **must match the backup exactly** for every entity type the backup defines — so the user gets a **precise, predictable** outcome suitable for disaster recovery and “reset to known good state.”  
   - **V1 implementation:** **Validate first**, then **materialize to a dedicated DynamoDB staging table**, validate materialized items, then **replace** the user partition in the primary table by **delete + copy from staging** (see [`database/data_model.md`](../03_detailed_design/database/data_model.md) §8.2). This avoids applying an unvalidated payload directly to production rows while acknowledging DynamoDB’s limits on single giant transactions.  
   - Implications for UX and engineering: restore is a **destructive, irreversible** operation unless the user took another backup first; the UI must warn clearly and require explicit confirmation. Any future “merge” or partial restore behaviour would be **out of scope** for this requirement unless the PRD is revised.

## 3. Data & Metric Requirements
Specific data points vital to calculate and present to the user in Stage 1:
- **Net Worth**: Total Liquid Assets minus Total Outstanding Debt/Liabilities.
- **Monthly Cash Flow**: Cumulative sum of money categorized as 'income' vs. 'expenses' over a given 30-day window or calendar month.
- **Spend by Category**: Total aggregated amount spent per category to highlight primary expense areas vs essential usage. The mandatory categorization taxonomy is:
  1. **Income** (Salary, Transfers In, Refunds)
  2. **Housing & Utilities** (Rent/Mortgage, Electricity, Gas, Water, Internet, Council Tax/Rates)
  3. **Food & Groceries** (Essential Supermarket shopping, Groceries)
  4. **Transportation** (Fuel, Public Transit, Car Maintenance, Ride-sharing)
  5. **Subscriptions & Recurring** (Netflix, Gym Memberships, Cloud Storage, Regular Bills)
  6. **Discretionary & Lifestyle** (Dining Out, Coffee Shops, Shopping, Entertainment, Hobbies)
  7. **Debt Payments** (Credit Card Payments, Personal Loans, BNPL services)
  8. **Health & Wellness** (Medical, Pharmacy, Personal Care)
  9. **Wealth & Savings** (Internal Transfers to Savings, Investments)
  10. **Uncategorized** (Reserved for completely unknown entities requiring user review)

## 4. Non-Functional Requirements (NFRs)
- **Security**: Must implement bank-level encryption (AES-256) for storing any access tokens or sensitive financial data. Strictly zero PII in raw application logs.
- **Multi-Tenancy & Data Isolation**: The system must securely serve and isolate data for multiple users simultaneously. Every single record MUST be tagged with the owning `user_id`. All retrieval operations must strictly scope to the authenticated user's ID, and the application layer must perform a secondary assertion check post-retrieval to guarantee no cross-contamination of data.
- **Reliability & Robustness**: The file parsing engine must resiliently handle format variations natively exported from different financial institutions, ensuring no critical transaction data is missed during file ingestion.
- **User-controlled recoverability**: Backup export must be sufficiently complete and documented that a **full overwrite restore** (see §2) can return the user to a known-good snapshot; backups should be treated as sensitive artifacts (encryption at rest on the server where applicable, secure transport, clear client-side handling guidance).
- **Performance**: Dashboard loading and aggregation calculations should remain under 2 seconds, even for users with thousands of historical transactions.

## Next Steps
Once this MVP functional framework is approved, the next sequence enforced by the **Design Architect** is to advance to the **High-Level Architecture Stage**, which will require the creation of:
1. System Context Diagram
2. Infrastructure Map
3. Data Flow Diagrams (DFD)
