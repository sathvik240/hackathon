// Emergencies Bystander can guide, and what the bystander can report in each.
// CPR is coached from the camera. The others are step-by-step voice guides
// with no camera measurement.
//
// Sources: American Heart Association CPR and first aid guidelines, American
// Red Cross first aid steps, the Stop the Bleed program, and the SAMHSA
// opioid overdose prevention toolkit and naloxone nasal spray instructions.

export const REPORTS = {
  not_breathing: { label: 'Not breathing / gasping', line: 'the person is not breathing normally' },
  breathing: { label: 'Breathing now', line: 'the person is breathing now' },
  moving: { label: 'Waking up', line: 'the person is moving or waking up' },
  aed_here: { label: 'AED is here', line: 'an AED has arrived' },
  aed_shock: { label: 'AED shocked', line: 'the AED delivered a shock' },
  swapped: { label: 'Someone took over', line: 'another rescuer took over compressions' },
  naloxone: { label: 'Gave naloxone', line: 'naloxone was given' },
  naloxone_2: { label: 'Gave 2nd dose', line: 'a second dose of naloxone was given' },
  tourniquet: { label: 'Tourniquet on', line: 'a tourniquet was applied' },
  bleeding_controlled: { label: 'Bleeding slowed', line: 'the bleeding has slowed' },
  object_out: { label: 'Object came out', line: 'the object came out and the person can breathe' },
  unresponsive: { label: 'Became unresponsive', line: 'the person became unresponsive' },
  cpr_started: { label: 'Started CPR', line: 'the bystander started CPR' },
  note: { label: 'Said', line: '' },
};

export const SCENARIOS = {
  cardiac_arrest: {
    id: 'cardiac_arrest',
    title: 'CPR',
    situation: 'An adult has collapsed. They are unresponsive and not breathing normally. A bystander is doing hands-only CPR, coached by the app.',
    reports: ['not_breathing', 'breathing', 'moving', 'aed_here', 'aed_shock', 'swapped'],
  },
  choking: {
    id: 'choking',
    title: 'Choking',
    situation: 'A person is choking and cannot breathe, cough, or speak. A bystander is giving back blows and abdominal thrusts.',
    reports: ['object_out', 'unresponsive', 'breathing'],
    note: 'For adults and children over 1 year old.',
    steps: [
      { title: 'Ask: “Are you choking?”', text: 'If they can cough hard or speak, let them keep coughing and stay with them.' },
      { title: '5 back blows', text: 'If they can’t breathe, cough, or speak: stand behind them, lean them forward, and give 5 firm blows between the shoulder blades with the heel of your hand.', count: 5 },
      { title: '5 abdominal thrusts', text: 'Make a fist just above their belly button, grab it with your other hand, and give 5 quick thrusts inward and upward. If they are pregnant or you can’t reach around them, push on the center of the chest instead.', count: 5 },
      { title: 'Repeat 5 and 5', text: 'Keep alternating 5 back blows and 5 thrusts until the object comes out or they become unresponsive.' },
      { title: 'If they become unresponsive', text: 'Lower them to the ground and start CPR. Look in the mouth first, and only remove an object you can see.', cpr: true },
    ],
  },
  bleeding: {
    id: 'bleeding',
    title: 'Severe bleeding',
    situation: 'A person has severe, life-threatening bleeding. A bystander is applying pressure.',
    reports: ['tourniquet', 'bleeding_controlled', 'unresponsive'],
    steps: [
      { title: 'Stay safe', text: 'Make sure the scene is safe. Put on gloves if you have them.' },
      { title: 'Find the wound', text: 'Open or cut away clothing so you can see where the blood is coming from.' },
      { title: 'Press hard', text: 'Put a cloth or gauze on the wound and press down hard with both hands. Don’t let up to check it.' },
      { title: 'Arm or leg: tourniquet', text: 'If pressure doesn’t stop bleeding from an arm or leg, put a tourniquet 2 to 3 inches above the wound, not on a joint. Tighten until the bleeding stops. Note the time.', report: 'tourniquet' },
      { title: 'Neck, shoulder, or groin: pack it', text: 'Stuff gauze or clean cloth deep into the wound, then keep pressing hard on top of it.' },
      { title: 'Keep pressure on', text: 'Keep pressing until help takes over. Keep them warm and lying down.' },
    ],
  },
  overdose: {
    id: 'overdose',
    title: 'Opioid overdose',
    situation: 'A person may have overdosed on opioids and is not responding. A bystander is being guided to give naloxone.',
    reports: ['naloxone', 'naloxone_2', 'breathing', 'not_breathing', 'moving'],
    steps: [
      { title: 'Try to wake them', text: 'Shout their name and rub your knuckles hard on the middle of their chest.' },
      { title: 'Check breathing', text: 'Signs of overdose: slow or no breathing, blue or gray lips, tiny pupils, and they won’t wake up.' },
      { title: 'Give naloxone', text: 'Lay them on their back. Put the nozzle in one nostril and press the plunger firmly.', report: 'naloxone' },
      { title: 'Not breathing? Start CPR', text: 'If they are not breathing normally, start CPR now.', cpr: true },
      { title: 'Breathing? Recovery position', text: 'If they are breathing, roll them onto their side, top knee bent, so they don’t choke.' },
      { title: 'Second dose if needed', text: 'If they don’t wake up in 2 to 3 minutes, give another dose in the other nostril.', timerS: 150, report: 'naloxone_2' },
      { title: 'Stay with them', text: 'Naloxone can wear off before the opioid does. Stay until help arrives.' },
    ],
  },
};

export const scenarioOf = (id) => SCENARIOS[id] || SCENARIOS.cardiac_arrest;
