---
title: Study this note and Check this note
course: Examples
---

# Study this note and Check this note

## Study this note

**YAMD: Study This Note** turns the definitions, theorems, lemmas and questions below into flashcards, written as card callouts in a generated region at the end of the note, then starts a review. Running it again only rewrites that region. Once a day YAMD also says how many cards are due and which deadlines are today or overdue (turn that off with `yamd.study.reminders`).

> [!definition] Prime number
> A whole number greater than 1 whose only divisors are 1 and itself.

> [!theorem] Euclid
> There are infinitely many primes.

> [!question] Is 1 a prime number?
> No. A prime has exactly two divisors.

<!-- yamd:cards -->
> [!card] Definition: Prime number
> A whole number greater than 1 whose only divisors are 1 and itself.

> [!card] Theorem: Euclid
> There are infinitely many primes.

> [!card] Is 1 a prime number?
> No. A prime has exactly two divisors.

<!-- /yamd:cards -->

## Check this note

**YAMD: Check This Note** gathers every problem into one list, jumps to the line when you pick one, and offers to fix the safe ones. It reports:

| Code | Problem |
|---|---|
| W001–W007 | duplicate or invalid widget ids, unclosed blocks, incomplete query headers |
| C001–C002 | callout problems, such as a missing blank line after one |
| M001–M003 | unknown, unclosed or stray `yamd:` markers |
| N001 | an image that does not exist |
| N002 | a data file or gallery folder that does not exist |
| N003 | a `[@fig-…]` reference with no `^fig-…` target |
| N004 | a citation key missing from the bibliography file |

This note is clean, so the command reports nothing.

## Try it

1. Run **YAMD: Study This Note**. The cards region is rewritten and a review starts.
2. Delete the blank line under a callout, then run **YAMD: Check This Note**. Pick the item to jump to it, then accept the fix.
3. Add `[@fig-nothing]` and run Check again: it reports a missing target.
