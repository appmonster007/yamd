---
title: Binary search
course: CS101
date: 2026-11-05
tags: [lecture]
reviewed: 2026-11-05
bibliography: refs.bib
citation-style: apa
---

# Binary search

**Course:** CS101 · **Date:** 2026-11-05 · **Lecturer:** Dr. Knuth

New study notes come from **YAMD: New Study Note** (lecture, lab report, exam prep or reading note). The front matter's `course` groups notes in the dashboard, and `reviewed` feeds the stale-topics list.

## Objectives

- Explain how binary search halves the search space
- State its running time

## Notes

Binary search finds an item in a sorted array by comparing against the middle element and discarding half of the array each step [(Knuth, 1998)](#ref-knuth1998 "cite").

> [!definition] Binary search ^def-bsearch
> A search that compares the target with the middle of a sorted range and recurses into the half that can still contain it.

> [!theorem] Running time ^thm-bsearch
> Binary search on $n$ items makes at most $\lfloor \log_2 n \rfloor + 1$ comparisons.

## Questions

> [!question] What happens if the array is not sorted?
> Think about which half you would discard.

## Review cards

> [!card] What is the time complexity of binary search?
> $O(\log n)$, because each comparison halves the search space.

> [!card] What must be true of the input?
> It must be sorted.

## Summary

> [!summary]
> Binary search runs in logarithmic time on sorted data.

## To do

- [ ] Read chapter 6.2 {due=2026-11-12}
- [ ] Implement binary search in Python {due=2026-11-14}

## References

<!-- yamd:bibliography -->
- <a id="ref-knuth1998"></a>Knuth, D. E. (1998). <i>The Art of Computer Programming, Volume 3: Sorting and Searching.</i> Addison-Wesley.
<!-- /yamd:bibliography -->
