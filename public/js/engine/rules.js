// Warning signs SecondLook looks for, written the way a careful friend
// would explain them. Each rule belongs to one highlighter group and can
// hint at what kind of scam the message is (`kinds`).
//
// weight   how strongly this sign alone suggests a scam (0 to 1)
// negatable   skip matches preceded by "never", "don't", etc.
// skipIf   skip a match when its sentence also matches this pattern

export const GROUPS = {
  pressure: { label: 'Pressure', hint: 'Rushing, scaring, or asking for secrecy' },
  money: { label: 'Money', hint: 'Unusual payments, prizes, and offers' },
  private: { label: 'Private info', hint: 'Codes, passwords, and access to your devices' },
  pretend: { label: 'Pretending', hint: 'Claims to be a company, agency, or loved one' },
  tricks: { label: 'Links & tricks', hint: 'Links, phone numbers, and hidden tricks' },
};

const PHONE = String.raw`(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}`;
// A login or verification code, as opposed to a wifi or door code.
const AUTH_CODE = String.raw`(?:(?:verification|security|one[- ]time|confirmation|login|sign[- ]in|access|authentication|sms|text|\d[- ]?digit)\s+(?:code|number|pin)|passcode|otp)`;
const GIFT_CARD = String.raw`(?:gift ?cards?|prepaid (?:debit |visa )?cards?|green ?dot|vanilla (?:visa|gift)|money ?pak|reloadable cards?)`;

