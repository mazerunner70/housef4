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

## 2. Functional Requirements & Agreed Scope (ML & Finance Alignment)
To achieve undeniable financial clarity without over-engineering Day 1 machine learning infrastructure, the Personal Finance and Transaction Analysis experts have agreed to the following scoped MVP features:
- **Account Data Ingestion**: Parse and process user-uploaded data exports (CSV, OFX, QIF). The ML engine will initially process these locally (or via low-cost serverless execution) to avoid expensive, always-on cloud compute.
- **Transaction Clustering & Active Learning**: 100% automated categorization is unrealistic for an MVP. Instead, use lightweight text cleaning to group similar merchants into 'Clusters'. High-confidence clusters (e.g., matching known big merchants) will be mapped to the 10 established categories automatically. Ambiguous clusters will be pushed to a **User Review Queue** for manual tagging, allowing the system to actively 'learn' rules for future transactions.
- **Recurring Subscription Detection**: Instead of complex predictive modeling, recurring subscriptions will be flagged by identifying consistent time intervals and amounts within the identical transaction Clusters.
- **Baseline Metrics Dashboard**: Calculate and visualize simple "money in vs. money out" baseline metrics, relying strictly on the explicitly mapped categories, without enforcing strict budgeting limits yet.

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
- **Performance**: Dashboard loading and aggregation calculations should remain under 2 seconds, even for users with thousands of historical transactions.

## Next Steps
Once this MVP functional framework is approved, the next sequence enforced by the **Design Architect** is to advance to the **High-Level Architecture Stage**, which will require the creation of:
1. System Context Diagram
2. Infrastructure Map
3. Data Flow Diagrams (DFD)
