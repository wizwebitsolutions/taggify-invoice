# Research: creator.wldd.in — WLDD Creator's Network

Analyzed by logging into `https://creator.wldd.in/works` on 2026-08-24 with the credentials provided.

## What it is

**WLDD Creator's Network** is a B2B **influencer/creator campaign management and invoicing platform** used by an agency/network that manages multiple large Instagram pages (e.g. "Adult Society" – 8.1M followers, "Real News Today" – 2.8M, "Sarcasmicworld" – 732K) on behalf of brands. It is not a consumer-facing content site — it's an internal ops tool for creators/page-owners working with WLDD to run sponsored-content campaigns for brands.

Login is phone number + password (no email/SSO seen).

## Core navigation / feature areaswha

| Section | URL | Purpose |
|---|---|---|
| **Campaigns** (redirects to `/dashboard`) | `/dashboard` | Lists "Active Campaigns" — sponsored deals with brands (Spotify, ELOELO, one8, Rashmeet Kaur Concert, Shatam Jeeva, CeraVe, SWIGGY, ChatGPT/OpenAI, etc.), each assigned to a specific social profile/page. |
| **Invoices** | `/invoices` | Invoice management: raise/view invoices, track Invoice Status, Payment Status, and GST Payment Status separately. Shows totals ("Invoice Raised: 16", "Invoice Pending: 0"), amounts up to ₹25L+ per invoice, and a "New Invoice" creation flow. |
| **Assets** | `/assets` | "Social Profiles" registry — the pages/handles managed under this account, each with follower count, approval status, average engagement metrics (avg. likes, etc.), and a **rate card** per content format (Reel, Story, Carousel, Collaboration, Videos) with fixed ₹ pricing (e.g. Reel ₹12,500, Story ₹10,000, Carousel ₹12,500, Collaboration ₹14,000). Includes an "Add Assets" flow to register new pages. |
| **My Works** | `/works` | The main work-tracking dashboard: KPI tiles for Links Added (2.6K), Pending Screenshots (2.5K), Links Approved (2.6K), Links Invoiced (2.0K), Uninvoiced Links (625). Below that, a searchable/filterable grid of individual posted content pieces per campaign, each showing platform icon, approval status ("Approved Post"), engagement stats (likes/comments/views), per-post cost (₹12,500), associated campaign name, and post date. Filters include date range, Post Approval Stage, Insights Approval Status, and page. |
| **Help Desk** | (nav link present, route 404'd directly) | Presumably a support/ticketing section. |
| **FAQs** | (nav link) | Help documentation. |
| Notification bell / profile menu | top right | Account notifications and settings. |

## Workflow implied by the UI

This is essentially a **sponsored-post lifecycle tracker**:
1. A brand campaign is created and assigned to one of the network's social pages.
2. The creator/page posts content and submits the **link** for that post.
3. A **screenshot** (proof of posting/insights) is submitted and goes through an **approval stage**.
4. Once approved, the post's **performance insights** are approved separately.
5. Approved, invoiced posts feed into the **Invoices** module, which tracks payment and GST status through to completion.

## Notable content/product observations
- Multi-brand, high-volume operation: thousands of tracked links/posts across dozens of campaigns.
- Fixed-rate card pricing per content type, per page — suggests a productized/standardized influencer marketing offering rather than ad-hoc negotiation.
- Strong emphasis on **financial compliance**: GST payment status is tracked as a distinct field from generic payment status, and there's a prompt to verify a WhatsApp-linked phone number specifically for invoice alerts.
- The "MVP" surface area (for a tool like this) is essentially: Campaign assignment → Content submission/approval → Insights approval → Invoicing → Payment/GST tracking, wrapped with an assets/rate-card registry for the pages being monetized.
