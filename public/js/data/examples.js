// Example messages, modeled on scams reported to the FTC and FBI.
// Phone numbers use the reserved 555-01xx range; web addresses are made up.

export const EXAMPLES = [
  {
    id: 'toll',
    label: 'Unpaid toll text',
    answer: 'scam',
    text: `NOTICE: You have an outstanding toll balance of $6.99. To avoid a late fee of $50.00, pay within 12 hours: https://ezpass-tollservices.info/pay

(Reply Y, then exit and reopen this message to activate the link.)`,
    explain: 'A tiny bill, a big late fee, and a deadline. The link goes to a site that is not a toll agency, and “Reply Y” switches off your phone’s link protection.',
  },
  {
    id: 'grandparent',
    label: '“Grandma, it’s me”',
    answer: 'scam',
    text: `Grandma it's me, Josh. I got in a car accident and I'm in jail. Please don't tell mom, she'll freak out. The lawyer says I need $3,000 for bail today. Can you buy Google Play gift cards and read me the numbers on the back?`,
    explain: 'An emergency, a request for secrecy, and gift cards. Call your grandchild on the number you already have.',
  },
  {
    id: 'irs',
    label: 'IRS arrest threat',
    answer: 'scam',
    text: `IRS NOTICE: Our records show you owe $2,840 in back taxes. A warrant will be issued for your arrest unless payment is made today. Payment must be made in Bitcoin at a crypto ATM or with Target gift cards. Do not discuss this with your bank. Call Agent Miller now at (202) 555-0198.`,
    explain: 'The IRS sends letters by mail, never threatens arrest, and never takes Bitcoin or gift cards.',
  },
  {
    id: 'bank',
    label: 'Locked bank account',
    answer: 'scam',
    text: `Wells Fargo Alert: Unusual sign-in detected on your account. Your account has been temporarily locked. Verify your identity within 24 hours or your account will be permanently suspended: http://wellsfargo.secure-verify-login.com`,
    explain: 'The address starts with “wellsfargo” but the real site is secure-verify-login.com. Read web addresses from the right.',
  },
  {
    id: 'techsupport',
    label: 'Virus pop-up',
    answer: 'scam',
    text: `MICROSOFT SECURITY ALERT
Your computer has been infected with a virus and your banking information is at risk. Do not shut down your computer. Call Microsoft Support immediately at 1-888-555-0147. A certified technician will connect to your PC using AnyDesk to remove the threat.`,
    explain: 'Microsoft does not put phone numbers in pop-ups. AnyDesk would give a stranger control of your computer.',
  },
  {
    id: 'newnumber',
    label: '“Hi Mum, new number”',
    answer: 'scam',
    text: `Hi Mum, it's me. I dropped my phone in the sink so this is my new number, can you save it? Also I need a favour, I have a bill due today and my banking app won't work on the new phone. Can you send $1,450 by Zelle? I'll pay you back tomorrow x`,
    explain: 'A new number plus an urgent money request. Call your child on their old number before sending anything.',
  },
  {
    id: 'twofactor',
    label: 'Real login code',
    answer: 'legit',
    text: `G-482910 is your Google verification code. Don't share your code with anyone.`,
    explain: 'This is what a real code looks like: no link, no request, and a reminder not to share it. If someone calls asking you for this code, that call is the scam.',
  },
  {
    id: 'usps',
    label: 'Package on hold',
    answer: 'scam',
    text: `USPS: Your package is on hold due to an incomplete address. Please update your delivery details within 12 hours to avoid a return to sender: https://usps.com-trackhelp.top/update`,
    explain: 'It says USPS, but the real site is com-trackhelp.top. USPS uses usps.com and does not text links to fix addresses.',
  },
  {
    id: 'chase_real',
    label: 'Real card alert',
    answer: 'legit',
    text: `Chase: A $45.20 charge at TRADER JOE'S was made on your card ending 1234. If this wasn't you, call the number on the back of your card. Reply STOP to end texts.`,
    explain: 'It has no link, asks for nothing, and tells you to use the number on your own card. That is how real fraud alerts work.',
  },
  {
    id: 'job',
    label: 'Easy job offer',
    answer: 'scam',
    text: `Hello! I'm Jessica, a recruiter at a digital marketing firm. We're hiring part-time remote workers: just like videos and rate apps, earn $300-$800 per day, no experience needed. Message me on WhatsApp to start today!`,
    explain: 'Hundreds of dollars a day for liking videos is a “task scam”. Later they ask you to deposit money to unlock your earnings.',
  },
  {
    id: 'invoice',
    label: 'Surprise invoice',
    answer: 'scam',
    text: `PayPal Invoice: Your subscription to Norton 360 has been auto-renewed for $499.99. If you did not authorize this charge, call our refund department at +1 (888) 555-0171 within 24 hours.
Sent from: paypal.billing.dept@gmail.com`,
    explain: 'A big charge you never made, a number to call, and a Gmail address pretending to be PayPal.',
  },
  {
    id: 'family_real',
    label: 'Text from family',
    answer: 'legit',
    text: `Hi Mom! Landed safe in Denver. Thanks again for the cookies, the kids already ate half. Will call you tonight after dinner ❤️`,
    explain: 'No money, no link, no rush, and no secrets. Just a normal message.',
  },
  {
    id: 'prize',
    label: 'Gift card prize',
    answer: 'scam',
    text: `Congratulations! You've been selected to receive a $1,000 Walmart gift card. Claim your prize now at bit.ly/3Wq7xPz, just pay $4.95 shipping.`,
    explain: 'You cannot win a contest you never entered. The small shipping fee is how they get your card number.',
  },
  {
    id: 'romance',
    label: 'Sweetheart overseas',
    answer: 'scam',
    text: `My darling, I miss you so much. My contract on the oil rig ends next month and then we can finally be together. I tried to buy my plane ticket but my bank account is frozen here. Could you send $2,400 through Western Union? I can't video call, the connection on the rig is too weak.`,
    explain: 'Oil rigs, no video calls, and a sudden need for money are textbook romance scam signs.',
  },
  {
    id: 'wrongnumber',
    label: '“Wrong number” friend',
    answer: 'scam',
    text: `Hi Linda, are we still on for golf Saturday? Oh sorry, wrong number! But it's nice to meet you anyway. I'm a crypto trader, my uncle taught me a strategy with guaranteed returns of 20% weekly. Happy to show you the trading platform I use.`,
    explain: 'The “wrong number” is on purpose. Weeks of friendly chat lead to a fake investment site.',
  },
];

export const CHECK_CHIPS = ['toll', 'grandparent', 'irs', 'bank', 'techsupport', 'newnumber', 'twofactor'];
export const PRACTICE_DECK = ['usps', 'chase_real', 'job', 'twofactor', 'invoice', 'family_real', 'prize', 'romance'];
export const DEFAULT_EXAMPLE = 'toll';

export function exampleById(id) {
  return EXAMPLES.find((e) => e.id === id) || null;
}
