// Every sheet/modal in the app, and how a person gets to it. Shared by the layout
// tests and the click sweep so there is exactly one list to keep up to date.
import { goTab, settle } from './harness.js';

export const OVERLAYS = [
  { id: 'addMilkModal', exit: '#closeAddMilkBtn', primary: '#saveNewMilkBtn',
    open: async (p) => { await goTab(p, 'inventory'); await p.click('#openAddMilkModalBtn'); } },
  { id: 'editSessionModal', exit: '#closeEditSessionBtn', primary: '#saveEditSessionBtn',
    open: async (p) => { await goTab(p, 'pump'); await p.click('#feedsTrackerRows .feeds-tracker-row'); } },
  { id: 'manualPumpModal', exit: '#closeManualPumpBtn', primary: '#saveManualPumpBtn',
    open: async (p) => { await goTab(p, 'pump'); await p.click('#manualPumpBtn'); } },
  { id: 'feedFlowOverlay', exit: '#ffCloseBtn',
    open: async (p) => { await p.click('#quickFeedFab'); } },
  { id: 'bottleOverlay', exit: '#btCloseBtn', primary: '#btStartBtn',
    open: async (p) => {
      await p.click('#quickFeedFab'); await p.click('#ffTypeFormula');
      await settle(p, 400); // the type tap glides to the amount step after 220ms
      await p.waitForSelector('#ffStepAmount.active');
      await p.click('#ffStartTimerBtn');
    } },
  { id: 'installGuideModal', exit: '#installGuideCloseBtn',
    open: async (p) => { await goTab(p, 'pump'); await p.click('#installBannerCta'); } },
  { id: 'onboardingModal', exit: '#skipOnboardingBtn',
    open: async (p) => { await goTab(p, 'settings'); await p.click('#replayTourBtn'); } },
];

export async function waitOverlayOpen(page, id) {
  await page.waitForFunction((i) => (i === 'onboardingModal'
    ? getComputedStyle(document.getElementById(i)).display !== 'none'
    : document.getElementById(i).classList.contains('open')), id);
}
