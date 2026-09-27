// Pump/Feed dashboard controller — the goal-bottle fill, pump tracker,
// activity history accordion, trends chart, today's feeds tracker, the
// thaw-from-stash tile, the split urgent strips, and the session-edit
// modal shared by both tabs' history rows.
import { db } from './db.js';
import { reminders } from './reminders.js';
import { TrendsManager } from './trends.js';
import { inventory, InventoryManager, shouldShowThawTile } from './inventory.js';
import { escapeHtml, displayQty } from './viewHelpers.js';
import { applySessionEdits } from './app.js';

const ICON_SVG_BOTTLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9.5" y="2.5" width="5" height="2.6" rx="1"/><path d="M10.5 5.1h3v2.3l2 2.8V21a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V10.2l2-2.8z"/></svg>';
const ICON_SVG_DROPLET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3.5 4.4 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2.5-6.6 6-11z"/></svg>';
const ICON_SVG_SNOWFLAKE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="21.5"/><line x1="3.9" y1="7.5" x2="20.1" y2="16.5"/><line x1="20.1" y1="7.5" x2="3.9" y2="16.5"/></svg>';
const ICON_SVG_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';

export class DashboardView {
  constructor(app) {
    this.app = app;
    this.pumpsAccordionOpen = true;
    this.showOlderHistory = false;
    this.activityFilter = 'all'; // 'all' | 'pumps' | 'feeds'
    this._editingSessionId = null;
    this._editFeedType = null;
  }

  async renderAll() {
    await this.updateBottleFillLevel();
    await this.renderPumpTracker();
    await this.renderFeedsTracker();
    await this.renderThawSection();
    await this.renderPumpsAccordion();
    await this.renderTrendsChart();
    await this.renderTodayUrgent();
  }

  // --- TRACK PUMPING (quick duration logging under the pump goal) ---
  async renderPumpTracker() {
    const numEl = document.getElementById('pumpTrackerNum');
    const subEl = document.getElementById('pumpTrackerSub');
    if (!numEl) return;
    const sessions = await db.getSessions();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const count = sessions.filter(s => s.type === 'pump' && s.startTime >= startOfToday).length;
    numEl.textContent = String(count);
    if (subEl) subEl.textContent = count === 1 ? '1 session today' : `${count} sessions today`;
  }

  // 1. Animated Bottle Fill Calculation & SVG Rendering
  async updateBottleFillLevel() {
    const app = this.app;
    const aggregates = await TrendsManager.getDailyAggregates(7);
    const todayData = aggregates.days[aggregates.days.length - 1];
    const unit = app.settings.units;
    const isMl = unit === 'mL';

    let todayPumpedOz = todayData ? todayData.pumpVolume : 0;
    if (isMl) {
      // If unit is mL, pumpVolume in aggregate was already converted to current unit
      todayPumpedOz = todayData ? todayData.pumpVolume / 29.5735 : 0;
    }

    const goalOz = app.settings.dailyGoalOz || 24.0;
    const percent = Math.min(100, Math.round((todayPumpedOz / goalOz) * 100));

    // Display units
    const displayToday = isMl ? Math.round(todayPumpedOz * 29.5735) : (Math.round(todayPumpedOz * 10) / 10);
    const displayGoal = isMl ? Math.round(goalOz * 29.5735) : (Math.round(goalOz * 10) / 10);

    // Update Fraction Text
    const goalCurrentEl = document.getElementById('goalCurrentValue');
    const goalTargetEl = document.getElementById('goalTargetValue');
    if (goalCurrentEl && goalTargetEl) {
      goalCurrentEl.textContent = displayToday;
      goalTargetEl.textContent = displayGoal;
    }

    // Update Percentage Pill
    const badgeEl = document.getElementById('goalBadgePill');
    const tileEl = document.getElementById('goalBottleTile');
    const isComplete = percent >= 100;

    if (badgeEl) {
      badgeEl.textContent = isComplete ? 'Goal Achieved!' : `${percent}% Goal`;
      badgeEl.className = `goal-badge-pill ${isComplete ? 'celebration' : ''}`;
    }
    if (tileEl) {
      tileEl.classList.toggle('goal-reached', isComplete);
    }

    const subtextEl = document.getElementById('goalSubtext');
    if (subtextEl) {
      const remaining = Math.max(0, displayGoal - displayToday);
      const parentName = (app.settings.parentName || '').trim() || 'You';
      subtextEl.textContent = isComplete
        ? `${parentName} crushed today's goal!`
        : `${remaining} ${unit} remaining to hit daily goal`;
    }

    // Animate Bottle SVG Height
    // Bottle cavity inside SVG is Y: 36 to Y: 154 (height: 118px)
    const maxHeight = 114;
    const fillHeight = Math.max(0, Math.min(maxHeight, Math.round((percent / 100) * maxHeight)));
    const liquidY = 154 - fillHeight;

    const liquidRect = document.getElementById('bottleMilkLiquid');
    const wavePath = document.getElementById('liquidWaveSurface');

    if (liquidRect) {
      liquidRect.setAttribute('y', liquidY);
      liquidRect.setAttribute('height', fillHeight);
    }
    if (wavePath) {
      wavePath.setAttribute('transform', `translate(0, ${liquidY - 4})`);
      wavePath.style.display = fillHeight > 4 ? 'block' : 'none';
    }
  }

