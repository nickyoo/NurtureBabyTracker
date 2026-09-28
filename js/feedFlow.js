// Feed flow controller — the guided bottom-sheet feed logger, the
// press-and-hold express gesture, and the live bottle timer (per-type CDC
// safety countdown). These three share one continuous user journey (pick
// type/amount -> start timer -> live countdown -> review -> log), so they
// live in one controller rather than being split further.
import { db, newId } from './db.js';
import { sound } from './audio.js';
import { reminders } from './reminders.js';
import { inventory, InventoryManager, THAWED_LOCATION } from './inventory.js';
import { escapeHtml } from './viewHelpers.js';
import {
  buildFeedFlowPrefill,
  resolveFeedTimerStart,
  paceOzPerMin,
  fmtClock,
  fmtSafetyWindow,
  clampAmount,
  resolveLockedType,
  shouldFlipType,
  feedPresets,
  getBottleTimerStatus,
} from './app.js';

export class FeedFlowController {
  constructor(app) {
    this.app = app;
    this.feedFlow = { step: 'type', type: null, amountOz: 4.0 };
    this._express = null;
    this._thawedSources = [];
    this._feedToastTimer = null;
    this.bottle = {
      active: false,
      startTs: null,
      feedType: 'formula',
      preparedOz: 4.0,
      eatenOz: 4.0,
      elapsedSec: 0,
      tickId: null,
      sourceInventoryId: null
    };
  }

  // Amounts are stored canonically in oz; display converts to the user's unit.
  _ffIsMl() {
    return this.app.settings.units === 'mL';
  }

  _ffToDisplay(oz) {
    return this._ffIsMl() ? Math.round(oz * 29.5735) : Math.round(oz * 10) / 10;
  }

  _ffToOz(displayVal) {
    return this._ffIsMl() ? displayVal / 29.5735 : displayVal;
  }

  _ffMaxDisplay() {
    return this._ffIsMl() ? 300 : 10;
  }

  _ffStepDisplay() {
    return this._ffIsMl() ? 5 : 0.1;
  }

  _ffAmtStr(oz) {
    const disp = this._ffToDisplay(oz);
    return this._ffIsMl() ? `${disp} mL` : `${disp.toFixed(1)} oz`;
  }

