# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Korean-speaking Hatsune Miku fans preparing for a concert. They practise the crowd calls for each song in the days and weeks before a show, mostly on their phones, and many cannot read kana fluently.

## Product Purpose

Miku Call Guide lets fans rehearse live calls in time with the song: the Japanese lyric, its Hangul reading and each call are shown in sync with YouTube playback, so a fan can walk into the venue knowing when to shout what. Success is a fan who can follow every call in a setlist without reading Japanese.

## Positioning

Calls are anchored to exact characters of the lyric and driven by the video's playback clock. Seeking to a line starts a 3-2-1 countdown into that line, so practice repeats the real lead-in instead of landing cold. The guide is built for Korean readers: the pronunciation is written in Hangul, and the interface is Korean-first.

## Operating Context

- Practice happens alongside a YouTube video embedded on the call-guide page (`#/songs/:songId`).
- The catalog (`#/`) lists songs and can group them by event (concert or tour).
- The event calendar (`#/events`) shows concerts, ticket windows, pop-ups and exhibitions by month, with links to official X posts and sites. It is a supporting feature: knowing when shows happen supports the core job of practising calls.
- Fans can submit or correct events after signing in with GitHub. Submissions become pull requests or issues on the data repository.

## Capabilities and Constraints

- Song, call and event data comes from a separate data repository (`miku-call-guide-data`) through versioned, validated contracts in `data-contracts/`. They are never edited by hand.
- Calls have kinds (`chant`, `penlight`, `custom`), above/below lanes, point and range markers, and intensity.
- When fetching fails, the app falls back to validated cached data.
- Routes use `HashRouter`. Existing routes and published data URLs must stay backward compatible.
- A spoiler notice is shown before first use, and the first catalog screen is shuffled to reduce setlist spoilers. These are current behaviour, not stated brand commitments.
- Hosted on Cloudflare Pages and Pages Functions with a strict CSP.
- This is an unofficial fan project, not affiliated with or approved by the rights holders (README).

## Brand Commitments

- Miku teal `#39c5bb` stays the brand accent.
- Voice: Korean-first, warm and fan-made, rather than a neutral English dashboard (confirmed during the 2026-11-27 critique).

## Evidence on Hand

- Live production at https://miku.sekai.day/ with a real song catalog and event data.
- No testimonials, usage numbers or press exist. Future work must not invent them.

## Product Principles

1. The call is the product. On the practice screen, the cue to shout outranks everything else.
2. Practice the real moment. Rehearsal follows the actual timing and lead-in of a live show.
3. Readable without Japanese. Every call and lyric has a Hangul path.
4. The phone is the primary device. Every core task completes at phone width with touch.
5. Schedules serve practice. Event information supports getting ready for a show, not the other way round.

## Accessibility & Inclusion

- Touch targets are at least 44px. Keyboard, focus, reduced-motion and screen-reader behaviour must be preserved (AGENTS.md).
- Lyric lines and their calls are announced through live regions, and the countdown is announced as it runs.
