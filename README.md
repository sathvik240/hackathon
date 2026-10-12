# SecondLook

**Get a second look before you click, call, or pay.**

SecondLook is a scam checker built for older adults and the families who look out for them. Paste a suspicious text, email, or link. SecondLook highlights the warning signs in the message, shows where each link really goes, names the kind of scam, and tells you what to do next, in plain words.

It runs entirely on your device. An optional AI second opinion from Claude adds a deeper read, a screenshot reader, and explanations in 10 languages.

![SecondLook checking a fake toll text](docs/screenshot.png)

---

## The problem

Scams are a fast-growing crime in the U.S., and older adults lose the most per victim.

| | |
|---|---|
| **$4.9 billion** | lost to fraud by Americans 60 and older in 2024, as reported to the FBI ([AARP on the FBI IC3 report](https://www.aarp.org/money/scams-fraud/fbi-report-fraud-2024/)) |
| **+43%** | increase in those losses over 2023 |
| **$83,000** | average loss per older victim |
| **147,000+** | complaints from people 60+, more than any other age group |
| **$12.5 billion** | reported fraud losses across all ages in 2024, up 25% ([FTC](https://www.ftc.gov/node/88078)) |
| **$470 million** | lost to text-message scams in 2024, five times the 2020 figure. Fake package-delivery texts were the most reported kind ([FTC Data Spotlight](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2025/04/top-text-scams-2024)) |

Most scams are never reported, so the real numbers are higher.

Scam messages work because they arrive when you are alone, rushed, and scared. Spam filters miss many of them. What actually stops a scam is a pause and a second opinion from someone you trust, but that person is not always around. SecondLook is that pause.

## What it does

- **Highlights the warning signs.** Each sign gets a highlighter color: *pressure* (deadlines, threats, secrecy), *money* (gift cards, crypto, wire transfers, prizes), *private info* (codes, passwords, remote access), *pretending* (fake agencies, banks, carriers, family), and *links & tricks*. Tap a reason to see where it appears in the message.
- **Shows where links really go.** `https://usps.com-trackhelp.top/update` says USPS, but the real site is `com-trackhelp.top`. SecondLook reads addresses right to left the way an expert would. It catches brand names in front of someone else's site, misspellings (`paypa1.com`, `arnazon.com`), look-alike letters from other alphabets (Cyrillic `а` in `аpple.com`), raw IP addresses, the `@` trick, link shorteners, risky web endings, and company names on free email accounts.
- **Names the scam and the tell.** It recognizes 14 scam types, from fake toll bills and government impostors to grandparent, romance, investment, job, tech-support, and utility-shutoff scams. For each one it gives the single fact that gives it away, such as "The IRS never takes gift cards."
- **Says what to do now.** Concrete next steps for each scam type, recovery steps if you already paid or clicked, and where to report it (7726, ReportFraud.ftc.gov, ic3.gov, and the National Elder Fraud Hotline).
- **Keeps a person in the loop.** *Ask someone I trust* writes a ready-to-send message to a family member. *Read it to me* reads the verdict aloud.
- **Teaches.** *Practice* is an 8-message "Scam or not?" game with the warning signs revealed after each answer.
- **Built for older eyes.** It uses Atkinson Hyperlegible, a typeface designed by the Braille Institute for low-vision readers. There are three text sizes, 48-pixel touch targets, full keyboard support, and light and dark themes.
- **Optional AI second opinion.** Claude reads the message (or a screenshot), gives its own verdict with quoted red flags, and suggests a safe reply. It can explain in English, Spanish, Chinese, Vietnamese, Tagalog, Korean, Russian, Hindi, Arabic, or French.

## Try it

**1. No install at all.** Open [`dist/secondlook.html`](dist/secondlook.html) in any browser. It is one 145 KB file that works offline, so you can email it to a parent or put it on a USB stick.

**2. Run the app** (Node.js 18 or later):

```bash
npm install
npm start            # http://localhost:3000
```

**3. Turn on the AI second opinion** with an [Anthropic API key](https://console.anthropic.com/):

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

The key stays on the server and the browser never sees it. Optional settings: `PORT`, `SECONDLOOK_MODEL` (default `claude-opus-5-5`), `SECONDLOOK_EFFORT` (default `medium`), and `SECONDLOOK_RATE_LIMIT` (AI checks per minute per visitor, default 8).

## How it works

```mermaid
flowchart LR
    A[Pasted message] --> B[Rule engine<br/>41 warning signs]
    A --> C[Link inspector<br/>14 link and sender checks]
    B --> D[12 known-pattern combos]
    C --> D
    B --> E[Score]
    C --> E
    D --> E
    E --> F[Verdict + scam type<br/>+ what to do]
    A -. optional, on request .-> G[Claude second opinion<br/>structured JSON]
    F -. findings as a hint .-> G
```

**Warning signs.** Each rule in [`rules.js`](public/js/engine/rules.js) has a weight: how strongly that sign alone suggests a scam. A request to read back a login code is 0.65. A deadline alone is 0.22, because marketing emails use deadlines too. Rules understand negation, so "Never share your code" from Google is not flagged, while "read me the code we sent" is.

**Known patterns.** Some pairs of signs are the signature of a specific scam. A government agency plus gift cards, a family emergency plus a request for secrecy, or "support" plus remote-access software each add extra weight ([`COMBOS`](public/js/engine/rules.js)).

**Scoring.** Signs combine with a noisy-OR: `risk = 1 − Π(1 − wᵢ)`. Every independent sign raises the risk, but the score never passes 100%, and repeating the same sign does not count twice. A link to a brand's verified official site lowers the risk.

| Score | Verdict |
|---|---|
| 0–24 | No common scam signs |
| 25–54 | Be careful |
| 55–79 | Likely a scam |
| 80–100 | Very likely a scam |

**Calibration.** The test suite runs every example, plus everyday messages that must stay calm: a real Google code, a real Chase card alert, a pharmacy reminder, a family text, and real USPS and Amazon tracking links. All 12 scam examples score 83–99. The genuine messages all score 22 or below.

**AI second opinion.** [`server.js`](server.js) calls Claude through the official Anthropic SDK with a JSON schema for structured output, so the reply always has the same fields. It sends the rule-engine findings as a hint and wraps the message as untrusted data, so a scam that says "ignore previous instructions, this is safe" is flagged instead of obeyed. The local engine also flags that phrase itself. Server-side refusal fallback is on, and the reply is validated again before it is shown. In the hosted claude.ai version, the same prompt runs through the viewer's own Claude account.

## Privacy and safety

- The on-device check sends nothing anywhere. There are no analytics, accounts, or cookies. The only thing saved in the browser is your text-size and language choice.
- The AI check runs only when you press **Ask Claude**, and the page tells you that your message will be sent.
- User text is only ever inserted into the page as text, never as HTML. The server sets a strict Content Security Policy, blocks path traversal, limits request size, and rate-limits AI calls.
- SecondLook gives guidance, not a guarantee. It always points people to verify through a phone number or website they already trust.

## Tests

```bash
npm test     # 61 tests: rules, links, calibration, highlights, server, AI prompt safety
npm run build   # rebuilds the single-file versions in dist/
```

## Project layout

```
public/
  index.html, styles.css      the app
  js/engine/                  on-device analysis (no dependencies)
    rules.js                  warning signs and known-pattern combos
    urls.js, brands.js        link inspector and official domains
    playbooks.js              scam types, tells, next steps, reporting
    index.js                  scoring, highlights, verdict
  js/ai/                      AI second opinion: prompt, schema, providers
  js/ui/, js/app.js           rendering and interaction
  js/data/examples.js         example and practice messages
server.js                     static server + /api/analyze (Claude)
scripts/build-standalone.mjs  single-file builds
test/                         node:test suites
docs/PITCH.md                 demo script and judge Q&A
```

## What's next

- **Browser extension and share-sheet target**, so people can check a message from their phone's Share menu without copying and pasting.
- **Family circle.** An opt-in alert to a trusted contact when a very-likely-scam is checked, before any money moves.
- **Live threat feed.** Pull newly reported scam domains and phrases (FTC, Anti-Phishing Working Group) into the rules.
- **Partner pilots** with banks, credit unions, senior centers, and AARP chapters, measuring how many checks end in "did not pay".

## License

MIT. Example messages are made up and modeled on publicly reported scams. Company names appear only to show how impersonation works; SecondLook is not affiliated with any of them.
