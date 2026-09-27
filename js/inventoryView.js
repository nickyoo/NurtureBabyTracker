// Stash (Inventory) tab controller — the FIFO milk-pouch list, its actions
// (thaw / mark used / discard), and the "Add Stored Milk Pouch" modal. These
// are the shared inventory-mutation actions other views (the Feed tab's
// thaw tile) also call into.
import { inventory, InventoryManager, THAWED_LOCATION, FROZEN_LOCATIONS } from './inventory.js';

export class InventoryView {
  constructor(app) {
    this.app = app;
  }

  async render() {
    const app = this.app;
    const listContainer = document.getElementById('inventoryListContainer');
    if (!listContainer) return;

    const summary = await inventory.getStashSummary();
    const unit = app.settings.units;
    const isMl = unit === 'mL';
    const totalDisplay = isMl ? Math.round(summary.totalOz * 29.5735) : summary.totalOz;
    const fridgeDisplay = isMl ? Math.round(summary.fridgeOz * 29.5735) : summary.fridgeOz;
    const freezerDisplay = isMl ? Math.round((summary.freezerOz + summary.deepFreezerOz) * 29.5735) : Math.round((summary.freezerOz + summary.deepFreezerOz) * 10) / 10;

    const totEl = document.getElementById('stashTotalVolume');
    const frEl = document.getElementById('stashFridgeVolume');
    const fzEl = document.getElementById('stashFreezerVolume');
    if (totEl) totEl.textContent = `${totalDisplay} ${unit}`;
    if (frEl) frEl.textContent = `${fridgeDisplay} ${unit}`;
    if (fzEl) fzEl.textContent = `${freezerDisplay} ${unit}`;

    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.filter === inventory.currentFilter);
      pill.onclick = () => {
        inventory.currentFilter = pill.dataset.filter;
        this.render();
      };
    });

    const items = await inventory.getFilteredItems();

    if (!items || items.length === 0) {
      listContainer.innerHTML = `
        <div class="card-tile empty-stash-msg">
          <div class="empty-stash-title">No milk stored in this view</div>
          <div class="empty-stash-sub">Tap "Add Stored Milk Pouch" to record a pouch.</div>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = items.map((item, index) => {
      const isFifoFirst = (index === 0 && item.status === 'active' && inventory.currentFilter !== 'archived');
      const urgency = InventoryManager.getUrgency(item.expiresAt);
      const pumpDateStr = new Date(item.pumpedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      const pumpTimeStr = new Date(item.pumpedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

      const locLabels = {
        fridge: 'Refrigerator',
        freezer: 'Freezer',
        deepFreezer: 'Deep Chest',
        room: 'Room Temp',
        [THAWED_LOCATION]: 'Thawed (Fridge)'
      };

      const locName = locLabels[item.location] || item.location;

      let displayQty = item.quantity;
      let displayUnit = item.unit || 'oz';
      if (app.settings.units === 'mL' && displayUnit === 'oz') {
        displayQty = Math.round(item.quantity * 29.5735);
        displayUnit = 'mL';
      } else if (app.settings.units === 'oz' && displayUnit === 'mL') {
        displayQty = Math.round((item.quantity / 29.5735) * 10) / 10;
        displayUnit = 'oz';
      }

      return `
        <div class="inventory-tile ${isFifoFirst ? 'fifo-first' : ''}" data-id="${item.id}">
          ${isFifoFirst ? `
            <div class="fifo-badge">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              Use Next (FIFO)
            </div>
          ` : ''}
          <div class="inv-card-top">
            <div class="inv-qty-title">
              ${displayQty} <span class="inv-qty-unit">${displayUnit}</span>
            </div>
            <div class="inv-countdown-pill ${urgency.badgeClass}">
              ${urgency.label}
            </div>
          </div>

          <div class="inv-dates-row">
            <div><span>Pumped:</span> ${pumpDateStr} (${pumpTimeStr})</div>
            <div class="inv-location-tag">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="2" width="18" height="20" rx="2" ry="2"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              ${locName}
            </div>
          </div>

          ${item.notes ? `<div class="note-italic-secondary">"${item.notes}"</div>` : ''}

          ${item.status === 'active' ? `
            <div class="inv-card-actions">
              ${FROZEN_LOCATIONS.includes(item.location) ? `
              <button class="inv-action-btn thaw-btn" data-action="thaw-item" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 2h6M10 2v3a2 2 0 0 1-2 2H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1a2 2 0 0 1-2-2V2"/>
                </svg>
                Thaw
              </button>
              ` : ''}
              <button class="inv-action-btn" data-action="mark-used" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Used
              </button>
              <button class="inv-action-btn" data-action="discard-item" data-id="${item.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
                Discard
              </button>
            </div>
          ` : `
            <div class="inv-status-label">
              Status: ${item.status}
            </div>
          `}
        </div>
      `;
    }).join('');
  }

  async markUsedItem(id) {
    await inventory.markUsed(id);
    this.render();
  }

  async discardItem(id) {
    if (confirm('Archive / Discard this item?')) {
      await inventory.markDiscarded(id);
      this.render();
    }
  }

  // --- THAW FROM STASH (shared action: inventory list rows + the Feed
  // tab's thaw tile both call this) ---
  async thawItem(id) {
    if (!confirm('Thaw this pouch? It moves from your frozen stash into the thawed stash, ready for the next feed.')) return;
    const thawed = await inventory.thawItem(id);
    if (!thawed) {
      alert('That pouch could not be thawed.');
      return;
    }
    await this.app.renderTodayDashboard();
    await this.render();
    this.app._ffRenderThawedSources();
  }

  initEvents() {
    const app = this.app;
    const addMilkBtn = document.getElementById('openAddMilkModalBtn');
    const addMilkModal = document.getElementById('addMilkModal');
    const closeAddMilkBtn = document.getElementById('closeAddMilkBtn');
    const saveNewMilkBtn = document.getElementById('saveNewMilkBtn');

    if (addMilkBtn && addMilkModal) {
      addMilkBtn.addEventListener('click', () => {
        const now = new Date();
        const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('modalPumpedAt').value = localIso;
        document.getElementById('modalMilkQty').value = app.settings.units === 'oz' ? 4.0 : 120;
        addMilkModal.classList.add('open');
      });

      closeAddMilkBtn.addEventListener('click', () => addMilkModal.classList.remove('open'));

      saveNewMilkBtn.addEventListener('click', async () => {
        const pumpedAtVal = document.getElementById('modalPumpedAt').value;
        const qtyVal = parseFloat(document.getElementById('modalMilkQty').value);
        const locVal = document.getElementById('modalMilkLoc').value;
        const notesVal = document.getElementById('modalMilkNotes').value;

        if (!qtyVal || qtyVal <= 0) {
          alert('Please enter a valid milk volume.');
          return;
        }

        const pumpedAt = pumpedAtVal ? new Date(pumpedAtVal).getTime() : Date.now();

        await inventory.addItem({
          pumpedAt,
          quantity: qtyVal,
          unit: app.settings.units,
          location: locVal,
          notes: notesVal,
          storageWindows: app.settings.storageWindows
        });

        addMilkModal.classList.remove('open');
        this.render();
      });
    }
  }
}
