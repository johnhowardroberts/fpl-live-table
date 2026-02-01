# FPL Auto-Sub Logic Specification

## Overview

This document describes the correct logic for calculating automatic substitutions in Fantasy Premier League, accounting for:
- Bench order priority
- Formation constraints
- Fixture timing (incomplete gameweeks)
- Interdependency between multiple subs

---

## FPL Auto-Sub Rules

### Basic Rules
1. Auto-subs are processed **in bench order** (positions 12, 13, 14, 15)
2. A bench player can only be used for **one** substitution
3. Subs only occur when a starting player plays **0 minutes** and their **fixture is finished**
4. GK can only be replaced by the bench GK (position 12)

### Formation Constraints
Valid formations must maintain:
- **Minimum 3 defenders**
- **Minimum 2 midfielders** (implied by 1 GK + 3 DEF + 1 FWD = 5, leaving 6 slots, at least 2 must be MID)
- **Minimum 1 forward**

If a sub would violate these minimums, that bench player is **ineligible for that specific sub** (but may still be used for other subs).

---

## Current Problem

The existing implementation has a flaw:

**When a bench player's fixture hasn't started, the code skips them and moves to the next bench player.**

This is incorrect because:
1. We don't know if that bench player will play minutes
2. If they DO play, they would be the auto-sub (being higher in bench order)
3. We cannot predict the sub until we know their fixture outcome

---

## Correct Algorithm

### Key Principles

1. **Subs are interdependent** - must be calculated holistically, not in isolation
2. **Bench order is global** - a bench player skipped for one sub (formation rules) remains available for other subs
3. **Uncertainty must be respected** - if a higher-priority eligible bench player's fixture hasn't started, we cannot confirm the sub
4. **Formation constraints can bypass uncertainty** - if a bench player cannot satisfy a formation requirement regardless of outcome, they can be skipped

### Algorithm

```
INPUT: 
  - starting[]: 11 starting players with their fixture status and minutes
  - bench[]: 4 bench players in order, with fixture status and minutes
  
OUTPUT:
  - confirmedSubs[]: list of {playerOut, playerIn} that are certain
  - pendingSubs[]: list of {playerOut, possibleReplacements[]} that are uncertain

PROCESS:

1. Identify all starting players needing subs:
   needsSub[] = starting players where:
     - minutes == 0 AND
     - fixture is finished (finished || finished_provisional)

2. Calculate current formation (excluding players needing subs):
   currentDEF = count of DEF in starting who played OR whose fixture hasn't finished
   currentMID = count of MID in starting who played OR whose fixture hasn't finished  
   currentFWD = count of FWD in starting who played OR whose fixture hasn't finished

3. Track bench availability:
   availableBench[] = copy of bench[]
   usedBench = Set()

4. For each player in needsSub (process in some consistent order):
   
   a. Determine formation constraint:
      - If player is DEF and currentDEF <= 3: MUST replace with DEF
      - If player is MID and currentMID <= 2: MUST replace with MID
      - If player is FWD and currentFWD <= 1: MUST replace with FWD
      - If player is GK: MUST replace with GK (bench position 1)
      - Otherwise: No constraint (any outfield player)
   
   b. Find replacement from bench (in order):
      
      FOR each benchPlayer in availableBench (in bench order):
        
        IF benchPlayer already in usedBench:
          CONTINUE (already allocated to another sub)
        
        IF formation constraint exists AND benchPlayer doesn't satisfy it:
          CONTINUE (skip - ineligible for THIS sub, but stays available for others)
        
        IF benchPlayer's fixture has NOT started:
          IF formation constraint exists AND benchPlayer CAN'T satisfy it anyway:
            CONTINUE (we can skip because they're ineligible regardless)
          ELSE:
            STOP - mark this sub as PENDING (can't determine yet)
            Add to pendingSubs with this benchPlayer as possible replacement
            BREAK out of bench loop
        
        IF benchPlayer's fixture is finished AND minutes == 0:
          CONTINUE (didn't play, try next bench player)
        
        IF benchPlayer's fixture started/finished AND minutes > 0:
          This is the CONFIRMED sub
          Add to confirmedSubs: {playerOut: player, playerIn: benchPlayer}
          Add benchPlayer to usedBench
          Update formation counts (currentDEF/MID/FWD)
          BREAK out of bench loop
      
      END FOR
      
      IF no replacement found and not pending:
        No valid sub available (all bench players either used or didn't play)

5. Return {confirmedSubs, pendingSubs}
```

