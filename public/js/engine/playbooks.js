// What each kind of scam looks like, and what to do about it.
// `tell` is the single fact that gives this scam away.

export const PLAYBOOKS = {
  government: {
    name: 'Government impostor scam',
    tell: 'The IRS, Social Security, Medicare, and the police do not threaten arrest by phone or text, and they never take gift cards, crypto, or wire transfers.',
    steps: [
      'Do not pay, and do not call the number in the message.',
      'If you are worried, look up the agency yourself (irs.gov, ssa.gov, medicare.gov) and call the number listed there.',
    ],
  },
  tech_support: {
    name: 'Fake tech support',
    tell: 'Microsoft, Apple, and security companies do not contact you about viruses, and never ask for control of your computer.',
    steps: [
      'Do not call the number or install anything they suggest.',
      'If a warning is stuck on your screen, close the browser or restart the computer.',
      'If someone already connected to your computer, turn it off and have a trusted person or shop check it. Then change your banking passwords from another device.',
    ],
  },
  family: {
    name: 'Family emergency scam',
    tell: 'The story is designed to make you panic and act alone. A real relative will understand if you hang up to check.',
    steps: [
      'Hang up or stop replying, then call your relative on the number you already have for them.',
      'Ask a question only the real person would know, or agree on a family code word for emergencies.',
      'Never send money, gift cards, or cash by courier because of a call or text like this.',
    ],
  },
  romance: {
    name: 'Romance scam',
    tell: 'Someone you have never met in person who cannot video call, and then needs money, is not who they say they are.',
    steps: [
      'Do not send money, gift cards, or crypto to someone you have only met online.',
      'Talk it over with a friend or family member you trust. Scammers count on you keeping the relationship to yourself.',
      'Try a reverse image search of their photos, which are often stolen.',
    ],
  },
  investment: {
    name: 'Investment or crypto scam',
    tell: 'Guaranteed profits and a friendly stranger who wants to "mentor" you are the signature of investment fraud, the costliest scam for older adults.',
    steps: [
      'Do not move money to any app or website they recommend.',
      'Check the person and firm at brokercheck.finra.org before investing anything.',
      'If you already invested and are asked to pay "taxes" or "fees" to withdraw, stop. That is part of the scam.',
    ],
  },
  job: {
    name: 'Job or task scam',
    tell: 'Real employers do not hire by random text, and they never ask you to pay to start working.',
    steps: [
      'Do not reply or move to WhatsApp or Telegram.',
      'Never pay a fee, buy equipment, or deposit a check and send money back for a job.',
    ],
  },
  prize: {
    name: 'Prize or lottery scam',
    tell: 'You cannot win something you never entered, and real prizes never cost money to collect.',
    steps: [
      'Do not pay any fee or share bank or card details to "claim" anything.',
      'Delete the message.',
    ],
  },
  delivery: {
    name: 'Fake delivery notice',
    tell: 'USPS, UPS, and FedEx do not text you links to fix an address or pay a redelivery fee.',
    steps: [
      'Do not tap the link.',
      'If you are expecting a package, check the tracking number on the store or carrier website you normally use.',
    ],
  },
  toll: {
    name: 'Fake toll bill',
    tell: 'Toll agencies do not text payment links out of the blue. These texts went to millions of phones, including people who do not drive on toll roads.',
    steps: [
      'Do not tap the link or reply.',
      'If you think you might owe a toll, log in to your toll account through the website or app you normally use.',
    ],
  },
  utility: {
    name: 'Utility shutoff scam',
    tell: 'Power, gas, and water companies send written notices long before a shutoff, and never demand payment by gift card, app, or crypto.',
    steps: [
      'Do not pay, and do not call the number in the message.',
      'Call the customer service number printed on your own utility bill to check your account.',
    ],
  },
  bank_alert: {
    name: 'Fake account alert',
    tell: 'Banks and online services do not text you a link to unlock your account or ask you to read back a code.',
    steps: [
      'Do not tap the link or reply with any code.',
      'Call the number on the back of your card, or open your bank app yourself, to check whether anything is wrong.',
    ],
  },
  purchase_alert: {
    name: 'Fake purchase or invoice',
    tell: 'The charge is invented. The "refund team" on the phone will ask to access your computer or bank account.',
    steps: [
      'Do not call the number in the message.',
      'Check your account by logging in yourself or calling the number on your card.',
    ],
  },
  overpayment: {
    name: 'Overpayment scam',
    tell: 'The first payment will bounce days later. The money you send back is your own.',
    steps: [
      'Do not send any money back. Tell the sender to cancel their payment through their bank instead.',
      'Ask your bank whether the incoming payment has truly cleared, which can take more than a week.',
    ],
  },
  phishing: {
    name: 'Phishing link',
    tell: 'The link does not go where it claims to. Fake sites copy real logos to steal passwords and card numbers.',
    steps: [
      'Do not tap the link or enter any information.',
      'Go to the company website by typing the address yourself, or use their official app.',
    ],
  },
  generic: {
    name: 'Suspicious message',
    tell: 'It has several signs that scammers use. Treat it with care until you can check it another way.',
    steps: ['Check it another way: contact the company or person using a number or website you already trust.'],
  },
};

export const LEVELS = {
  low: {
    label: 'No common scam signs',
    summary: 'We did not find the usual warning signs. That does not prove it is safe, so be careful if it asks for money or private information.',
  },
  caution: {
    label: 'Be careful',
    summary: 'This has some signs that scammers use. Check it another way before you click, call, or pay.',
  },
  likely: {
    label: 'Likely a scam',
    summary: 'This has several strong scam signs. Do not click, call, reply, or pay.',
  },
  very_likely: {
    label: 'Very likely a scam',
    summary: 'This matches a known scam pattern. Do not click, call, reply, or pay.',
  },
};

export const ALREADY_ACTED = [
  'Call your bank or card company right away, using the number on your card. Speed matters.',
  'If you typed a password into a link, change it now on the real website or app.',
  'Report it at ReportFraud.ftc.gov, or at IdentityTheft.gov if you shared personal information.',
];

export const REPORT_OPTIONS = [
  { title: 'Forward scam texts to 7726', detail: 'Free on all major U.S. carriers. It spells SPAM and helps block the sender.' },
  { title: 'ReportFraud.ftc.gov', detail: 'The Federal Trade Commission collects reports to track and stop scams.', href: 'https://reportfraud.ftc.gov/' },
  { title: 'ic3.gov', detail: 'The FBI’s Internet Crime Complaint Center, especially if you lost money.', href: 'https://www.ic3.gov/' },
  { title: 'National Elder Fraud Hotline: 1-833-372-8311', detail: '1-833-FRAUD-11, run by the U.S. Department of Justice for people 60 and older and their families. A case manager helps you report.', phone: '18333728311' },
];
