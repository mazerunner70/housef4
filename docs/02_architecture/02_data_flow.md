---
title: Data Flow Diagram (Ingestion & Classification)
stage: Architecture
phase: High-Level Architecture
---

# Data Flow: Ingestion & Active Learning

This diagram illustrates the core MVP workflow: how a user uploads data, how the system parses it and attempts automated mapping, and how the "User Review Queue" facilitates Active Learning.

It also highlights the off-line ML environment (as decided by the Transaction Analysis expertise) to avoid expensive cloud iterations.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Web Frontend
    participant API as Lambda API Backend
    participant DB as DynamoDB (Single Table)
    participant LocalML as Local ML (Jupyter)

    Note over User, DB: 1. Data Ingestion
    User->>UI: Uploads Bank CSV Export
    UI->>API: POST /import (with Auth Token)
    API->>API: Assert user_id & Parse CSV native formatting
    
    Note over API, DB: 2. Categorization Rules Engine
    API->>DB: Query User's existing Rules & Clusters
    
    alt Known/Confident Match
        API->>DB: Save Txn (Status: CLASSIFIED, Category: 'Food & Groceries')
    else Ambiguous/Unknown Merchant
        API->>DB: Save Txn (Status: PENDING)
        API->>DB: Upsert to User Review Queue Index
    end
    API-->>UI: Return Import Summary Metrics
    
    Note over User, API: 3. Active Learning (Review Queue)
    UI->>API: GET /review-queue
    API-->>UI: Return PENDING Clusters
    User->>UI: Tag cluster as 'Discretionary'
    UI->>API: POST /rules
    API->>DB: Save User Rule
    API->>DB: Batch update all historical Txns in Cluster
    
    Note over DB, LocalML: 4. Offline ML Optimization (Non-MVP runtime)
    LocalML->>DB: Sync raw text data locally
    LocalML->>LocalML: Tune TF-IDF / DBSCAN algorithms
    LocalML->>DB: Upload improved heuristic rules
```