  initFeedFlow() {
    this.feedFlow = { step: 'type', type: null, amountOz: 4.0 };
    this._express = null;

    // Elevated center Quick Feed button: quick tap -> guided flow,
    // press-and-hold (~320ms) -> express gesture.
    const fab = document.getElementById('quickFeedFab');
    if (fab) {
      let holdTimer = null;
      let holdFired = false;
      let downPos = null;
      fab.addEventListener('contextmenu', e => e.preventDefault());
      fab.addEventListener('pointerdown', e => {
        holdFired = false;
        downPos = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(() => {
          holdFired = true;
          this._openExpressFeed();
        }, 320);
      });
      const cancelHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };
      fab.addEventListener('pointermove', e => {
        if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 12) cancelHold();
      });
      fab.addEventListener('pointerup', () => {
        const wasHold = holdFired;
        cancelHold();
        downPos = null;
        if (!wasHold) this.openFeedFlow();
      });
      fab.addEventListener('pointercancel', () => { cancelHold(); downPos = null; });
    }

    // Log feed button on the Pump tab: plain tap opens the guided flow.
    const logBtn = document.getElementById('logFeedBtn');
    if (logBtn) logBtn.addEventListener('click', () => this.openFeedFlow());

    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeFeedFlow();
      });
    }
    const closeBtn = document.getElementById('ffCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeFeedFlow());
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open')) this.closeFeedFlow();
    });

    const fFormula = document.getElementById('ffTypeFormula');
    if (fFormula) fFormula.addEventListener('click', () => this._ffPickType('formula'));
    const fMilk = document.getElementById('ffTypeBreastmilk');
    if (fMilk) fMilk.addEventListener('click', () => this._ffPickType('breastmilk'));

    const slider = document.getElementById('ffAmountSlider');
    if (slider) slider.addEventListener('input', () => this._ffSetAmount(this._ffToOz(parseFloat(slider.value))));
    const hero = document.getElementById('ffAmountHero');
    if (hero) {
      hero.addEventListener('click', () => {
        this._amountInlineEdit('ffAmountInput', 'ffAmountValue',
          () => this._ffToDisplay(this.feedFlow.amountOz),
          v => this._ffSetAmount(this._ffToOz(v)));
      });
    }
    const backToType = document.getElementById('ffBackToType');
    if (backToType) backToType.addEventListener('click', () => this._ffShowStep('type'));
    const amountNext = document.getElementById('ffAmountNext');
    if (amountNext) amountNext.addEventListener('click', () => this._ffShowReview());

    const startTimerBtn = document.getElementById('ffStartTimerBtn');
    if (startTimerBtn) startTimerBtn.addEventListener('click', () => this._ffStartTimer());

    const backToAmount = document.getElementById('ffBackToAmount');
    if (backToAmount) backToAmount.addEventListener('click', () => this._ffShowStep('amount'));
    const confirmLog = document.getElementById('ffConfirmLog');
    if (confirmLog) confirmLog.addEventListener('click', () => this._ffConfirmLog());

    const doneBtn = document.getElementById('ffDoneBtn');
    if (doneBtn) doneBtn.addEventListener('click', () => this.closeFeedFlow());
  }

  openFeedFlow() {
    this.feedFlow = { step: 'type', type: null, amountOz: 4.0, sourceInventoryId: null };
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.remove('is-selected');
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.remove('is-selected');
    this._ffSyncUnits();
    this._ffShowStep('type');
    this._ffRenderThawedSources();
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.add('open');
  }

  closeFeedFlow() {
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.remove('open');
    const pad = document.getElementById('ffExpressPad');
    if (pad) pad.hidden = true;
    this._express = null;
  }

  _ffShowStep(step) {
    this.feedFlow.step = step;
    const map = {
      type: 'ffStepType',
      amount: 'ffStepAmount',
      review: 'ffStepReview',
      success: 'ffStepSuccess'
    };
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (el) el.classList.toggle('active', key === step);
    });
    const pad = document.getElementById('ffExpressPad');
    if (pad) pad.hidden = step !== 'express';
  }

  _ffPickType(type) {
    this.feedFlow.type = type;
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.toggle('is-selected', type === 'formula');
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.toggle('is-selected', type === 'breastmilk');
    sound.playChime('tick');
    sound.vibrate([30]);
    // One tap locks the type in, then glide to the amount step
    setTimeout(() => {
      if (this.feedFlow.step === 'type') this._ffShowStep('amount');
    }, 220);
  }

  _ffSyncUnits() {
    const unit = this.app.settings.units;
    const unitEl = document.getElementById('ffAmountUnit');
    if (unitEl) unitEl.textContent = unit;
    this._ffBuildPresets('ffPresetRow', v => this._ffSetAmount(this._ffToOz(v)));
    this._ffRenderAmount();
  }

  _ffBuildPresets(rowId, onPick) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const unit = this.app.settings.units;
    row.innerHTML = '';
    feedPresets(unit).forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ff-preset-chip';
      b.dataset.val = String(p);
      b.textContent = `${p} ${unit}`;
      b.addEventListener('click', () => onPick(p));
      row.appendChild(b);
    });
  }

  _ffSetAmount(oz) {
    this.feedFlow.amountOz = clampAmount(oz, 0, 10, 0.1);
    this._ffRenderAmount();
    sound.vibrate([15]);
  }

  _ffRenderAmount() {
    const disp = this._ffToDisplay(this.feedFlow.amountOz);
    const valEl = document.getElementById('ffAmountValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const slider = document.getElementById('ffAmountSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffMaxDisplay());
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const tol = this._ffIsMl() ? 1 : 0.05;
    document.querySelectorAll('#ffPresetRow .ff-preset-chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.val) - disp) < tol);
    });
  }

  // Tap-the-number inline editor shared by feed flow + bottle timer.
  _amountInlineEdit(inputId, valueId, getDisplay, commit) {
    const input = document.getElementById(inputId);
    const valEl = document.getElementById(valueId);
    if (!input || !valEl) return;
    input.hidden = false;
    valEl.style.display = 'none';
    input.value = String(getDisplay());
    input.focus();
    input.select();
    let settled = false;
    const done = save => {
      if (settled) return;
      settled = true;
      if (save) commit(parseFloat(input.value));
      input.hidden = true;
      valEl.style.display = '';
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') done(true);
      else if (e.key === 'Escape') done(false);
    };
    input.onblur = () => done(true);
  }

  _ffShowReview() {
    const type = this.feedFlow.type || 'formula';
    const typeEl = document.getElementById('ffReviewType');
    if (typeEl) typeEl.textContent = type === 'formula' ? 'Formula' : 'Breast milk';
    const amtEl = document.getElementById('ffReviewAmount');
    if (amtEl) amtEl.textContent = this._ffAmtStr(this.feedFlow.amountOz);
    const timeEl = document.getElementById('ffReviewTime');
    if (timeEl) {
      timeEl.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    this._ffShowStep('review');
  }

  async _ffConfirmLog() {
    const type = this.feedFlow.type || 'formula';
    const qty = this._ffToDisplay(this.feedFlow.amountOz);
    await this.trackFood(type, qty);
    await this._consumeThawedSource(this.feedFlow.sourceInventoryId, this.feedFlow.amountOz);
    const line = document.getElementById('ffSuccessLine');
    if (line) {
      line.textContent = `${this._ffAmtStr(this.feedFlow.amountOz)} ${type === 'formula' ? 'Formula' : 'Breast milk'} logged ✓`;
    }
    await this.updateQuickFoodTally();
    this._ffShowStep('success');
  }

  // --- Express mode: press-and-hold the center button, slide without lifting.
  // Up/down picks formula vs breast milk (sticky lock), left/right sets ounces.
  _openExpressFeed() {
    this.feedFlow = { step: 'express', type: null, amountOz: 0, sourceInventoryId: null };
    this._express = { lockedType: null, moved: false };
    this._ffShowStep('express');
    const overlay = document.getElementById('feedFlowOverlay');
    if (overlay) overlay.classList.add('open');
    const pad = document.getElementById('ffExpressPad');
    if (!pad) return;
    sound.vibrate([40]);
    this._ffRenderExpressHud();

    const onMove = e => {
      const ex = this._express;
      if (!ex) return;
      const rect = pad.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      // Ignore jitter right around the touch point before a real move
      if (!ex.moved && Math.abs(nx - 0.5) < 0.06 && Math.abs(ny - 0.5) < 0.06) return;
      ex.moved = true;
      if (!ex.lockedType) {
        ex.lockedType = resolveLockedType(ny);
      } else if (shouldFlipType(ex.lockedType, ny)) {
        ex.lockedType = ex.lockedType === 'formula' ? 'breastmilk' : 'formula';
        sound.vibrate([25]);
      }
      this.feedFlow.type = ex.lockedType;
      this.feedFlow.amountOz = clampAmount(nx * 10, 0, 10, 0.1);
      this._ffRenderExpressHud();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const ex = this._express;
      this._express = null;
      if (!ex) return;
      // Lift at 0 oz (or no type) cancels — nothing logged
      if (this.feedFlow.amountOz <= 0 || !this.feedFlow.type) {
        this.closeFeedFlow();
        return;
      }
      this._ffShowReview();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  _ffRenderExpressHud() {
    const type = this.feedFlow.type;
    const typeEl = document.getElementById('ffLiveType');
    if (typeEl) typeEl.textContent = type === 'breastmilk' ? 'Breast milk' : 'Formula';
    const roEl = document.getElementById('ffLiveReadout');
    if (roEl) roEl.textContent = this._ffAmtStr(this.feedFlow.amountOz);
  }

  // --- THAWED STASH AS A BOTTLE-READY SOURCE IN THE MERGED FEED FLOW ---
  async _ffRenderThawedSources() {
    const block = document.getElementById('ffThawedBlock');
    const list = document.getElementById('ffThawedSources');
    if (!block || !list) return;
    this._thawedSources = await inventory.getThawedItems();
    if (this._thawedSources.length === 0) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    list.innerHTML = this._thawedSources.map(item => {
      const prefill = buildFeedFlowPrefill(item);
      if (!prefill) return '';
      const urgency = InventoryManager.getUrgency(item.expiresAt);
      const tone = urgency.level === 'expired' ? 'badge-expired' : urgency.badgeClass;
      return `
        <button type="button" class="ff-thawed-chip" data-action="pick-thawed-source" data-id="${item.id}">
          <span class="ff-thawed-qty">${this._ffAmtStr(prefill.amountOz)} breast milk</span>
          <span class="inv-countdown-pill ${tone}">${escapeHtml(urgency.label)}</span>
        </button>`;
    }).join('');
  }

  pickThawedSource(id) {
    const item = (this._thawedSources || []).find(i => i.id === id);
    const prefill = buildFeedFlowPrefill(item);
    if (!prefill) return;
    this.feedFlow.type = prefill.type;
    this.feedFlow.amountOz = prefill.amountOz;
    this.feedFlow.sourceInventoryId = prefill.sourceInventoryId;
    const mBtn = document.getElementById('ffTypeBreastmilk');
    if (mBtn) mBtn.classList.add('is-selected');
    const fBtn = document.getElementById('ffTypeFormula');
    if (fBtn) fBtn.classList.remove('is-selected');
    this._ffSyncUnits();
    this._ffShowStep('amount');
    sound.playChime('tick');
  }

  // From the merged feed flow's amount step: close the sheet and hand the
  // prefilled type/amount/source to the live bottle timer. The timer still
  // enforces the per-type CDC safety window (1h formula / 2h breast milk).
  _ffStartTimer() {
    const start = resolveFeedTimerStart(this.feedFlow || {});
    this.closeFeedFlow();
    this.openBottleSetup(start);
  }

  // Consume a thawed source pouch after its feed is logged. Full use marks
  // the pouch used; partial use leaves the remainder thawed for next time.
  async _consumeThawedSource(sourceId, usedOz) {
    if (!sourceId) return;
    const item = await db.get('inventory', sourceId);
    if (!item || item.status !== 'active' || item.location !== THAWED_LOCATION) return;
    const itemOz = item.unit === 'mL' ? item.quantity / 29.5735 : item.quantity;
    const used = Math.max(0, usedOz || 0);
    if (used >= itemOz - 0.05) {
      await inventory.markUsed(sourceId);
    } else {
      const remainingOz = Math.round((itemOz - used) * 10) / 10;
      item.quantity = item.unit === 'mL' ? Math.round(remainingOz * 29.5735) : remainingOz;
      await db.put('inventory', item);
      inventory.notify();
    }
    await this.app.renderTodayDashboard();
    await this.app.renderInventory();
  }

  // --- Session logging primitive shared by feed flow + bottle timer ---
  async trackFood(feedType, volume, durationSec = 0, notes = null) {
    const now = Date.now();
    const unit = this.app.settings.units;
    const session = {
      id: newId('sess'),
      type: 'feed',
      feedType,
      startTime: now,
      endTime: now,
      durationSec,
      outputQty: volume,
      unit,
      notes: notes !== null && notes !== undefined
        ? notes
        : (feedType === 'formula' ? 'Formula Feeding' : 'Breast Milk Feeding'),
      createdAt: now
    };
    await db.addSession(session);
    sound.playChime('complete');
    sound.vibrate([100, 50, 100]);
    await this.app.renderTodayDashboard();
    await reminders.updateStatus();
    await this.updateQuickFoodTally();
    this.showFeedToast(feedType, volume);
    return session;
  }

  showFeedToast(feedType, volume) {
    const toast = document.getElementById('feedToast');
    if (!toast) return;

    const iconEl = document.getElementById('feedToastIcon');
    const titleEl = document.getElementById('feedToastTitle');
    const descEl = document.getElementById('feedToastDesc');

    const isFormula = feedType === 'formula';
    if (iconEl) iconEl.textContent = '✓';
    if (titleEl) titleEl.textContent = 'Feed Logged! ✓';
    if (descEl) {
      descEl.textContent = `${volume} ${this.app.settings.units} ${isFormula ? 'Formula' : 'Breast Milk'} recorded`;
    }

    toast.classList.add('show');
    clearTimeout(this._feedToastTimer);
    this._feedToastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2600);
  }

  // Today's feed tally, shown on the feed-flow success step.
  async updateQuickFoodTally() {
    const sessions = await db.getSessions();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const todayFeeds = sessions.filter(s => s.type === 'feed' && s.startTime >= startOfToday);
    const totalVol = todayFeeds.reduce((acc, s) => acc + (s.outputQty || 0), 0);
    const unit = this.app.settings.units;
    const text = `${todayFeeds.length} feed${todayFeeds.length === 1 ? '' : 's'} • ${Math.round(totalVol * 10) / 10} ${unit} today`;
    const tallyEl = document.getElementById('ffSuccessTally');
    if (tallyEl) tallyEl.textContent = text;
    return text;
  }

  // --- BOTTLE TIMER SUBSYSTEM (live feed + per-type CDC safety countdown) ---
  // Survives backgrounding: the start timestamp persists in localStorage and
  // the display is recomputed from the wall clock on every tick / reload.
  initBottleTimer() {
    this.bottle = {
      active: false,
      startTs: null,
      feedType: 'formula',
      preparedOz: 4.0,
      eatenOz: 4.0,
      elapsedSec: 0,
      tickId: null,
      sourceInventoryId: null // thawed-stash pouch feeding from, if any
    };

    const overlay = document.getElementById('bottleOverlay');
    if (overlay) {
      overlay.addEventListener('click', e => {
        // Backdrop must not dismiss a live feed
        if (e.target === overlay && !this.bottle.active) this.closeBottleSheet();
      });
    }
    const closeBtn = document.getElementById('btCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (!this.bottle.active) this.closeBottleSheet();
      });
    }
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay && overlay.classList.contains('open') && !this.bottle.active) {
        this.closeBottleSheet();
      }
    });

    const tFormula = document.getElementById('btTypeFormula');
    if (tFormula) tFormula.addEventListener('click', () => this._btPickType('formula'));
    const tMilk = document.getElementById('btTypeBreastmilk');
    if (tMilk) tMilk.addEventListener('click', () => this._btPickType('breastmilk'));

    const slider = document.getElementById('btAmountSlider');
    if (slider) slider.addEventListener('input', () => this._btSetPrepared(this._ffToOz(parseFloat(slider.value))));
    const hero = document.getElementById('btAmountHero');
    if (hero) {
      hero.addEventListener('click', () => {
        this._amountInlineEdit('btAmountInput', 'btAmountValue',
          () => this._ffToDisplay(this.bottle.preparedOz),
          v => this._btSetPrepared(this._ffToOz(v)));
      });
    }
    const startTimerBtn = document.getElementById('btStartBtn');
    if (startTimerBtn) startTimerBtn.addEventListener('click', () => this.startBottleTimer());

    const stopBtn = document.getElementById('btStopBtn');
    if (stopBtn) stopBtn.addEventListener('click', () => this._btStopToReview());
    const cancelBtn = document.getElementById('btCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelBottleTimer());

    const eatenSlider = document.getElementById('btEatenSlider');
    if (eatenSlider) eatenSlider.addEventListener('input', () => this._btSetEaten(this._ffToOz(parseFloat(eatenSlider.value))));
    const eatenHero = document.getElementById('btEatenHero');
    if (eatenHero) {
      eatenHero.addEventListener('click', () => {
        this._amountInlineEdit('btEatenInput', 'btEatenValue',
          () => this._ffToDisplay(this.bottle.eatenOz),
          v => this._btSetEaten(this._ffToOz(v)));
      });
    }
    const backToLive = document.getElementById('btBackToLive');
    if (backToLive) {
      backToLive.addEventListener('click', () => {
        this._btShowStep('live');
        this._btStartTick();
      });
    }
    const logBtn = document.getElementById('btLogBtn');
    if (logBtn) logBtn.addEventListener('click', () => this._btConfirmLog());

    // Resume a live feed across reloads / backgrounding
    this._btRestore();
  }

  // The bottle-timer sheet is the "start bottle" half of the merged feed
  // action: it can be opened fresh or prefilled from the feed flow
  // (type, amount, and optional thawed-stash source).
  openBottleSetup(prefill = {}) {
    this.bottle.feedType = prefill.type === 'breastmilk' ? 'breastmilk' : 'formula';
    this.bottle.preparedOz = clampAmount(prefill.amountOz || 4.0, 0.5, 10, 0.1);
    this.bottle.sourceInventoryId = prefill.sourceInventoryId || null;
    this._btPickType(this.bottle.feedType);
    this._btBuildPresets();
    this._btRenderSetup();
    this._btShowStep('setup');
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Start bottle';
    const overlay = document.getElementById('bottleOverlay');
    if (overlay) overlay.classList.add('open');
  }

  closeBottleSheet() {
    const overlay = document.getElementById('bottleOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  _btPickType(type) {
    this.bottle.feedType = type;
    const fBtn = document.getElementById('btTypeFormula');
    if (fBtn) fBtn.classList.toggle('is-selected', type === 'formula');
    const mBtn = document.getElementById('btTypeBreastmilk');
    if (mBtn) mBtn.classList.toggle('is-selected', type === 'breastmilk');
    sound.playChime('tick');
  }

  _btBuildPresets() {
    this._ffBuildPresets('btPresetRow', v => this._btSetPrepared(this._ffToOz(v)));
  }

  _btSetPrepared(oz) {
    this.bottle.preparedOz = clampAmount(oz, 0.5, 10, 0.1);
    this._btRenderSetup();
  }

  _btRenderSetup() {
    const disp = this._ffToDisplay(this.bottle.preparedOz);
    const valEl = document.getElementById('btAmountValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const unitEl = document.getElementById('btAmountUnit');
    if (unitEl) unitEl.textContent = this.app.settings.units;
    const slider = document.getElementById('btAmountSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffMaxDisplay());
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const tol = this._ffIsMl() ? 1 : 0.05;
    document.querySelectorAll('#btPresetRow .ff-preset-chip').forEach(chip => {
      chip.classList.toggle('active', Math.abs(parseFloat(chip.dataset.val) - disp) < tol);
    });
  }

  startBottleTimer() {
    if (this.bottle.preparedOz <= 0 || this.bottle.active) return;
    this.bottle.active = true;
    this.bottle.startTs = Date.now();
    this.bottle.elapsedSec = 0;
    this.bottle.eatenOz = this.bottle.preparedOz;
    try {
      localStorage.setItem('nurture_bottle_timer', JSON.stringify({
        startTs: this.bottle.startTs,
        feedType: this.bottle.feedType,
        preparedOz: this.bottle.preparedOz
      }));
    } catch (e) {
      console.warn('Bottle timer persist failed:', e);
    }
    sound.playChime('tick');
    sound.vibrate([60]);
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Live feed';
    this._btShowStep('live');
    this._btStartTick();
  }

  _btStartTick() {
    this._btStopTick();
    this._btTick();
    this.bottle.tickId = setInterval(() => this._btTick(), 1000);
  }

  _btStopTick() {
    if (this.bottle.tickId) {
      clearInterval(this.bottle.tickId);
      this.bottle.tickId = null;
    }
  }

  _btTick() {
    if (!this.bottle.active || !this.bottle.startTs) return;
    const st = getBottleTimerStatus(this.bottle.startTs, this.bottle.feedType, Date.now());
    this.bottle.elapsedSec = st.elapsedSec;

    const elapsedEl = document.getElementById('btElapsed');
    if (elapsedEl) elapsedEl.textContent = fmtClock(st.elapsedSec);

    const safetyEl = document.getElementById('btSafety');
    if (safetyEl) {
      if (st.expired) {
        safetyEl.textContent = "⏰ Time's up — start a fresh bottle";
        safetyEl.classList.add('is-expired');
      } else {
        safetyEl.textContent = `Good for ${fmtSafetyWindow(st.safetyRemainingSec)}`;
        safetyEl.classList.remove('is-expired');
      }
    }

    const fill = document.getElementById('btProgressFill');
    if (fill) {
      const pct = Math.max(0, Math.min(100, (st.safetyRemainingSec / st.windowSec) * 100));
      fill.style.width = `${pct}%`;
    }

    const meta = document.getElementById('btLiveMeta');
    if (meta) {
      const started = new Date(this.bottle.startTs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      meta.textContent = `${this._ffAmtStr(this.bottle.preparedOz)} ${this.bottle.feedType === 'formula' ? 'Formula' : 'Breast milk'} • started ${started}`;
    }
  }

  _btShowStep(step) {
    const map = { setup: 'btStepSetup', live: 'btStepLive', review: 'btStepReview' };
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (el) el.classList.toggle('active', key === step);
    });
  }

  _btStopToReview() {
    this._btStopTick();
    this._btTick(); // freeze final elapsed time
    this.bottle.eatenOz = this.bottle.preparedOz; // default: full bottle
    this._btRenderReview();
    const title = document.getElementById('btTitle');
    if (title) title.textContent = 'Review feed';
    this._btShowStep('review');
  }

  _btSetEaten(oz) {
    this.bottle.eatenOz = clampAmount(oz, 0, this.bottle.preparedOz, 0.1);
    this._btRenderReview();
  }

  _btRenderReview() {
    const disp = this._ffToDisplay(this.bottle.eatenOz);
    const valEl = document.getElementById('btEatenValue');
    if (valEl) valEl.textContent = this._ffIsMl() ? String(disp) : disp.toFixed(1);
    const unitEl = document.getElementById('btEatenUnit');
    if (unitEl) unitEl.textContent = this.app.settings.units;
    const slider = document.getElementById('btEatenSlider');
    if (slider) {
      slider.min = '0';
      slider.max = String(this._ffToDisplay(this.bottle.preparedOz));
      slider.step = String(this._ffStepDisplay());
      slider.value = String(disp);
    }
    const paceEl = document.getElementById('btPaceLine');
    if (paceEl) {
      const pace = paceOzPerMin(this.bottle.eatenOz, this.bottle.elapsedSec);
      const mins = Math.max(1, Math.round(this.bottle.elapsedSec / 60));
      paceEl.textContent = `Pace: ${pace} oz/min over ~${mins} min`;
    }
  }

  async _btConfirmLog() {
    const eatenOz = this.bottle.eatenOz !== undefined ? this.bottle.eatenOz : this.bottle.preparedOz;
    const qty = this._ffToDisplay(eatenOz);
    const note = `Bottle feed (${this._ffAmtStr(this.bottle.preparedOz)} prepared)`;
    await this.trackFood(this.bottle.feedType, qty, this.bottle.elapsedSec, note);
    await this._consumeThawedSource(this.bottle.sourceInventoryId, this.bottle.eatenOz);
    this._btClear();
    this.closeBottleSheet();
  }

  cancelBottleTimer() {
    if (!this.bottle.active) {
      this.closeBottleSheet();
      return;
    }
    if (!confirm('Cancel this bottle feed? Nothing will be logged.')) return;
    this._btClear();
    this.closeBottleSheet();
  }

  _btClear() {
    this._btStopTick();
    this.bottle.active = false;
    this.bottle.startTs = null;
    this.bottle.sourceInventoryId = null;
    try {
      localStorage.removeItem('nurture_bottle_timer');
    } catch (e) {
      console.warn('Bottle timer clear failed:', e);
    }
  }

  _btRestore() {
    try {
      const raw = localStorage.getItem('nurture_bottle_timer');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (!s || !s.startTs || !s.feedType) return;
      this.bottle.active = true;
      this.bottle.startTs = s.startTs;
      this.bottle.feedType = s.feedType === 'breastmilk' ? 'breastmilk' : 'formula';
      this.bottle.preparedOz = s.preparedOz || 4.0;
      this.bottle.eatenOz = this.bottle.preparedOz;
      const title = document.getElementById('btTitle');
      if (title) title.textContent = 'Live feed';
      this._btShowStep('live');
      const overlay = document.getElementById('bottleOverlay');
      if (overlay) overlay.classList.add('open');
      this._btStartTick();
    } catch (e) {
      console.warn('Bottle timer restore failed:', e);
    }
  }
}
