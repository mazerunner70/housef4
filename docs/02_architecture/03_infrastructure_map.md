---
title: Infrastructure Map
stage: Architecture
phase: High-Level Architecture
---

# MVP Cloud Infrastructure Map

This diagram outlines the low-cost, serverless AWS infrastructure required for the MVP, ensuring high scalability and near-zero idle compute costs in alignment with our expert directives. The **DynamoDB** single-table key layout, attributes, and `GSI1` access pattern are specified in [`docs/03_detailed_design/database/data_model.md`](../03_detailed_design/database/data_model.md).

```mermaid
flowchart TD
    subgraph "External"
        U[User Web Browser]
    end

    subgraph "AWS Cloud - Production Environment"
    
        subgraph "Edge & Distribution"
            CF[CloudFront] -->|Static Hosting| S3Front[S3 Bucket\nReact/Vite Frontend]
        end
        
        subgraph "API Layer"
            AGW[API Gateway] --> Lambda[AWS Lambda\nNode/TS Backend]
        end
        
        subgraph "Data & Persistence Layer"
            Lambda --> DDB[DynamoDB\nSingle-Table Design]
            Lambda --> S3Raw[S3 Bucket\nRaw Upload Archives]
        end
        
        subgraph "Authentication & Security"
            Cognito[Amazon Cognito\nUser Pools]
        end
    
    end
    
    subgraph "Local Analytics Environment"
        Jupyter[JupyterLab Docker\nData Science / ML Sandbox] -->|Local Script Ingestion| DDB
    end

    %% Client Connections
    U -->|1. Authenticate| Cognito
    U -->|2. Content Delivery| CF
    U -->|3. HTTPS API Requests| AGW
```

## Architecture Decisions

1. **Authentication (Cognito)**: Manages multi-tenancy securely. Every API request receives a verified JWT containing the `user_id`.
2. **Compute (Lambda & API Gateway)**: Serverless execution. We only pay when functions run. There are no expensive always-on API servers.
3. **Database (DynamoDB)**: Fulfills the single-table, low-cost requirements. Application rows are partitioned with `PK = USER#<user_id>`; see [`database/data_model.md`](../03_detailed_design/database/data_model.md) for `SK` patterns (`TXN#`, `CLUSTER#`, `FILE#`, `PROFILE`), GSI1, and entity attributes (`TRANSACTION`, `CLUSTER`, `TRANSACTION_FILE`, `PROFILE`). A separate Terraform item (`health-check` / `BUILD`) is used only for build metadata, not for user data.
4. **Local ML Environment**: The `Jupyter` instance runs exclusively on local developer machines to execute exploratory DBSCAN/clustering without incurring AWS EC2 charges.