  // 2. Expandable Activity History Accordion (Pumps & Feeds)
  async renderPumpsAccordion() {
    const app = this.app;
    const headerTitle = document.getElementById('accordionTodayHeader');
    const contentWrap = document.getElementById('activitySessionsContainer') || document.getElementById('accordionPumpsList');
    const accordionTile = document.getElementById('accordionPumpsList');
    const chevronIcon = document.getElementById('accordionChevron');

    const sessions = await db.getSessions();
    const unit = app.settings.units;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    // Calculate today's totals for header
    const todayPumps = sessions.filter(s => s.type === 'pump' && s.startTime >= startOfToday);
    const todayFeeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const todayPumpVolume = todayPumps.reduce((acc, s) => acc + (s.outputQty || 0), 0);
    const todayFeedVolume = todayFeeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);

    if (headerTitle) {
      if (todayPumps.length > 0 || todayFeeds.length > 0) {
        headerTitle.innerHTML = `Today: <strong>${todayPumps.length} pumps</strong> (${Math.round(todayPumpVolume * 10) / 10} ${unit}) • <strong>${todayFeeds.length} feeds</strong> (${Math.round(todayFeedVolume * 10) / 10} ${unit})`;
      } else {
        headerTitle.innerHTML = `Today's Activity: <strong>0 sessions</strong>`;
      }
    }

    if (chevronIcon) {
      chevronIcon.classList.toggle('open', this.pumpsAccordionOpen);
    }

    if (accordionTile) {
      accordionTile.classList.toggle('open', this.pumpsAccordionOpen);
    }

