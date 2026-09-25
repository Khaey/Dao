# D.A.O — Project Context

> Living context for ChatGPT Work, Codex, and human contributors.
> This file describes what D.A.O is and what the project is trying to achieve.
> Update `CURRENT_STATE.md` and `NEXT_STEPS.md` after every meaningful development session.

## 1. Product

**Name:** D.A.O  
**Positioning:** construction / renovation / repair marketplace and project workflow platform.  
**Primary target:** Tunisia first, with a design that can later extend to MENA.

**Product promise:** transparency, precision, trust across the lifecycle of a construction or repair project.

D.A.O is not only a directory of artisans. It is meant to structure the full workflow between:

- client;
- D.A.O reviewer / staff;
- artisan / contractor;
- later: contracting, execution, payment and dispute flows.

## 2. Main user roles

### Client

The client can:

- create a project;
- describe the project;
- define general budget and dates;
- create one or more work requests / lots;
- attach plans, photos and documents;
- store private chantier details;
- prepare the DAO;
- submit for D.A.O review;
- receive rejection comments;
- correct and resubmit;
- continue toward publication and offers.

### Artisan / contractor

An authorized artisan can:

- see only publications they are allowed to see;
- view the safe/public project information;
- submit offers;
- version their own offers;
- never see competitors' bids, prices or private documents.

### D.A.O reviewer / staff

A reviewer can:

- review submitted project versions;
- reject with a reason;
- approve;
- keep review history traceable.

### Admin

Admin privileges must never be self-assignable from the browser.

## 3. Core workflow

Current intended high-level flow:

```text
CLIENT
  create project
  -> complete general information
  -> define work requests / lots
  -> add documents
  -> add private details
  -> prepare DAO
  -> submit for review

D.A.O REVIEWER
  -> review
  -> reject + reason
     OR
  -> approve

CLIENT AFTER REJECTION
  -> see rejection reason
  -> create/correct a new draft version
  -> resubmit

AFTER APPROVAL
  -> publication
  -> artisan discovery / invitation rules
  -> offers / bids
  -> offer versions
  -> later award / contract / execution flows
```

## 4. Current development phase

The project is currently in **P1.1 stabilization**.

P1/P1.1 concerns the client project preparation and review workflow, plus UX coherence around:

- project creation and editing;
- project status;
- lots / requests;
- private information;
- project documents;
- review / rejection / correction;
- responsive behavior;
- E2E stabilization.

Do **not** start a new product phase until P1.1 is explicitly validated.

## 5. Important product boundaries

The current stabilization must not break already established downstream flows:

- reviewer;
- publication;
- artisan;
- bids / offers;
- offer versioning;
- award-related foundations;
- authentication;
- RLS;
- private storage and signed URLs;
- CI/CD.

## 6. Product concepts that must not be confused

### Project

The client's overall chantier / repair / construction project.

### Project version

A version of the general project data and its review state.

### Project request / lot

The current technical and business unit used downstream for publication, bidding and award.

A project may contain multiple requests.

### Bid / offer

An artisan's commercial/technical response.

### Award

The unit of award is currently the **request**, not the entire project.

## 7. Product direction for simple projects

The desired UX is eventually:

```text
Simple project
-> client can treat the complete project as one scope
```

and:

```text
Split project
-> Plumbing
-> Electricity
-> Tiling
...
```

However, the technical model currently relies on `project_requests` downstream.

Therefore the user must not be forced to understand the internal abstraction, but the model must **not** be removed casually.

A possible future solution is an implicit/default request such as `Projet complet`, created automatically and hidden from the client.

This is **not to be implemented during the current P1.1 stabilization** without a dedicated impact study.

## 8. Working principles

Every agent working on the project must:

1. inspect the actual repository state before changing code;
2. verify the actual latest GitHub `main`;
3. inspect the latest CI before assuming an old failure is still relevant;
4. distinguish:
   - product bug;
   - obsolete E2E test;
   - fixture/data issue;
   - environment issue;
   - business-rule inconsistency;
5. fix root causes, not symptoms;
6. avoid artificial sleeps, retries and huge timeouts;
7. avoid schema/RLS/RPC changes for a UI-only problem;
8. preserve previous validated security constraints;
9. update the AI context files after significant milestones.

## 9. Repository

Official repository:

```text
Khaey/Dao
```

Main application areas currently include:

```text
dao-frontend/
dao-backend/
.github/
ops/
```

The current frontend contains project, reviewer, publication, artisan and bid flows.

## 10. Source of truth

When information conflicts, use this priority:

1. actual current code on GitHub `main`;
2. actual applied DEV database state;
3. latest successful/failed CI evidence and artifacts;
4. `CURRENT_STATE.md`;
5. `DECISIONS.md`;
6. older chat history.

Chat history is **not** the project source of truth.
