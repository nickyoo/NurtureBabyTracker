// Pump timer tile controller — the hero live-timer tile (start/stop, output
// stepper, click-to-type goal), plus the manual "log a pump without the
// timer" modal. Takes the main App instance for shared settings state and
// the cross-cutting renders a finished pump session needs to trigger.
import { db } from './db.js';
import { sound } from './audio.js';
import { timer, normalizePumpDuration } from './timer.js';
import { reminders } from './reminders.js';

export class PumpTimerView {
  constructor(app) {
    this.app = app;
  }

  async initEvents() {
    const app = this.app;

    const mainTimerBtn = document.getElementById('mainTimerBtn');
    if (mainTimerBtn) {
      mainTimerBtn.addEventListener('click', async () => {
        if (!timer.active) {
          timer.start();
        } else {
          await timer.stopAndSave({
            units: app.settings.units,
            storageWindows: app.settings.storageWindows
          });
          await app.renderTodayDashboard();
          await app.renderInventory();
          await reminders.updateStatus();
        }
      });
    }

    const cancelTimerBtn = document.getElementById('cancelTimerBtn');
    if (cancelTimerBtn) {
      cancelTimerBtn.addEventListener('click', () => {
        if (confirm('Discard current timer without saving?')) {
          timer.cancel();
        }
      });
    }

    const pumpMinusBtn = document.getElementById('pumpMinusBtn');
    const pumpPlusBtn = document.getElementById('pumpPlusBtn');
    if (pumpMinusBtn) {
      pumpMinusBtn.addEventListener('click', () => {
        timer.adjustPumpOutput(app.settings.units === 'oz' ? -0.5 : -15, app.settings.units);
      });
    }
    if (pumpPlusBtn) {
      pumpPlusBtn.addEventListener('click', () => {
        timer.adjustPumpOutput(app.settings.units === 'oz' ? 0.5 : 15, app.settings.units);
      });
    }

    document.querySelectorAll('.chip-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = parseFloat(btn.dataset.delta);
        timer.adjustPumpOutput(delta, app.settings.units);
      });
    });

    const stashDestSelect = document.getElementById('stashDestSelect');
    if (stashDestSelect) {
      stashDestSelect.addEventListener('change', (e) => {
        timer.setStoreDestination(e.target.value);
      });
    }

    // Direct Click-to-Type for Pump Output Number
    const stepperValDisplay = document.getElementById('stepperValDisplay');
    const stepperPumpVal = document.getElementById('stepperPumpVal');
    const stepperPumpInput = document.getElementById('stepperPumpInput');

    if (stepperValDisplay && stepperPumpVal && stepperPumpInput) {
      const showPumpInput = () => {
        stepperPumpVal.style.display = 'none';
        stepperPumpInput.style.display = 'block';
        stepperPumpInput.value = app.settings.units === 'oz' ? timer.pumpOutputOz : timer.pumpOutputMl;
        stepperPumpInput.focus();
        stepperPumpInput.select();
      };

      const commitPumpInput = () => {
        if (stepperPumpInput.style.display !== 'none') {
          const val = parseFloat(stepperPumpInput.value);
          if (!isNaN(val) && val > 0) {
            timer.setPumpOutput(val, app.settings.units);
          }
          stepperPumpInput.style.display = 'none';
          stepperPumpVal.style.display = 'block';
        }
      };

      stepperValDisplay.addEventListener('click', (e) => {
        if (e.target !== stepperPumpInput) {
          showPumpInput();
        }
      });

      stepperPumpInput.addEventListener('blur', commitPumpInput);
      stepperPumpInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitPumpInput();
          stepperPumpInput.blur();
        } else if (e.key === 'Escape') {
          stepperPumpInput.style.display = 'none';
          stepperPumpVal.style.display = 'block';
        }
      });
    }

    // Direct Click-to-Type for Daily Goal (lives on the same goal-bottle tile)
    const goalFractionDisplay = document.getElementById('goalFractionDisplay');
    const goalTargetValue = document.getElementById('goalTargetValue');
    const goalTargetInput = document.getElementById('goalTargetInput');

    if (goalFractionDisplay && goalTargetValue && goalTargetInput) {
      const showGoalInput = () => {
        goalTargetValue.style.display = 'none';
        goalTargetInput.style.display = 'inline-block';
        goalTargetInput.value = app.settings.units === 'oz'
          ? app.settings.dailyGoalOz
          : Math.round(app.settings.dailyGoalOz * 29.5735);
        goalTargetInput.focus();
        goalTargetInput.select();
      };

      const commitGoalInput = async () => {
        if (goalTargetInput.style.display !== 'none') {
          const val = parseFloat(goalTargetInput.value);
          if (!isNaN(val) && val > 0) {
            const goalInOz = app.settings.units === 'mL' ? (val / 29.5735) : val;
            app.settings.dailyGoalOz = Math.round(goalInOz * 10) / 10;
            await db.setSetting('dailyGoalOz', app.settings.dailyGoalOz);
            sound.playChime('tick');
            app.updateBottleFillLevel();
          }
          goalTargetInput.style.display = 'none';
          goalTargetValue.style.display = 'inline';
        }
      };

      goalTargetValue.addEventListener('click', (e) => {
        e.stopPropagation();
        showGoalInput();
      });

      goalTargetInput.addEventListener('blur', commitGoalInput);
      goalTargetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitGoalInput();
          goalTargetInput.blur();
        } else if (e.key === 'Escape') {
          goalTargetInput.style.display = 'none';
          goalTargetValue.style.display = 'inline';
        }
      });
    }

    timer.setCallbacks({
      onTick: (data) => this.updateDisplay(data),
      onStateChange: () => this.updateDisplay(timer.getDisplayData()),
      onSaved: () => {
        this.updateDisplay(timer.getDisplayData());
      }
    });

    this.updateDisplay(timer.getDisplayData());

    // Manual pump entry modal (log duration + amount, no timer)
    const manualPumpBtn = document.getElementById('manualPumpBtn');
    if (manualPumpBtn) {
      manualPumpBtn.addEventListener('click', () => this.openManualPump());
    }
    const manualPumpModal = document.getElementById('manualPumpModal');
    if (manualPumpModal) {
      document.getElementById('closeManualPumpBtn').addEventListener('click', () => this.closeManualPump());
      document.getElementById('saveManualPumpBtn').addEventListener('click', () => this.saveManualPump());
      // Quick-duration chips (10 / 15 / 20 min) fill the typed duration field.
      manualPumpModal.querySelectorAll('#manualPumpDurationChips .chip-btn').forEach(chip => {
        chip.addEventListener('click', () => {
          const minutes = normalizePumpDuration(chip.dataset.min);
          if (minutes !== null) {
            document.getElementById('manualPumpDuration').value = String(minutes);
            sound.playChime('tick');
          }
        });
      });
      manualPumpModal.addEventListener('click', (e) => {
        if (e.target === manualPumpModal) this.closeManualPump();
      });
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && manualPumpModal.classList.contains('open')) this.closeManualPump();
      });
    }
  }

  updateDisplay(data) {
    const app = this.app;
    const digitsEl = document.getElementById('timerDigits');
    const heroTile = document.getElementById('timerHeroTile');
    const statusText = document.getElementById('timerStatusText');
    const actionBtn = document.getElementById('mainTimerBtn');
    const cancelBtn = document.getElementById('cancelTimerBtn');

    digitsEl.textContent = data.formattedTotal;
    cancelBtn.style.display = data.active ? 'inline-block' : 'none';

    if (heroTile) {
      heroTile.classList.toggle('active', data.active);
    }

    if (data.active) {
      actionBtn.className = 'main-timer-action-btn stop-btn';
      actionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
        <span>Finish & Save (${app.settings.units === 'oz' ? data.pumpOutputOz.toFixed(1) + ' oz' : data.pumpOutputMl + ' mL'})</span>
      `;
      statusText.textContent = 'Pumping Session in Progress';
    } else {
      actionBtn.className = 'main-timer-action-btn start-btn';
      actionBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        <span>Start Pumping</span>
      `;
      statusText.textContent = 'Ready for Next Pump';
    }

    const pumpValEl = document.getElementById('stepperPumpVal');
    if (pumpValEl) {
      pumpValEl.textContent = app.settings.units === 'oz'
        ? data.pumpOutputOz.toFixed(1)
        : data.pumpOutputMl;
    }
  }

  // --- MANUAL PUMP ENTRY (log duration + amount, no timer) ---
  openManualPump() {
    document.getElementById('manualPumpUnitLabel').textContent = this.app.settings.units;
    document.getElementById('manualPumpQty').value = '';
    document.getElementById('manualPumpDuration').value = '';
    document.getElementById('manualPumpNotes').value = '';
    document.getElementById('manualPumpDest').value = timer.storeDestination || 'fridge';
    const now = new Date();
    document.getElementById('manualPumpTime').value =
      new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('manualPumpModal').classList.add('open');
  }

  closeManualPump() {
    document.getElementById('manualPumpModal').classList.remove('open');
  }

  async saveManualPump() {
    const app = this.app;
    const qty = parseFloat(document.getElementById('manualPumpQty').value);
    if (!qty || qty <= 0) { alert('Please enter a valid amount.'); return; }
    const durationMin = normalizePumpDuration(document.getElementById('manualPumpDuration').value);
    if (durationMin === null) { alert('Please enter a valid duration.'); return; }

    const timeVal = document.getElementById('manualPumpTime').value;
    const startTime = timeVal ? new Date(timeVal).getTime() : Date.now();
    if (isNaN(startTime)) { alert('Please enter a valid date and time.'); return; }

    await timer.logManualPump({
      quantity: qty,
      durationMin,
      unit: app.settings.units,
      startTime,
      notes: document.getElementById('manualPumpNotes').value.trim(),
      storeDestination: document.getElementById('manualPumpDest').value
    });

    this.closeManualPump();
    await app.renderTodayDashboard();
    await reminders.updateStatus();
    await app.updateQuickFoodTally();
  }
}