    if (contentWrap) {
      // Filter according to this.activityFilter
      let filteredSessions = sessions;
      if (this.activityFilter === 'pumps') {
        filteredSessions = sessions.filter(s => s.type === 'pump');
      } else if (this.activityFilter === 'feeds') {
        filteredSessions = sessions.filter(s => s.type === 'feed');
      }

      const groups = TrendsManager.groupSessionsByDay(filteredSessions);
      const todayGroup = groups.find(g => g.title === 'Today');

      if (!filteredSessions || filteredSessions.length === 0) {
        contentWrap.innerHTML = `
          <div class="empty-state-msg">
            No ${this.activityFilter === 'all' ? 'activity' : this.activityFilter} recorded yet today.
          </div>
        `;
        return;
      }

      // Display groups: always show Today; show older if this.showOlderHistory is true
      const displayedGroups = this.showOlderHistory ? groups : (todayGroup ? [todayGroup] : []);

      let html = '';
      if (displayedGroups.length === 0) {
        html += `
          <div class="empty-state-msg">
            No ${this.activityFilter === 'all' ? 'activity' : this.activityFilter} recorded today.
          </div>
        `;
      } else {
        html += displayedGroups.map(group => {
          const groupPumps = group.sessions.filter(s => s.type === 'pump');
          const groupFeeds = group.sessions.filter(s => s.type === 'feed');
          const pVol = groupPumps.reduce((a, s) => a + (s.outputQty || 0), 0);
          const fVol = groupFeeds.reduce((a, s) => a + (s.outputQty || 0), 0);

          let summaryTag = '';
          if (pVol > 0 && fVol > 0) {
            summaryTag = `${Math.round(pVol * 10) / 10} pumped • ${Math.round(fVol * 10) / 10} fed`;
          } else if (pVol > 0) {
            summaryTag = `${Math.round(pVol * 10) / 10} ${unit} pumped`;
          } else if (fVol > 0) {
            summaryTag = `${Math.round(fVol * 10) / 10} ${unit} fed`;
          }

          return `
            <div class="session-group-header">
              <span>${group.title}</span>
              <span>${summaryTag}</span>
            </div>
            ${group.sessions.map(s => {
              const timeStr = new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

              if (s.type === 'feed') {
                const isFormula = s.feedType === 'formula';
                return `
                  <div class="session-item-tile">
                    <div class="session-item-left">
                      <div class="session-item-icon ${isFormula ? 'formula-feed-icon' : 'breastmilk-feed-icon'}">
                        ${isFormula ? ICON_SVG_BOTTLE : ICON_SVG_DROPLET}
                      </div>
                      <div class="session-details">
                        <div class="session-primary-title">
                          <span>${s.outputQty} ${s.unit || unit}</span>
                          <span class="session-badge-tag ${isFormula ? 'formula' : 'breastmilk'}">${isFormula ? 'Formula' : 'Breast Milk'}</span>
                        </div>
                        <div class="session-sub-title">${timeStr} • ${s.notes || (isFormula ? 'Formula Feeding' : 'Breast Milk Feeding')}</div>
                      </div>
                    </div>
                    <div class="session-item-right has-actions">
                      <button class="session-action-btn" data-action="edit-session" data-id="${s.id}">Edit</button>
                      <button class="session-action-btn" data-action="delete-session" data-id="${s.id}">Delete</button>
                    </div>
                  </div>
                `;
              } else {
                const durationMin = Math.max(1, Math.round((s.durationSec || 0) / 60));
                return `
                  <div class="session-item-tile">
                    <div class="session-item-left">
                      <div class="session-item-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                        </svg>
                      </div>
                      <div class="session-details">
                        <div class="session-primary-title">
                          <span>${s.outputQty} ${s.unit || unit}</span>
                          <span class="session-badge-tag breastmilk">Pump</span>
                        </div>
                        <div class="session-sub-title">${timeStr} • ${durationMin} min duration</div>
                        ${s.notes ? `<div class="note-italic-muted">"${s.notes}"</div>` : ''}
                      </div>
                    </div>
                    <div class="session-item-right has-actions">
                      <button class="session-action-btn" data-action="edit-session" data-id="${s.id}">Edit</button>
                      <button class="session-action-btn" data-action="delete-session" data-id="${s.id}">Delete</button>
                    </div>
                  </div>
                `;
              }
            }).join('')}
          `;
        }).join('');
      }

      // Button to toggle older history
      const hasOlder = groups.some(g => g.title !== 'Today');
      if (hasOlder) {
        html += `
          <button class="btn-secondary btn-history-toggle" data-action="toggle-older-history">
            ${this.showOlderHistory ? 'Hide Previous Days' : 'Show Previous Days (' + (groups.length - 1) + ' days)'}
          </button>
        `;
      }

      contentWrap.innerHTML = html;
    }
  }

  toggleAccordion() {
    this.pumpsAccordionOpen = !this.pumpsAccordionOpen;
    this.renderPumpsAccordion();
  }

  toggleOlderHistory() {
    this.showOlderHistory = !this.showOlderHistory;
    this.renderPumpsAccordion();
  }

  async deleteSession(id) {
    if (confirm('Delete this activity entry?')) {
      await db.delete('sessions', id);
      await this.app.renderTodayDashboard();
      await reminders.updateStatus();
      await this.app.updateQuickFoodTally();
    }
  }

  // --- EDIT ACTIVITY SESSION (tracker entries) ---
  _setEditFeedTypePills(feedType) {
    this._editFeedType = feedType;
    document.getElementById('editFeedTypeFormula').classList.toggle('active', feedType === 'formula');
    document.getElementById('editFeedTypeBreastmilk').classList.toggle('active', feedType === 'breastmilk');
  }

  async openEditSession(id) {
    const app = this.app;
    const sessions = await db.getSessions();
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    this._editingSessionId = id;
    const isFeed = s.type === 'feed';

    document.getElementById('editSessionTitle').textContent = isFeed ? 'Edit Feed Entry' : 'Edit Pump Entry';
    document.getElementById('editFeedTypeGroup').style.display = isFeed ? '' : 'none';
    document.getElementById('editDurationGroup').style.display = isFeed ? 'none' : '';
    if (isFeed) this._setEditFeedTypePills(s.feedType === 'formula' ? 'formula' : 'breastmilk');

    document.getElementById('editSessionUnitLabel').textContent = s.unit || app.settings.units;
    document.getElementById('editSessionQty').value = s.outputQty ?? '';
    document.getElementById('editSessionDuration').value = Math.max(1, Math.round((s.durationSec || 0) / 60));
    const d = new Date(s.startTime);
    document.getElementById('editSessionTime').value =
      new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('editSessionNotes').value = s.notes || '';
    document.getElementById('editSessionModal').classList.add('open');
  }

  closeEditSession() {
    document.getElementById('editSessionModal').classList.remove('open');
    this._editingSessionId = null;
  }

  async saveEditSession() {
    const sessions = await db.getSessions();
    const original = sessions.find(x => x.id === this._editingSessionId);
    if (!original) { this.closeEditSession(); return; }

    const qty = parseFloat(document.getElementById('editSessionQty').value);
    if (!qty || qty <= 0) { alert('Please enter a valid quantity.'); return; }

    const timeVal = document.getElementById('editSessionTime').value;
    const startTime = timeVal ? new Date(timeVal).getTime() : original.startTime;
    if (!timeVal || isNaN(startTime)) { alert('Please enter a valid date and time.'); return; }

    const edits = {
      outputQty: qty,
      startTime,
      notes: document.getElementById('editSessionNotes').value.trim(),
    };
    if (original.type === 'feed') {
      edits.feedType = this._editFeedType || original.feedType;
    } else {
      edits.durationMin = parseFloat(document.getElementById('editSessionDuration').value) || 0;
    }

    await db.put('sessions', applySessionEdits(original, edits));
    this.closeEditSession();
    await this.app.renderTodayDashboard();
    await reminders.updateStatus();
    await this.app.updateQuickFoodTally();
  }

  initEditSessionModal() {
    const editSessionModal = document.getElementById('editSessionModal');
    if (editSessionModal) {
      document.getElementById('closeEditSessionBtn').addEventListener('click', () => this.closeEditSession());
      document.getElementById('saveEditSessionBtn').addEventListener('click', () => this.saveEditSession());
      document.getElementById('editFeedTypeFormula').addEventListener('click', () => this._setEditFeedTypePills('formula'));
      document.getElementById('editFeedTypeBreastmilk').addEventListener('click', () => this._setEditFeedTypePills('breastmilk'));
      editSessionModal.addEventListener('click', (e) => {
        if (e.target === editSessionModal) this.closeEditSession();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editSessionModal.classList.contains('open')) this.closeEditSession();
      });
    }
  }

  // 3. Render 7-day Supply Trends Chart
  async renderTrendsChart() {
    const app = this.app;
    const chartWrap = document.getElementById('chartSvgWrap');
    if (!chartWrap) return;
    const aggregates = await TrendsManager.getDailyAggregates(7);
    chartWrap.innerHTML = TrendsManager.renderSvgChart(aggregates.days, app.settings.units, 340, 150);

    const totalVolumeWeek = aggregates.days.reduce((acc, d) => acc + d.pumpVolume, 0);
    const avgDailyWeek = Math.round((totalVolumeWeek / 7) * 10) / 10;
    const unit = app.settings.units;

    const avgEl = document.getElementById('metricWeekAvg');
    if (avgEl) avgEl.textContent = `${avgDailyWeek} ${unit}/d`;
  }

  // --- TODAY'S FEEDS TRACKER (under the pump goal; rows quick-edit) ---
  async renderFeedsTracker() {
    const app = this.app;
    const wrap = document.getElementById('feedsTrackerRows');
    const countEl = document.getElementById('feedsTrackerCount');
    if (!wrap) return;

    const sessions = await db.getSessions();
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const feeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const unit = app.settings.units;
    const totalVol = feeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);

    if (countEl) {
      countEl.textContent = feeds.length
        ? `• ${feeds.length} feed${feeds.length === 1 ? '' : 's'} • ${Math.round(totalVol * 10) / 10} ${unit}`
        : '';
    }

    if (feeds.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-msg">
          No feeds logged yet today — tap Log feed to start.
        </div>`;
      return;
    }

    wrap.innerHTML = feeds.map(s => {
      const isFormula = s.feedType === 'formula';
      const timeStr = new Date(s.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `
        <div class="session-item-tile feeds-tracker-row" role="button" tabindex="0"
             title="Tap to quick-edit" data-action="edit-session" data-id="${s.id}">
          <div class="session-item-left">
            <div class="session-item-icon ${isFormula ? 'formula-feed-icon' : 'breastmilk-feed-icon'}">
              ${isFormula ? ICON_SVG_BOTTLE : ICON_SVG_DROPLET}
            </div>
            <div class="session-details">
              <div class="session-primary-title">
                <span>${s.outputQty} ${s.unit || unit}</span>
                <span class="session-badge-tag ${isFormula ? 'formula' : 'breastmilk'}">${isFormula ? 'Formula' : 'Breast Milk'}</span>
              </div>
              <div class="session-sub-title">${timeStr}${s.notes ? ` • ${escapeHtml(s.notes)}` : ''}</div>
            </div>
          </div>
          <div class="session-item-right is-hint">Edit ›</div>
        </div>`;
    }).join('');
  }

  // --- THAW-FROM-STASH SECTION (main page) ---
  // Hidden entirely when there is no frozen stash to thaw — the tile only
  // earns its place once it is actually used.
  async renderThawSection() {
    const app = this.app;
    const tile = document.getElementById('thawTile');
    const frozenWrap = document.getElementById('thawFrozenRows');
    const readyWrap = document.getElementById('thawReadyRows');
    const moreEl = document.getElementById('thawMoreLine');
    if (!frozenWrap || !readyWrap) return;

    const unit = app.settings.units;
    const frozen = await inventory.getFrozenItems();
    const thawed = await inventory.getThawedItems();
    if (tile) tile.hidden = !shouldShowThawTile(frozen.length);
    const MAX_FROZEN = 6;
    const shown = frozen.slice(0, MAX_FROZEN);

    frozenWrap.innerHTML = shown.length === 0
      ? `<div class="thaw-empty">Nothing frozen in the stash.</div>`
      : shown.map(item => {
          const disp = displayQty(item, unit);
          const locName = item.location === 'deepFreezer' ? 'Deep chest' : 'Freezer';
          const pumped = new Date(item.pumpedAt).toLocaleDateString([], { month: 'short', day: 'numeric' });
          return `
            <div class="session-item-tile thaw-row">
              <div class="session-item-left">
                <div class="session-item-icon thaw-icon">${ICON_SVG_SNOWFLAKE}</div>
                <div class="session-details">
                  <div class="session-primary-title"><span>${disp.qty} ${disp.qtyUnit}</span>
                    <span class="session-badge-tag">${locName}</span></div>
                  <div class="session-sub-title">Pumped ${pumped}${item.notes ? ` • ${escapeHtml(item.notes)}` : ''}</div>
                </div>
              </div>
              <button class="inv-action-btn thaw-btn thaw-action-btn"
                      data-action="thaw-item" data-id="${item.id}">Thaw</button>
            </div>`;
        }).join('');

    if (moreEl) {
      if (frozen.length > MAX_FROZEN) {
        moreEl.hidden = false;
        moreEl.innerHTML = `<button class="btn-ghost btn-more-stash" data-action="switch-tab" data-tab="inventory">+ ${frozen.length - MAX_FROZEN} more in Stash →</button>`;
      } else {
        moreEl.hidden = true;
      }
    }

    readyWrap.innerHTML = thawed.length === 0
      ? `<div class="thaw-empty">No thawed milk yet — thaw a pouch above and it will wait here, ready for the next feed.</div>`
      : thawed.map(item => {
          const disp = displayQty(item, unit);
          const urgency = InventoryManager.getUrgency(item.expiresAt);
          const sub = urgency.level === 'expired'
            ? 'Expired — discard'
            : `Use within ${escapeHtml(urgency.label)}`;
          return `
            <div class="session-item-tile thaw-row">
              <div class="session-item-left">
                <div class="session-item-icon breastmilk-feed-icon">${ICON_SVG_DROPLET}</div>
                <div class="session-details">
                  <div class="session-primary-title"><span>${disp.qty} ${disp.qtyUnit}</span>
                    <span class="session-badge-tag breastmilk">Thawed</span></div>
                  <div class="session-sub-title">${sub}</div>
                </div>
              </div>
              <button class="inv-action-btn thaw-action-btn"
                      data-action="open-feed-flow">Feed</button>
            </div>`;
        }).join('');
  }

  // --- URGENT STRIPS (split by relevance: pump-overdue on the Pump tab;
  // thawed-milk-expiring / low-stash on the Feed tab, since those are what
  // you'd act on from that screen) ---
  async renderTodayUrgent() {
    const app = this.app;
    const pumpCard = document.getElementById('pumpUrgentCard');
    const pumpRows = document.getElementById('pumpUrgentRows');
    const feedCard = document.getElementById('feedUrgentCard');
    const feedRows = document.getElementById('feedUrgentRows');
    if (!pumpCard || !pumpRows || !feedCard || !feedRows) return;

    const pumpItems = [];
    const feedItems = [];

    try {
      const sched = await reminders.calculateSchedule();
      if (sched.hasSession && (sched.status === 'overdue' || sched.status === 'due-soon')) {
        pumpItems.push({
          tone: sched.status === 'overdue' ? 'tone-overdue' : 'tone-warn',
          icon: ICON_SVG_CLOCK,
          text: sched.label
        });
      }
    } catch (e) {
      console.warn('Urgent strip: schedule check failed:', e);
    }

    try {
      const thawed = await inventory.getThawedItems();
      const urgent = thawed
        .map(i => ({ item: i, u: InventoryManager.getUrgency(i.expiresAt) }))
        .find(({ u }) => u.level === 'expired' || u.level === 'red' || u.level === 'yellow');
      if (urgent) {
        const disp = displayQty(urgent.item, app.settings.units);
        feedItems.push({
          tone: (urgent.u.level === 'expired' || urgent.u.level === 'red') ? 'tone-overdue' : 'tone-warn',
          icon: ICON_SVG_SNOWFLAKE,
          text: `Thawed milk: ${disp.qty} ${disp.qtyUnit} — ${urgent.u.label}`
        });
      }
    } catch (e) {
      console.warn('Urgent strip: thawed check failed:', e);
    }

    try {
      const summary = await inventory.getStashSummary();
      if (summary.totalOz < 12) {
        const disp = app.settings.units === 'mL' ? Math.round(summary.totalOz * 29.5735) : summary.totalOz;
        feedItems.push({
          tone: 'tone-warn',
          icon: ICON_SVG_SNOWFLAKE,
          text: `Low stash: ${disp} ${app.settings.units} left`
        });
      }
    } catch (e) {
      console.warn('Urgent strip: stash check failed:', e);
    }

    const paint = (card, rows, items) => {
      if (items.length === 0) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      rows.innerHTML = items.map(i => `
        <div class="today-urgent-row ${i.tone}">
          <span class="today-urgent-icon" aria-hidden="true">${i.icon}</span>
          <span class="today-urgent-text">${i.text}</span>
        </div>`).join('');
    };
    paint(pumpCard, pumpRows, pumpItems);
    paint(feedCard, feedRows, feedItems);
  }

  initActivityFilter() {
    const filterChips = document.querySelectorAll('.activity-filter-chip');
    filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activityFilter = chip.dataset.filter || 'all';
        this.renderPumpsAccordion();
      });
    });
  }
}
