// Travel modes and the built-in, offline post-crash guide.
export const MODES = {
  car:        { label: 'Car',        doing: 'driving',            crash: 'been in a car crash' },
  bike:       { label: 'Bike',       doing: 'biking',             crash: 'been hit or crashed while biking' },
  scooter:    { label: 'Scooter',    doing: 'riding a scooter',   crash: 'been hit or crashed while riding a scooter' },
  wheelchair: { label: 'Wheelchair', doing: 'using a wheelchair', crash: 'been hit or tipped over in their wheelchair' },
  walk:       { label: 'Walking',    doing: 'walking',            crash: 'been hit by a vehicle while walking' },
};
export const isVulnerable = (mode) => mode !== 'car';

const yn = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }];
const hurtOpts = [{ label: 'Yes', value: 'yes' }, { label: 'Not sure', value: 'unsure' }, { label: 'No', value: 'no' }];

const CAR_TRIAGE = [
  { id: 'hazard', text: 'Do you see smoke or fire, or smell fuel?', options: yn },
  { id: 'injured', text: 'Is anyone hurt?', options: hurtOpts },
  { id: 'traffic', text: 'Is the car stopped in a traffic lane?', options: yn },
];

const VRU_TRIAGE = [
  { id: 'injured', text: 'Are you hurt?', options: hurtOpts },
  { id: 'head', text: 'Did you hit your head?', options: [...yn, { label: 'Not sure', value: 'unsure' }] },
  { id: 'road', text: 'Are you still in the road?', options: yn },
  { id: 'driver', text: 'Is the driver still there?', options: [{ label: 'Yes', value: 'yes' }, { label: 'No, they left', value: 'no' }, { label: 'No car involved', value: 'none' }] },
];

export const triageFor = (mode) => (isVulnerable(mode) ? VRU_TRIAGE : CAR_TRIAGE);

export function offlineSteps(t = {}, mode = 'car') {
  return isVulnerable(mode) ? vruSteps(t, mode) : carSteps(t);
}

function carSteps(t) {
  const steps = [];
  const fire = t.hazard === 'yes';
  const hurt = t.injured === 'yes' || t.injured === 'unsure';
  if (fire) {
    steps.push(
      { title: 'Get out and get away', detail: 'Leave the vehicle now and move at least 100 feet away, upwind if you can. Leave belongings behind.', urgent: true },
      { title: 'Call 911', detail: 'Say there is smoke or fire and give your location.', urgent: true },
    );
  }
  if (hurt) {
    if (!fire) steps.push({ title: 'Call 911 now', detail: 'Say how many people are hurt and where you are. Stay on the line.', urgent: true });
    steps.push(
      { title: 'Keep anyone with neck or back pain still', detail: 'Do not move them unless there is fire or another immediate danger.', urgent: true },
      { title: 'Stop heavy bleeding', detail: 'Press firmly on the wound with a clean cloth and keep the pressure on.' },
    );
  }
  if (t.traffic === 'yes' && !fire) {
    steps.push(
      { title: 'Turn on your hazard lights', detail: 'Make the car visible to other drivers.' },
      { title: 'Get clear of traffic only if it is safe', detail: 'If the car drives and no one is hurt, move to the shoulder. Otherwise stay buckled in, or exit away from traffic if that is safer.' },
    );
  }
  if (t.injured === 'no') steps.push({ title: 'Check on everyone', detail: 'Ask passengers and the other driver if they are OK. Pain can show up later.' });
  if (!fire && !hurt) steps.push({ title: 'Call the police', detail: 'Call 911 if a lane is blocked or anyone may be hurt. A police report helps with insurance.' });
  steps.push(
    { title: 'Exchange information', detail: 'Get the other driver’s name, phone, insurance company, policy number, and license plate.' },
    { title: 'Document the scene', detail: 'Photograph both cars, the plates, the road, and their insurance card.' },
    { title: 'Stick to the facts', detail: 'Don’t admit fault or argue. Ask for the police report number.' },
    { title: 'Call your insurer', detail: 'Report the crash as soon as you can. The incident report below has what they’ll ask for.' },
  );
  return steps;
}

function vruSteps(t, mode) {
  const steps = [];
  const hurt = t.injured === 'yes' || t.injured === 'unsure';
  const head = t.head === 'yes' || t.head === 'unsure';
  const gear = { bike: 'bike', scooter: 'scooter', wheelchair: 'wheelchair', walk: 'shoes or belongings' }[mode];

  if (t.road === 'yes') {
    steps.push({ title: 'Get out of the road if you can move', detail: 'Get to the sidewalk or shoulder. If moving hurts your neck or back, stay still and wave for help.', urgent: true });
  }
  if (t.driver === 'no') {
    steps.push({ title: 'Report a hit-and-run', detail: 'Call 911 now. Say the car’s color, make, any plate letters, and which way it went.', urgent: true });
  } else if (hurt || head) {
    steps.push({ title: 'Call 911 now', detail: 'Say you were hit while ' + MODES[mode].doing + ' and where you are. Stay on the line.', urgent: true });
  }
  if (head) {
    steps.push({ title: 'Treat a head hit as serious', detail: 'Get checked today, even with a helmet. Headache, confusion, or vomiting mean go now.', urgent: true });
  }
  if (hurt) steps.push({ title: 'Stop heavy bleeding', detail: 'Press firmly on the wound with a clean cloth and keep the pressure on.' });
  if (t.driver === 'yes') {
    steps.push({ title: 'Get the driver’s information', detail: 'Photograph their plate, license, and insurance card before they leave, even if you feel fine.' });
  }
  if (!hurt && !head && t.driver !== 'no') {
    steps.push({ title: 'Call the police anyway', detail: 'Adrenaline hides injuries. A police report protects you if pain shows up later.' });
  }
  steps.push(
    { title: `Keep your ${gear} and helmet as evidence`, detail: 'Don’t repair or throw anything away yet. Photograph all the damage.' },
    { title: 'Photograph the scene', detail: 'Get the car, the road, the spot where you landed, and any witnesses’ contact info.' },
    { title: 'Get checked within 24 hours', detail: 'See a doctor or urgent care even if you feel OK, and keep the records.' },
  );
  return steps;
}
