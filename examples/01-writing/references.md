---
title: Figures, tables and citations
bibliography: refs.bib
citation-style: apa
---

# Figures, tables and citations

Run **YAMD: Build** to turn references into links and to fill the sections between the `yamd` markers. Build only changes reference labels and marker content, and a second run changes nothing.

<!-- yamd:toc depth=2 -->
- [Figures, tables and citations](#figures-tables-and-citations)
  - [Cross-references](#cross-references)
  - [Citations](#citations)
  - [References](#references)
<!-- /yamd:toc -->

## Cross-references

Mark a figure, table or equation with `^id` on its own line after it. The prefix (`fig-`, `tbl-`, `eq-`) decides the numbering group.

![The system architecture](../assets/architecture.svg)

^fig-arch

Table: Measured latency

| Region | Latency (ms) |
| ------ | ------------ |
| EU     | 42           |
| US     | 31           |

^tbl-latency

$$ E = mc^2 $$

^eq-energy

Write `[@fig-arch]` and Build links it: see [Figure 1](#fig-arch), [Table 1](#tbl-latency) and [Equation 1](#eq-energy). The label (Figure 1, Table 1, Equation 1) is refreshed on every Build, so adding a figure above renumbers the rest.

## Citations

Cite with `[@key]`, a locator after a comma, or several keys with semicolons. Build links each citation to its entry in the reference list and keeps the label for the style in the front matter (`citation-style: apa`, `ieee`, `chicago`, `harvard` or `mla`).

Logical clocks order events without a shared clock [(Lamport, 1978)](#ref-lamport1978 "cite"). MapReduce popularised this style of processing [(Dean & Ghemawat, 2008, p. 107)](#ref-dean2008 "cite: p. 107"), and the classic reference is [(Knuth, 1997)](#ref-knuth1997 "cite").

Switch off the links with the `yamd.build.linkCitations` setting; the reference list is built either way.

## References

<!-- yamd:bibliography -->
- <a id="ref-dean2008"></a>Dean, J., &amp; Ghemawat, S. (2008). MapReduce: Simplified Data Processing on Large Clusters. <i>Communications of the ACM</i>, <i>51</i>(1), 107–113.
- <a id="ref-knuth1997"></a>Knuth, D. E. (1997). <i>The Art of Computer Programming, Volume 1.</i> Addison-Wesley.
- <a id="ref-lamport1978"></a>Lamport, L. (1978). Time, Clocks, and the Ordering of Events in a Distributed System. <i>Communications of the ACM</i>, <i>21</i>(7), 558–565.
<!-- /yamd:bibliography -->