export const RULES = [
  // Pressure
  {
    id: 'deadline', group: 'pressure', weight: 0.22, kinds: [],
    title: 'Rushes you to act fast',
    why: 'Scammers set short deadlines so you act before you think or ask anyone. Real organizations give you time.',
    patterns: [
      /\b(?:within|in the next|in)\s+\d{1,2}\s*(?:hours?|hrs?|minutes?|mins?)\b/gi,
      /\b(?:act|respond|reply|call|pay|verify|update|click|confirm)\s+(?:now|immediately|right away|today|asap)\b/gi,
      /\b(?:urgent(?:ly)?|immediately|final (?:notice|warning|reminder)|last (?:notice|warning|chance)|time[- ]sensitive|expires? (?:today|tonight|soon)|today only|before it'?s too late|don'?t delay)\b/gi,
    ],
  },
  {
    id: 'threat_legal', group: 'pressure', weight: 0.4, kinds: ['government'],
    title: 'Threatens arrest or legal trouble',
    why: 'Government agencies do not threaten to arrest you by phone, text, or email. The threat is there to scare you into paying.',
    patterns: [
      /\b(?:arrest(?:ed)?|warrant|lawsuit|legal action|prosecut\w*|criminal charges?|deport\w*|seiz(?:e|ed|ure)|court summons|federal charges?|jail time)\b/gi,
    ],
    skipIf: /\b(?:i'?m|i am|i was|got)\s+(?:in jail|arrested)\b/i,
  },
  {
    id: 'threat_loss', group: 'pressure', weight: 0.3, kinds: [],
    title: 'Threatens to cut you off or charge you more',
    why: 'Warnings that your account will be closed or that fees will pile up are meant to make you panic and click.',
    patterns: [
      /\bwill be\s+(?:permanently\s+)?(?:suspended|closed|terminated|deleted|locked|frozen|disabled|blocked|restricted|cancell?ed|deactivated|disconnected|revoked)\b/gi,
      /\b(?:late fees?|penalt(?:y|ies)|additional (?:fees|charges)|lose access|service interruption|legal fees will)\b/gi,
    ],
  },
  {
    id: 'secrecy', group: 'pressure', weight: 0.5, kinds: [],
    title: 'Asks you to keep it a secret',
    why: 'Scammers tell you not to talk to family or your bank because those people would stop the scam.',
    patterns: [
      /\b(?:don'?t|do not|never)\s+(?:tell|discuss|mention|talk to|speak to|say anything to)\b[^.!?\n]{0,30}\b(?:anyone|anybody|family|mom|dad|mum|bank|teller|police|wife|husband|kids|children|son|daughter|parents|this)\b/gi,
      /\bkeep (?:this|it)\s+(?:between us|(?:a )?secret|confidential|private|quiet)\b/gi,
      /\b(?:don'?t|do not)\s+hang up\b|\bstay on the line\b/gi,
      /\bif (?:the )?(?:bank|teller|anyone|they) asks?\b/gi,
    ],
    skipIf: /\b(?:code|passcode|password|pin)\b/i,
  },
  {
    id: 'virus_scare', group: 'pressure', weight: 0.5, kinds: ['tech_support'],
    title: 'Says your computer or phone is infected',
    why: 'Real security companies do not send pop-ups or texts telling you to call them about a virus.',
    patterns: [
      /\b(?:virus|malware|spyware|trojan|hackers?)\b[^.!?\n]{0,40}\b(?:detected|found|infected|installed|accessing|accessed|attack)\b/gi,
      /\byour (?:computer|pc|device|phone|mac|iphone|ip address|system)\b[^.!?\n]{0,25}\b(?:infected|hacked|compromised|blocked|locked)\b/gi,
      /\b(?:do not|don'?t)\s+(?:turn off|shut down|restart|close|power off)\s+your\s+(?:computer|pc|device|browser)\b/gi,
    ],
  },

  // Money
  {
    id: 'gift_cards', group: 'money', weight: 0.65, kinds: [],
    title: 'Wants payment in gift cards',
    why: 'No real business or government agency takes gift cards as payment. Once you share the numbers on the back, the money is gone.',
    patterns: [
      new RegExp(String.raw`\b(?:pay|paid|paying|payment|buy|buying|purchase|send|get|pick up|scratch|read)\b[^.!?\n]{0,70}\b${GIFT_CARD}`, 'gi'),
      new RegExp(String.raw`\b${GIFT_CARD}[^.!?\n]{0,30}\b(?:as payment|to pay|numbers?|codes?|pins?|on the back)\b`, 'gi'),
    ],
  },
  {
    id: 'crypto_payment', group: 'money', weight: 0.6, kinds: [],
    title: 'Wants payment in Bitcoin or crypto',
    why: 'Crypto payments cannot be reversed or traced back to a real person. That is why scammers ask for them.',
    patterns: [
      /\b(?:bitcoin|crypto(?:currency)?)\s+(?:atm|machine|kiosk)\b/gi,
      /\b(?:pay|send|deposit|transfer|convert|buy)\b[^.!?\n]{0,30}\b(?:bitcoin|btc|crypto(?:currency)?|usdt|tether)\b/gi,
      /\b(?:bitcoin|btc|crypto(?:currency)?|usdt)\s+(?:wallet|address)\b/gi,
    ],
  },
  {
    id: 'crypto_mention', group: 'money', weight: 0.2, kinds: ['investment'],
    title: 'Talks about cryptocurrency',
    why: 'Crypto shows up in most investment scams. Be very careful with anyone you have not met in person who brings it up.',
    patterns: [/\b(?:bitcoin|crypto(?:currency)?|usdt|tether|ethereum|binance|coinbase)\b/gi],
  },
  {
    id: 'wire', group: 'money', weight: 0.45, kinds: [],
    title: 'Wants a wire transfer',
    why: 'Wired money is almost impossible to get back. Scammers prefer it for that reason.',
    patterns: [/\b(?:western union|moneygram|wire transfer|wire (?:the )?(?:money|funds|payment|it))\b/gi],
  },
  {
    id: 'p2p', group: 'money', weight: 0.3, kinds: [],
    title: 'Wants money through Zelle, Venmo, or Cash App',
    why: 'These apps are for paying people you know. Money sent to a stranger usually cannot be recovered.',
    patterns: [
      /\b(?:by|via|through|with|on|using|over)\s+(?:zelle|cash ?app|venmo|apple cash)\b/gi,
      /\b(?:zelle|venmo|cash ?app)\s+(?:me|it|the money|the funds|yourself)\b/gi,
      /\bsend (?:it |the money |money )?(?:by |via |through )?(?:zelle|venmo|cash ?app)\b/gi,
    ],
  },
  {
    id: 'cash_courier', group: 'money', weight: 0.65, kinds: [],
    title: 'Wants cash picked up or mailed',
    why: 'Sending a courier to collect cash, or asking you to mail cash, is a scam every time.',
    patterns: [
      /\b(?:courier|driver|agent|someone|a man|a woman|messenger)\b[^.!?\n]{0,40}\b(?:pick (?:it )?up|collect|come (?:by|to your (?:house|home|door)))\b/gi,
      /\bcash\b[^.!?\n]{0,30}\b(?:envelope|shoebox|box|mail it|overnight)\b/gi,
    ],
  },
  {
    id: 'upfront_fee', group: 'money', weight: 0.4, kinds: ['prize', 'delivery', 'job'],
    title: 'Asks for a small fee first',
    why: 'A small fee to release a prize, package, or job is the hook. The fee, and your card details, are what they want.',
    patterns: [
      /\b(?:processing|shipping|handling|release|customs|clearance|redelivery|re-delivery|activation|registration|small|one-time)\s+fees?\b/gi,
      /\bpay\b[^.!?\n]{0,25}\$\s?\d+(?:\.\d{2})?[^.!?\n]{0,25}\b(?:shipping|fee|to claim|to receive|to release)\b/gi,
    ],
  },
  {
    id: 'prize', group: 'money', weight: 0.5, kinds: ['prize'],
    title: 'Says you won something',
    why: 'You cannot win a contest you never entered. Real prizes never ask you to pay to collect them.',
    patterns: [
      /\byou(?:'ve| have)?\s+(?:just\s+)?(?:won|been selected|been chosen)\b/gi,
      /\b(?:congratulations[!,.]?\s+you|lottery|sweepstakes|jackpot|cash prize|claim your (?:prize|reward|gift|winnings)|free (?:gift|iphone|ipad|vacation|cruise|laptop))\b/gi,
      /\bunclaimed (?:funds|money|inheritance|prize|reward)\b/gi,
    ],
  },
  {
    id: 'refund_bait', group: 'money', weight: 0.35, kinds: ['government', 'prize'],
    title: 'Promises a refund or money you are owed',
    why: 'Fake refunds are bait to get your bank or card details.',
    patterns: [
      /\byou(?:'re| are)?\s+(?:eligible|entitled|owed|due|approved)\s+(?:for|to)?\s*(?:a |an )?(?:refund|rebate|reimbursement|compensation|payout|grant|stimulus)\b/gi,
      /\b(?:claim your refund|tax refund (?:is )?pending|overpayment refund)\b/gi,
    ],
  },
  {
    id: 'inheritance', group: 'money', weight: 0.5, kinds: ['prize'],
    title: 'Offers a large sum from a stranger',
    why: 'Strangers do not hand out inheritances or millions of dollars. These letters lead to endless "fees".',
    patterns: [
      /\b(?:inheritance|next of kin|late (?:husband|client|father)|estate of the late)\b/gi,
      /\$\s?\d{1,3}(?:,\d{3}){2,}(?:\.\d{2})?|\b\d+(?:\.\d+)?\s?million (?:dollars|usd)\b/gi,
    ],
  },
  {
    id: 'investment', group: 'money', weight: 0.5, kinds: ['investment'],
    title: 'Promises guaranteed or huge returns',
    why: 'No honest investment is guaranteed or doubles your money. This is the core promise of investment scams.',
    patterns: [
      /\b(?:guaranteed|risk[- ]free|no[- ]risk)\s+(?:returns?|profits?|income|investment|earnings|gains)\b/gi,
      /\b(?:double|triple)\s+your\s+(?:money|investment|bitcoin|savings)\b/gi,
      /\b\d{1,3}\s?%\s+(?:daily|weekly|monthly|per day|per week|a day|a week|every week)\b/gi,
    ],
  },
  {
    id: 'investment_pitch', group: 'money', weight: 0.25, kinds: ['investment'],
    title: 'Pitches a trading platform or mentor',
    why: 'Scammers build trust over weeks, then steer you to a fake trading site that shows fake profits.',
    patterns: [/\b(?:trading (?:platform|app|signals?)|investment (?:opportunity|platform|mentor|group|club|plan)|forex|crypto mining|my (?:uncle|aunt|mentor) (?:taught|showed))\b/gi],
  },
  {
    id: 'job', group: 'money', weight: 0.35, kinds: ['job'],
    title: 'Unexpected job offer',
    why: 'Real employers do not recruit by random text. Easy money for simple tasks is the lure of task scams.',
    patterns: [
      /\b(?:work from home|remote (?:job|work|position)|part[- ]time (?:job|work|position|opportunity)|flexible hours|no experience (?:needed|required|necessary)|we are (?:hiring|recruiting)|hiring now)\b/gi,
      /\b(?:like|rate|review|rating)\s+(?:videos|products|apps|hotels|movies)\b/gi,
    ],
  },
  {
    id: 'easy_money', group: 'money', weight: 0.35, kinds: ['job'],
    title: 'Promises easy money every day',
    why: 'Pay of hundreds of dollars a day for simple tasks is too good to be true.',
    patterns: [/\$\s?\d{2,4}(?:\s?(?:-|–|to)\s?\$?\s?\d{2,4})?\s*(?:per|a|\/)\s*(?:day|hour|hr)\b/gi, /\b(?:earn|make)\s+\$\s?\d[\d,]*\b[^.!?\n]{0,20}\b(?:daily|a day|per day|weekly|from home)\b/gi],
  },
  {
    id: 'overpayment', group: 'money', weight: 0.55, kinds: ['job', 'overpayment'],
    title: 'Sent too much and wants the difference back',
    why: 'In this scam the first payment bounces days later, and the money you send back is your own.',
    patterns: [
      /\b(?:overpaid|over-?payment|sent (?:you )?too much|refund the (?:difference|extra|balance)|send (?:back )?the (?:difference|rest|extra))\b/gi,
      /\baccidentally (?:sent|transferred|deposited)\b/gi,
      /\b(?:deposit|cash)\s+(?:this|the|a)\s+check\b[^.!?\n]{0,80}\b(?:send|return|wire|buy|transfer)\b/gi,
    ],
  },

  // Private info
  {
    id: 'ask_code', group: 'private', weight: 0.65, kinds: ['bank_alert', 'tech_support'], negatable: true,
    title: 'Asks for a verification code',
    why: 'That code is the key to your account. Anyone who asks you to read it back is trying to break in.',
    patterns: [
      new RegExp(String.raw`\b(?:send|give|tell|read|text|forward)\s+(?:me|us|it to (?:me|us)|back)\b[^.!?\n]{0,30}\b${AUTH_CODE}\b`, 'gi'),
      new RegExp(String.raw`\b(?:read|tell|give|provide|share|confirm|send|forward)\s+(?:me\s+|us\s+)?(?:the|that|this|your)\s+${AUTH_CODE}\b`, 'gi'),
      /\b(?:reply|respond)\s+with\s+(?:the|your|that)\s+(?:\d[- ]digit\s+)?(?:\w+\s+)?code\b/gi,
      /\bcode\s+(?:that\s+)?(?:we|i|they|google|apple|your bank)\s+(?:just\s+)?(?:sent|texted)\b[^.!?\n]{0,40}\b(?:read|send|give|tell|share)\b/gi,
      /\b(?:read|send|give|tell|share)\b[^.!?\n]{0,30}\bcode\s+(?:that\s+)?(?:we|i|they)\s+(?:just\s+)?(?:sent|texted)\b/gi,
      /\bcode\b[^.!?\n]{0,60}\b(?:read|send|give|tell)\s+it\s+(?:back\s+)?to\s+(?:me|us)\b/gi,
    ],
  },
  {
    id: 'ask_personal', group: 'private', weight: 0.5, kinds: ['bank_alert', 'government'], negatable: true,
    title: 'Asks for personal or banking details',
    why: 'Your bank and the government already have this information. They do not ask for it by text, email, or a call you did not expect.',
    patterns: [
      /\b(?:verify|confirm|provide|enter|update|send|give|need|submit|re-?enter|tell us|reply with|validate)\b[^.!?\n]{0,30}\b(?:social security(?: number)?|ssn|medicare (?:number|id)|bank account(?: number)?|routing number|(?:credit |debit )?card (?:number|details|info(?:rmation)?)|cvv|cvc|password|login (?:details|info(?:rmation)?|credentials)|mother'?s maiden name|date of birth|personal (?:details|information))\b/gi,
      /\b(?:verify|confirm|provide|enter|send|give|need|tell us|reply with)\b[^.!?\n]{0,20}\byour (?:atm |card |debit |bank )?pin\b/gi,
    ],
  },
  {
    id: 'remote_access', group: 'private', weight: 0.6, kinds: ['tech_support'],
    title: 'Wants control of your computer or phone',
    why: 'Apps like AnyDesk or TeamViewer let a stranger see and control your screen, including your bank account.',
    patterns: [
      /\b(?:anydesk|teamviewer|ultraviewer|logmein|quick ?assist|supremo|rustdesk|screenconnect|connectwise)\b/gi,
      /\b(?:remote(?:ly)?\s+(?:access|connect|control|session|desktop)|share your screen|give (?:us|me|the technician) access to your (?:computer|device|phone|screen)|let (?:us|me|our technician) (?:connect|log ?in|access|fix))\b/gi,
    ],
  },

  // Pretending
  {
    id: 'gov_agency', group: 'pretend', weight: 0.2, kinds: ['government'],
    title: 'Claims to be a government agency',
    why: 'Scammers pretend to be the IRS, Social Security, Medicare, or police because people fear them.',
    patterns: [
      /\b(?:IRS|SSA|FBI|DEA|DMV|USCIS)\b/g,
      /\b(?:internal revenue service|social security (?:administration|office|benefits|number has been)|medicare|federal bureau|police (?:department|officer)|sheriff(?:'s)?(?: office| department)?|u\.?s\.? marshals?|department of (?:the )?(?:treasury|justice|homeland security|motor vehicles|revenue)|customs and border|federal agent|government grant|jury duty)\b/gi,
    ],
  },
  {
    id: 'ssn_suspended', group: 'pretend', weight: 0.65, kinds: ['government'],
    title: 'Says your Social Security number is suspended',
    why: 'Social Security numbers cannot be suspended or frozen. Anyone who says so is running a scam.',
    patterns: [/\bsocial security(?: number| card)?\s+(?:has been|is|was|will be|got)\s+(?:suspended|blocked|frozen|cancell?ed|deactivated|compromised)\b/gi],
  },
  {
    id: 'utility_shutoff', group: 'pretend', weight: 0.4, kinds: ['utility'],
    title: 'Threatens to shut off your power or water',
    why: 'Utility companies send written notices well before a shutoff. They do not demand same-day payment by phone or text.',
    patterns: [/\b(?:power|electricity|electric service|gas service|water service|utilities|service)\b[^.!?\n]{0,30}\b(?:disconnect(?:ed|ion)?|shut ?off|cut off)\b/gi],
  },
  {
    id: 'account_alert', group: 'pretend', weight: 0.35, kinds: ['bank_alert'],
    title: 'Says something is wrong with your account',
    why: 'Fake alerts about strange activity or a locked account are the most common way scammers get people to log in to a fake site.',
    patterns: [
      /\b(?:unusual|suspicious|unauthori[sz]ed|fraudulent|strange|irregular)\s+(?:activity|sign[- ]?in|log[- ]?in|login attempt|access|transaction|charge|purchase|payment)s?\b/gi,
      /\byour\s+(?:\w+\s+)?account\s+(?:has been|is|was|will be)\s+(?:temporarily\s+|permanently\s+)?(?:locked|suspended|restricted|limited|frozen|on hold|disabled|compromised|deactivated|closed)\b/gi,
      /\b(?:verify|confirm|validate|update|re-?activate|unlock|restore)\s+(?:your\s+)?(?:account|identity|information|details|billing|payment (?:method|info(?:rmation)?))\b/gi,
    ],
  },
  {
    id: 'charge_bait', group: 'pretend', weight: 0.2, kinds: ['purchase_alert'],
    title: 'Mentions a charge you did not make',
    why: 'A fake receipt for something you never bought makes you call "support", where they ask for remote access or payment.',
    patterns: [
      /\b(?:did you (?:make|authori[sz]e|attempt|request)|if (?:you did not|you didn'?t|this (?:wasn'?t|was not) you)|not you\?|to cancel (?:this|the) (?:order|charge|transaction|subscription|renewal))\b/gi,
      /\b(?:auto[- ]?renew(?:al|ed)?|subscription (?:has been )?renewed)\b/gi,
    ],
  },
  {
    id: 'delivery', group: 'pretend', weight: 0.35, kinds: ['delivery'],
    title: 'Claims a problem with a delivery',
    why: 'Fake "package on hold" texts were the most reported text scam in 2024. Real carriers do not text you a link to fix your address.',
    patterns: [
      /\b(?:package|parcel|shipment|delivery|order)\b[^.!?\n]{0,40}\b(?:on hold|could not be delivered|couldn'?t be delivered|unable to (?:be )?deliver(?:ed)?|failed|returned to sender|held at|undeliverable|incomplete (?:address|information))\b/gi,
      /\b(?:incomplete|incorrect|invalid|missing|wrong)\s+(?:shipping\s+|delivery\s+|house\s+)?(?:address|address information)\b/gi,
      /\b(?:schedule|arrange|confirm|request)\s+(?:a\s+)?re-?delivery\b/gi,
    ],
  },
  {
    id: 'toll', group: 'pretend', weight: 0.4, kinds: ['toll'],
    title: 'Says you owe an unpaid toll',
    why: 'Fake toll bills went out to millions of phones in 2024 and 2025. Toll agencies do not text you a payment link out of the blue.',
    patterns: [
      /\b(?:unpaid|outstanding|overdue|past[- ]due|pending)\s+(?:toll|tolls|toll balance|toll charges?|road usage)\b/gi,
      /\btoll\s+(?:balance|charges?|violation|notice|bill|payment|road (?:fee|invoice))\b/gi,
    ],
  },
  {
    id: 'family_emergency', group: 'pretend', weight: 0.45, kinds: ['family'],
    title: 'A loved one in trouble',
    why: 'Scammers pose as a grandchild or relative in an emergency. They may even use AI to copy a voice.',
    patterns: [
      /\b(?:grandma|grandpa|granny|nana|grandmother|grandfather|mom|mum|dad)\b[^.!?\n]{0,15}\b(?:it'?s me|this is me|it is me)\b/gi,
      /\b(?:i'?m|i am|i'?ve been|i got|got)\s+(?:in jail|arrested|in (?:a|an) (?:car |bad )?accident|in (?:the )?hospital|in trouble|stuck|stranded|detained)\b/gi,
      /\b(?:bail money|bond money|bail|lawyer'?s? fees?|hospital bill)\b/gi,
    ],
  },
  {
    id: 'new_number', group: 'pretend', weight: 0.35, kinds: ['family'],
    title: 'Says they have a new phone number',
    why: '"Hi Mum, this is my new number" is a well-known opener. Call your relative on the number you already have.',
    patterns: [/\b(?:new (?:phone )?number|lost my phone|broke my phone|phone (?:is )?broken|my phone (?:died|broke)|old phone (?:is )?broken)\b/gi],
  },
  {
    id: 'romance', group: 'pretend', weight: 0.3, kinds: ['romance'],
    title: 'Sweet talk from someone far away',
    why: 'Romance scammers claim to work overseas or on an oil rig, avoid video calls, and eventually need money.',
    patterns: [
      /\b(?:deployed|stationed overseas|oil rig|offshore platform|peace ?keeping|un mission|military doctor|working abroad)\b/gi,
      /\bcan'?t (?:video ?call|facetime|video chat)\b/gi,
      /\b(?:plane|flight|airline) tickets?\b[^.!?\n]{0,40}\b(?:money|pay|send|help|afford)\b/gi,
      /\b(?:my love|my darling|my dearest|soul ?mate)\b/gi,
    ],
  },
  {
    id: 'wrong_number', group: 'pretend', weight: 0.25, kinds: ['investment', 'romance'],
    title: 'A friendly "wrong number" text',
    why: 'A polite stranger texting the wrong number is often the first step of a long investment or romance scam.',
    patterns: [/\b(?:sorry,? (?:wrong number|i think i have the wrong number)|is this (?:\w+)\?\s*(?:it'?s|this is)|wrong number[,.]? but)\b/gi, /\bsorry,? wrong number\b/gi],
  },
  {
    id: 'generic_greeting', group: 'pretend', weight: 0.15, kinds: [],
    title: 'Does not use your name',
    why: 'Companies you do business with know your name. "Dear customer" means they sent the same message to thousands.',
    patterns: [/\bdear\s+(?:customer|user|client|member|valued (?:customer|member|client|user)|account ?holder|sir\/madam|sir or madam|beneficiary)\b/gi],
  },

  // Links & tricks
  {
    id: 'callback', group: 'tricks', weight: 0.15, kinds: ['purchase_alert', 'tech_support'],
    title: 'Asks you to call a number in the message',
    why: 'The number in a scam message goes straight to the scammer. Call the number on your card or the official website instead.',
    patterns: [new RegExp(String.raw`\b(?:call|contact|dial|ring|phone|reach)\b[^.!?\n]{0,35}${PHONE}\b`, 'gi')],
  },
  {
    id: 'reply_trick', group: 'tricks', weight: 0.6, kinds: ['delivery', 'toll'],
    title: 'Asks you to reply so the link starts working',
    why: 'Phones disable links from unknown senders. "Reply Y and reopen" is a trick to switch that safety feature off.',
    patterns: [
      /\breply\s+["'“]?y(?:es)?["'”]?\b[^.!?\n]{0,60}\b(?:re-?open|exit|close|activate|click|link)\b/gi,
      /\b(?:re-?open|exit)\b[^.!?\n]{0,40}\b(?:message|text|sms)\b[^.!?\n]{0,30}\bactivate\b/gi,
      /\bcopy (?:and paste )?(?:the|this) link (?:into|in) (?:your|a|the) browser\b/gi,
    ],
  },
  {
    id: 'messaging_app', group: 'tricks', weight: 0.25, kinds: ['job', 'investment', 'romance'],
    title: 'Wants to move to WhatsApp or Telegram',
    why: 'Scammers move you to private chat apps where they are harder to track and report.',
    patterns: [/\b(?:contact|message|text|add|chat with|reach)\s+(?:us|me|our \w+)?\s*(?:on|via|through|at)\s+(?:whatsapp|telegram|signal|wechat|line)\b/gi, /\b(?:whatsapp|telegram)\s*(?:#|number|id|:)\s*\+?\d/gi],
  },
  {
    id: 'ai_injection', group: 'tricks', weight: 0.5, kinds: [],
    title: 'Contains text aimed at fooling scam checkers',
    why: 'Hidden instructions like "ignore previous instructions" try to trick AI filters. Honest messages never need them.',
    patterns: [
      /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above|earlier|your)\s+(?:instructions|prompts?|rules)\b/gi,
      /\b(?:this message is (?:safe|legitimate|not a scam|verified)|mark (?:this|it) as (?:safe|not spam)|classify (?:this|it) as (?:safe|legitimate))\b/gi,
    ],
  },
];

// Pairs of signs that, together, are the signature of a known scam.
// Each entry in `when` is a list of rule ids or link checks; one from each must be present.
export const COMBOS = [
  {
    id: 'combo_gov_payment', weight: 0.6, kinds: ['government'],
    when: [['gov_agency', 'ssn_suspended'], ['gift_cards', 'crypto_payment', 'wire', 'cash_courier', 'p2p']],
    title: 'An "agency" that wants unusual payment',
    why: 'The IRS, Social Security, and police never ask for gift cards, crypto, wire transfers, or cash pickups.',
  },
  {
    id: 'combo_authority_threat', weight: 0.35, kinds: [],
    when: [['gov_agency', 'account_alert', 'virus_scare', 'ssn_suspended', 'utility_shutoff'], ['threat_legal', 'threat_loss', 'deadline']],
    title: 'Authority plus a threat',
    why: 'Pairing an official-sounding name with a threat is the oldest pressure trick there is.',
  },
  {
    id: 'combo_utility_payment', weight: 0.55, kinds: ['utility'],
    when: [['utility_shutoff'], ['gift_cards', 'crypto_payment', 'wire', 'cash_courier', 'p2p']],
    title: 'A shutoff threat that wants instant payment',
    why: 'Utilities take payment through your normal bill. A demand for app, gift card, or crypto payment is a scam.',
  },
  {
    id: 'combo_brand_code', weight: 0.5, kinds: ['bank_alert'],
    when: [['brand:claimed', 'gov_agency', 'account_alert', 'charge_bait'], ['ask_code']],
    title: 'A company asking for your code',
    why: 'Codes are sent to prove it is really you. No real company, bank, or agency will ever ask you to read one back.',
  },
  {
    id: 'combo_notice_link', weight: 0.45, kinds: [],
    when: [['account_alert', 'delivery', 'toll', 'charge_bait', 'prize', 'refund_bait'], ['link:suspicious']],
    title: 'A scary notice with a link to "fix" it',
    why: 'This is the shape of almost every phishing text: a problem, then a link to a fake site that collects your details.',
  },
  {
    id: 'combo_rush_secrets', weight: 0.35, kinds: [],
    when: [['deadline', 'threat_legal', 'threat_loss'], ['ask_code', 'ask_personal']],
    title: 'Rushes you and asks for private details',
    why: 'Urgency plus a request for passwords, codes, or numbers is a classic account-takeover move.',
  },
  {
    id: 'combo_family_money', weight: 0.6, kinds: ['family'],
    when: [['family_emergency', 'new_number'], ['gift_cards', 'crypto_payment', 'wire', 'p2p', 'cash_courier', 'secrecy']],
    title: 'A family emergency that needs money, fast',
    why: 'Hang up and call your relative directly on the number you already have. Real emergencies survive a two-minute check.',
  },
  {
    id: 'combo_tech_access', weight: 0.55, kinds: ['tech_support'],
    when: [['remote_access'], ['virus_scare', 'account_alert', 'callback', 'charge_bait', 'gov_agency']],
    title: '"Support" that wants into your computer',
    why: 'Microsoft, Apple, and your bank will never ask to control your computer to fix a problem they contacted you about.',
  },
  {
    id: 'combo_romance_money', weight: 0.55, kinds: ['romance'],
    when: [['romance', 'wrong_number'], ['gift_cards', 'crypto_payment', 'wire', 'p2p', 'investment', 'investment_pitch']],
    title: 'An online friend who brings up money',
    why: 'Someone you have never met in person asking about money or investing is the turning point of romance scams.',
  },
  {
    id: 'combo_job_money', weight: 0.5, kinds: ['job'],
    when: [['job', 'easy_money'], ['upfront_fee', 'overpayment', 'crypto_payment', 'gift_cards', 'messaging_app']],
    title: 'A job where you pay or move money',
    why: 'Real jobs pay you. They never ask you to pay a fee, buy equipment, or forward money.',
  },
  {
    id: 'combo_fake_invoice', weight: 0.45, kinds: ['purchase_alert'],
    when: [['charge_bait'], ['callback']],
    title: 'A fake charge with a number to call',
    why: 'The "refund department" on the other end will ask for remote access or your bank login.',
  },
  {
    id: 'combo_prize_fee', weight: 0.5, kinds: ['prize'],
    when: [['prize', 'inheritance', 'refund_bait'], ['upfront_fee', 'ask_personal', 'gift_cards', 'wire', 'crypto_payment']],
    title: 'A prize you have to pay for',
    why: 'If you have to pay or share bank details to get a prize, there is no prize.',
  },
];
