# NodeProbe Architecture

> Internal architecture document for maintainers and AI agents.
>
> This document explains **why** NodeProbe is designed this way. Code, generated YAML, and individual workflow runs are implementation details and must not be used alone to redefine the architecture.

## 1. Project Goal

NodeProbe is building and maintaining its **own persistent proxy-node pool**.

Sources are inputs to the system, not the final product.

The intended system is:

```
Source
  ↓
Discovery
  ↓
Validation
  ↓
Tracking
  ↓
Selection
  ↓
NodeProbe-owned Node Pool
  ↓
Subscriptions
```

The project should gradually become an inventory-maintenance system with incremental discovery, rather than a one-shot source-ranking system.

## 2. Core Concepts

There are three distinct objects that must not be conflated:

### Source

A Source is an external information channel that can provide proxy-node candidates.

A source can:
- discover new nodes;
- remove old nodes;
- rotate its node list;
- continuously provide new information;
- become stale or stop updating.

A Source is **not** the owner of the nodes in NodeProbe's final pool.

### Node

A Node is an individual proxy endpoint discovered by NodeProbe.

A node has its own history:
- firstSeen;
- lastSeen;
- observed runs;
- health results;
- success/failure history;
- lifetime;
- current and historical sources;
- lifecycle status.

A node's quality must primarily be determined by evidence about that node itself.

### Node Pool

The Node Pool is NodeProbe's persistent inventory of known nodes.

It must survive source rotation.

A node disappearing from a source does not automatically mean that the node has died.

## 3. Source Reputation vs Node Reputation

This separation is fundamental.

### Source Reputation

Source reputation answers:

> "Is this source still a useful long-term scouting channel for NodeProbe?"

It considers:
- freshness / update activity;
- quality of nodes historically supplied;
- survival of supplied nodes;
- fetch / parse reliability;
- long-term evolution;
- source history.

It is used mainly for:
- source lifecycle;
- probe scheduling;
- deciding how much attention a source deserves.

Source reputation should **not** directly punish an individual node merely because the node came from a disliked source.

### Node Reputation

Node reputation answers:

> "How good and healthy is this specific node?"

It is based on NodeProbe's own evidence:
- current health;
- historical health;
- success rate;
- latency;
- recent failures;
- persistence / lifetime.

A good node from a weak source can still be a good node.

## 4. Source Evolution

Source evolution is an observational layer.

For each source, observe how its node set changes over time:
- node count;
- added nodes;
- removed nodes;
- retained nodes;
- replacement rate;
- quality of replacements;
- long-term quality trend.

### Important rule

**High source churn is not automatically bad.**

A source may deliberately rotate nodes and still be valuable if it continuously discovers useful nodes.

Therefore replacement rate / churn is currently **observed, not directly penalized**.

The system should distinguish:

- Node Stability: whether a specific node remains useful over time.
- Source Evolution: whether a source continuously produces useful information.

These are different dimensions.

## 5. Node Lifecycle

The intended lifecycle is:

```
NEW
 ↓
PROBATION
 ↓
ACTIVE
 ↓
STABLE
 ↓
STALE
 ↓
DEAD
```

The lifecycle is evidence-based.

Current implementation uses health observations and persistence signals. In particular:

- newly observed healthy nodes start in PROBATION;
- repeated healthy observations move nodes toward ACTIVE;
- sufficiently persistent healthy nodes become STABLE;
- temporary absence or failures do not immediately mean DEAD;
- repeated failure evidence can move a node toward STALE / DEAD;
- historical STABLE nodes should be treated as valuable assets.

The exact thresholds are implementation parameters, not the architecture itself.

## 6. Source Absence Is Not Node Death

This is one of the most important rules.

If:

```
Source A
  run 1 → Node X
  run 2 → Node X
  run 3 → Node X disappears
```

Node X must not immediately be deleted.

Possible explanations include:
- Source A rotated its list;
- Source A temporarily failed to publish Node X;
- Node X moved to another source;
- Node X is temporarily unreachable;
- Node X actually died.

Only NodeProbe's own validation and accumulated history should determine the node lifecycle.

## 7. Persistent Node Pool

The persistent pool is the bridge between independent workflow runs.

Current data files include:

- `data/node-pool.json`
- `data/source-evolution.json`

The update process is conceptually:

```
Current Sources
      +
Historical Node Pool
      ↓
Candidate Set
      ↓
Health Validation
      ↓
Node Pool Update
      ↓
Current NodeProbe Inventory
```

This means NodeProbe is not rebuilt from zero every run.

Historical non-dead nodes can return to the candidate set and be tested again.

## 8. Health Validation

Health testing is NodeProbe's own evidence about nodes.

The general principle is:

```
Discovery says:
    "This node exists."

Health testing says:
    "NodeProbe can currently use this node."

Node history says:
    "How trustworthy has this node been over time?"
```

External source metadata is therefore evidence for discovery, not unquestionable truth.

Repeated observations are more important than a single successful or failed run.

## 9. Source Scheduling

Source reputation and registry state influence how frequently sources are probed.

Conceptually:

```
trusted   → frequent enough
normal    → regular
weak      → less frequent
degraded  → less frequent
stale     → infrequent
dead      → very infrequent
```

The exact intervals are implementation details and may change after observing real workflow data.