---

## Edge Cases

### Case 1: Formation constraint allows skipping uncertain bench players

**Scenario:**
- Starting DEF didn't play (had 3 DEF, now need to maintain 3)
- Bench 1: MID (fixture not started)
- Bench 2: DEF (played, got 6 pts)

**Result:**
- Bench MID cannot satisfy DEF requirement → skip (regardless of fixture status)
- Bench DEF satisfies requirement and played → **CONFIRMED sub**

### Case 2: Must wait for higher-priority bench player

**Scenario:**
- Starting MID didn't play (have 4 MID, no constraint)
- Bench 1: MID (fixture not started)
- Bench 2: FWD (played, got 5 pts)

**Result:**
- Bench MID could satisfy (no constraint) but fixture not started → **PENDING**
- Cannot confirm Bench FWD because Bench MID might play and would take priority

### Case 3: Multiple subs with interdependency

**Scenario:**
- Starting DEF A didn't play (3 DEF → need DEF)
- Starting MID X didn't play (4 MID → no constraint)
- Bench 1: MID (fixture not started)
- Bench 2: DEF (played, got 4 pts)

**Result for DEF A:**
- Bench MID can't satisfy DEF requirement → skip
- Bench DEF satisfies → **CONFIRMED: Bench DEF subs for DEF A**
- Mark Bench DEF as used

**Result for MID X:**
- Bench MID could satisfy, but fixture not started → **PENDING**
- Bench DEF already used → unavailable
- MID X sub is pending, waiting on Bench MID's fixture

### Case 4: GK special handling

**Scenario:**
- Starting GK didn't play
- Bench 1 (GK slot): GK (played, got 2 pts)

**Result:**
- GK can only be replaced by bench GK
- Bench GK played → **CONFIRMED sub**

### Case 5: Chain of uncertainty

**Scenario:**
- Starting DEF didn't play
- Starting MID didn't play
- Bench 1: MID (fixture not started)
- Bench 2: MID (played)
- Bench 3: DEF (fixture not started)
- Bench 4: DEF (played)

**Result for DEF:**
- Bench MID 1: can't satisfy DEF → skip
- Bench MID 2: can't satisfy DEF → skip
- Bench DEF 3: could satisfy, fixture not started → **PENDING**

**Result for MID:**
- Bench MID 1: could satisfy, fixture not started → **PENDING**

---

## Display Recommendations

### For Confirmed Subs
- Show green "↑" arrow on bench player
- Show red "↓" arrow on starting player
- Strikethrough on subbed-out player's points
- Include bench player's points in total

### For Pending Subs
- Show starting player needs sub (red styling, 0 pts)
- Do NOT show any bench player as subbing in
- Optionally: show "?" or "pending" indicator
- Do NOT include any bench player's points in total yet

### For Bench Players
- If confirmed subbing in: show with green highlight, points count
- If pending (might sub in): show normally, points don't count yet
- If fixture not started: show as pending/unknown
- If not subbing in: show dimmed, points crossed out or not shown

---

## Implementation Notes

1. **Process order matters**: When multiple starting players need subs, process them in a consistent order (e.g., by position: GK → DEF → MID → FWD, or by pick order)

2. **Re-evaluate on refresh**: When fixture status changes (a game finishes), re-run the entire algorithm

3. **API vs Local calculation**: 
   - If `picks.automatic_subs` is populated by the FPL API, use that (it's authoritative)
   - Only use local calculation when API hasn't processed subs yet (mid-gameweek)

4. **Points calculation**: 
   - Only include points from **confirmed** subs
   - Pending subs should not affect the displayed total until confirmed
