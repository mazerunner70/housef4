---
title: System Context Diagram
stage: Architecture
phase: High-Level Architecture
---

# System Context

This diagram provides a high-level overview of how the MVP Personal Finance system interacts with users and external entities. For the MVP, we skip direct API bank syncing (Open Banking) in favor of user-driven data exports.

```mermaid
C4Context
  title System Context Diagram - Personal Finance MVP
  
  Person(user, "User", "A personal finance user seeking financial clarity, uploading CSV/OFX exports.")
  
  System(pfApp, "Personal Finance MVP", "Cloud-hosted web application that categorizes and visualizes financial data securely.")
  
  System_Ext(bank, "Banking Portals", "External bank websites providing raw CSV/OFX/QIF account exports to the user.")
  
  Rel(user, bank, "Downloads account reports manually.")
  Rel(user, pfApp, "Uploads raw data, reviews ambiguous merchants, and views financial baseline dashboards.")
  
  UpdateLayoutConfig($c4ShapeInRow="2", $c4BoundaryInRow="1")
```
