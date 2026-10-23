// Goofy "Form 300" incident report shown after each CCTV replay. Any button files it.

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Who/what gets a tick in the "Root cause" box, by incident type.
const CAUSES = {
  fell: ['Dave', 'Gravity'],
  hit: ['Ralph'],
  thrown: ['Ralph', 'Gravity'],
  dropped: ['Ralph', 'Gravity'],
  legs: ['Ralph', 'Gravity'],
  wrapped: ['Dave', 'The wrapper'],
  crushed: ['Ralph', 'The racking'],
  forks: ['Ralph'],
  load: ['Gravity'],
  ladder: ['Dave', 'The ladder', 'Gravity'],
  ladderJump: ['Dave', 'The ladder', 'Gravity'],
  ladderKnocked: ['Ralph', 'The ladder', 'Gravity'],
  ladderHit: ['The ladder', 'Gravity'],
  rack: ['The racking', 'Gravity'],
  tipped: ['Ralph', 'Gravity'],
  rackDown: ['The racking', 'Gravity'],
};
const CAUSE_BOXES = ['Dave', 'Ralph', 'Gravity', 'The racking', 'The ladder', 'The wrapper'];

const ACTIONS = {
  Dave: [
    'Told Dave to be more careful.',
    'Put up another sign.',
    'Dave has been asked to stop doing that.',
    'Ordered a softer floor.',
    'Reminded Dave the floor is hard.',
  ],
  Ralph: [
    'Ralph has been asked to drive slower.',
    'Ralph promises it will not happen again.',
    'Bought Ralph a bigger mirror.',
    'Ralph is watching a safety video. Again.',
    'Removed the "fast" setting from the forklift (there was no fast setting).',
  ],
  Nobody: ['Added a strongly worded sign.', 'Nobody saw anything. Case closed.', 'Asked the racking to stay upright.'],
};

const DAYS_AWAY = [
  '0 (back on shift in 3 seconds)',
  '0 (walked it off)',
  '0 (Ralph said it was fine)',
  '0 (insurance is "looking into it")',
];

let el = null;
function root() {
  if (!el) {
    el = document.createElement('div');
    el.id = 'report';
    document.getElementById('app').appendChild(el);
  }
  return el;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class IncidentReport {
  constructor(game, incident) {
    this.game = game;
    this.shownAt = performance.now();
    const who = incident.victim || 'Dave';
    const role = who === 'Ralph' ? 'Forklift operator' : who === 'Dave' ? 'Order picker / climber' : 'N/A';
    const causes = new Set(incident.causes || CAUSES[incident.key] || ['Gravity']);
    if (incident.culprit === 'Ralph') causes.add('Ralph');
    // Corrective action goes to whoever is to blame: Ralph if he's a root cause, else the employee
    const blame = incident.culprit || (causes.has('Ralph') ? 'Ralph' : who);
    const action = pick(ACTIONS[blame] || ACTIONS.Nobody);
    const shift = game.time;
    const clock = `${String(Math.floor(shift / 60)).padStart(2, '0')}:${String(Math.floor(shift % 60)).padStart(2, '0')}`;
    const boxes = CAUSE_BOXES.map((c) => `<span class="rf-box">${causes.has(c) ? '☒' : '☐'} ${c}</span>`).join('');
    root().innerHTML = `
      <div class="rf-paper">
        <div class="rf-head">
          <div>
            <div class="rf-title">FORM 300 · INCIDENT REPORT</div>
            <div class="rf-sub">Log of work-related injuries, near misses and "what was that noise"</div>
          </div>
          <div class="rf-case">Case No.<b>${String(incident.number).padStart(3, '0')}</b></div>
        </div>
        <div class="rf-grid">
          <div class="rf-f"><span>Employee</span><b>${esc(who)}</b></div>
          <div class="rf-f"><span>Job title</span><b>${esc(role)}</b></div>
          <div class="rf-f"><span>Shift time</span><b>${clock}</b></div>
          <div class="rf-f"><span>Location</span><b>${esc(incident.where || 'Warehouse floor')}</b></div>
        </div>
        <div class="rf-f rf-wide"><span>Describe what happened</span><b class="rf-what">${esc(incident.line)}</b></div>
        <div class="rf-f rf-wide"><span>Root cause (tick all that apply)</span><div class="rf-boxes">${boxes}</div></div>
        <div class="rf-grid">
          <div class="rf-f"><span>Corrective action</span><b>${esc(action)}</b></div>
          <div class="rf-f"><span>Days away from work</span><b>${esc(pick(DAYS_AWAY))}</b></div>
        </div>
        <div class="rf-f rf-wide"><span>Witnesses</span><b>${esc((incident.cams || []).join(', ') || 'None. Convenient.')}</b></div>
        <div class="rf-sign">
          <div><div class="rf-sig">Ralph</div><span>Supervisor signature</span></div>
          <div class="rf-stamp">FILED</div>
        </div>
        <div class="rf-foot">Press any button to file it and get back to work</div>
      </div>`;
    root().classList.add('on');
  }

  // Returns false once dismissed. A short grace period stops the press that skipped the replay
  // from also filing the form unread.
  update(skip) {
    if (skip && performance.now() - this.shownAt > 700) {
      this.close();
      return false;
    }
    return true;
  }

  close() {
    root().classList.remove('on');
  }
}