A source that becomes fetchable again may be given another opportunity; recovery should then be evaluated using actual source evidence.

## 10. Subscription Generation

The final YAML subscriptions are outputs of NodeProbe's own selection process.

They should not simply mirror a single external source.

Current/future pools may include concepts such as:

- best / general pool;
- country / region pool;
- stable pool;
- fast pool;
- adaptive pool.

The important invariant is:

> The subscription is a view of NodeProbe's own node inventory, not a copy of a source.

## 11. Geographic Detection

NodeProbe can detect the apparent geographic location of a node's server IP.

Current flow:

```
Node
 ↓
Server / hostname
 ↓
DNS / IP
 ↓
IP geolocation
 ↓
Detected country
 ↓
Country-aware selection
```

Declared source country and detected IP country are separate pieces of information.

Geographic detection is supporting metadata. It must not override direct health evidence about the node.

## 12. Data Model Responsibilities

Important persistent data:

| File | Responsibility |
|---|---|
| `data/candidates.json` | Current discovered candidate set |
| `data/history.json` | Multi-round health history |
| `data/reputation.json` | Node health/reputation history |
| `data/node-pool.json` | Persistent NodeProbe-owned node inventory |
| `data/source-history.json` | Historical source observations |
| `data/source-reputation.json` | Source-level reputation |
| `data/source-evolution.json` | Source node-set evolution |
| `data/ip-geolocation.json` | Cached node IP geolocation |
| `data/country-pool.json` | Country-pool selection information |

Do not casually merge these responsibilities. They exist at different abstraction levels.

## 13. Decision Boundaries

When changing the system, preserve these boundaries:

### Source-level decisions

Use:
- source freshness;
- source reliability;
- source quality;
- source evolution.

Do not use source churn alone as a negative signal.

### Node-level decisions

Use:
- current health;
- historical health;
- latency;
- persistence;
- failure history.

Do not automatically inherit a source's reputation.

### Pool-level decisions

Use:
- lifecycle;
- node quality;
- diversity;
- availability;
- historical assets.

The pool is the final product layer.

## 14. What AI Maintainers Must Not Assume

An AI agent modifying NodeProbe must not assume:

1. The best source is the final objective.
2. A source with many rotating nodes is necessarily bad.
3. A node disappearing from a source means the node is dead.
4. A source's reputation should directly lower every node from that source.
5. A single workflow run is enough evidence to change an architectural threshold.
6. Historical node data can safely be deleted just because it is absent from the current source snapshot.
7. Generated YAML is the source of truth for the architecture.
8. Current implementation thresholds are permanent design decisions.
9. More scoring mechanisms automatically make the system better.
10. A mechanism should be added merely because it can be measured.

Before changing an architectural rule, inspect:
- `worklog/architecture.md`;
- the latest `worklog/checkpoint-*.md`;
- the relevant scripts;
- actual generated data from recent workflow runs.

## 15. Current Implementation Map

Major responsibilities currently include:

- `scripts/discover-sources.js`
  - source discovery and source probing schedule;
- `scripts/fetch-sources.js`
  - fetching source contents;
- `scripts/build-subscriptions.js`
  - candidate aggregation, source statistics, node scoring and subscription construction;
- `scripts/test-google.js`
  - multi-round health validation and reputation/history generation;
- `scripts/update-node-pool.js`
  - persistent node lifecycle and source evolution updates;
- `scripts/detect-ip-country.js`
  - node server IP geolocation;
- `scripts/convert-subscriptions.js`
  - conversion of generated node pools into Mihomo-compatible subscription/config outputs.

The GitHub Actions workflow orchestrates these stages.

## 16. Current Architecture in One Diagram

```
                    ┌──────────────────┐
                    │      Sources     │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │    Discovery     │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
     Source Evolution                Node Discovery
              │                             │
              ▼                             ▼
     Source Reputation                Health Testing
              │                             │
              │                             ▼
              │                     Node Reputation
              │                             │
              └──────────────┐              │
                             ▼              ▼
                       ┌────────────────────────┐
                       │ Persistent Node Pool   │
                       └────────────┬───────────┘
                                    │
                                    ▼
                               Selection
                                    │
                                    ▼
                         NodeProbe Subscriptions
```

## 17. Future Direction

The long-term direction is:

### Phase A — Memory

Make NodeProbe remember nodes and sources across runs.

### Phase B — Lifecycle

Make node retention/death decisions based on accumulated evidence rather than snapshots.

### Phase C — Source Evolution

Understand whether a source is:
- stale;
- consistently poor;
- useful but highly rotating;
- continuously discovering valuable nodes.

### Phase D — Better Selection

Build different views of the same NodeProbe-owned inventory:
- stable;
- fast;
- geographic;
- adaptive.

### Phase E — Adaptive System

Eventually allow source probing, node testing, and pool construction to adapt to observed system behavior.

The order is intentional: **memory first, then interpretation, then optimization**.

## 18. Engineering Philosophy

NodeProbe should favor:

- persistent evidence over snapshots;
- observation over assumptions;
- node-level evidence over source-level prejudice;
- incremental discovery over complete replacement;
- simple mechanisms over unnecessary complexity;
- reversible decisions over destructive deletion;
- real workflow data over premature threshold tuning.

When uncertain, preserve historical information and collect evidence before making an irreversible decision.

---

**Last architectural revision:** 2026-09-18
