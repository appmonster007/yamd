---
title: Callouts and study blocks
---

# Callouts and study blocks

A callout is a block quote whose first line is `> [!type] Title`. It ends at the first line that does not start with `>`, so always leave a blank line after it.

## Plain callouts

> [!note] A note
> Notes, tips, warnings and dangers are not numbered.

> [!tip] A tip
> Keep callouts short.

> [!warning] A warning
> Forgetting the blank line after a callout makes the next line part of it.

> [!danger] Danger
> The linter flags a callout that is missing its blank line, with a quick fix.

## Study blocks

Study callouts are numbered per type, in the order they appear in the note.

> [!definition] Prime number ^def-prime
> A natural number greater than 1 that has no divisors other than 1 and itself.

> [!theorem] Euclid's theorem ^thm-euclid
> There are infinitely many primes.

> [!proof]
> Suppose there were finitely many primes $p_1, \dots, p_n$. The number $p_1 p_2 \cdots p_n + 1$ has a prime divisor that is not any $p_i$, which is a contradiction.

> [!example] Small primes
> 2, 3, 5, 7 and 11.

> [!lemma] Divisor lemma ^lem-divisor
> Every integer greater than 1 has a prime divisor.

> [!remark]
> Euclid's proof also shows that the next prime is smaller than $p_1 \cdots p_n + 1$.

> [!question]
> Is $2^{31} - 1$ prime?

> [!summary]
> There are infinitely many primes, and every integer above 1 has a prime divisor.

Body text can use any Markdown: lists, links, math, code.

> [!example] A callout with more inside
> - a list item
> - another one
>
> ```python
> print("code works too")
> ```

Refer to a numbered block by its id with `[@def-prime]`; Build writes the link: [Definition 1](#def-prime), [Theorem 1](#thm-euclid) and [Lemma 1](#lem-divisor).
