---
title: Flashcards
course: Geography
---

# Flashcards

A flashcard is a callout of type `card`. The title is the question and the body is the answer. Run **YAMD: Review Cards** to review the cards in all your notes with spaced repetition (SM-2). Schedules are saved in `.yamd/srs.json`, which you can commit.

A card is identified by its question, so you can edit the answer freely; changing the question starts the card's schedule again. Add `^id` to the title to keep a schedule through question edits.

> [!card] What is the capital of Australia?
> Canberra.

> [!card] Which is the longest river in South America?
> The Amazon.

> [!card] Name the three Baltic states ^baltic
> Estonia, Latvia and Lithuania.
>
> They regained independence in 1991.

> [!card] What causes the tides?
> The gravitational pull of the Moon and, less strongly, the Sun on the oceans.

Cards can use any Markdown in the answer, including math ($e^{i\pi} + 1 = 0$) and lists:

> [!card] What are the primary colours of light?
> - Red
> - Green
> - Blue

## Try it

1. Run **YAMD: Review Cards**. Read a question, reveal the answer, then rate how well you knew it.
2. Reviewed cards come back later (SM-2). Open `.yamd/srs.json` to see the schedule.
3. Add a card with `card` and Tab, or **Insert Callout…** and pick *card*.
4. Edit an answer: the schedule stays. Edit a question without a `^id`: it starts again.
