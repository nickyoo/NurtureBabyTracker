// Export and Backup Management
import { db } from './db.js';

export class ExportManager {
  // Generate structured CSV for pediatricians / lactation consultants
  static async exportSessionsCsv() {
    const sessions = await db.getSessions();
    if (!sessions || sessions.length === 0) {
      alert('No sessions logged yet to export.');
      return;
    }

    const headers = ['Date', 'Start Time', 'End Time', 'Type', 'Side', 'Duration (Min)', 'Output Volume', 'Unit', 'Notes'];
    const rows = [headers];

    sessions.forEach(s => {
      const startDate = new Date(s.startTime);
      const endDate = s.endTime ? new Date(s.endTime) : startDate;

      // Local YYYY-MM-DD: locale-independent (sorts correctly) but keeps the user's own day, unlike toISOString (UTC)
      const pad = (n) => String(n).padStart(2, '0');
      const dateStr = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}`;
      const startTimeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let typeStr = 'Pumping';
      if (s.type === 'feed') {
        typeStr = s.feedType === 'formula' ? 'Feed (Formula)' : (s.feedType === 'breastmilk' ? 'Feed (Breast Milk)' : 'Feed');
      }
      const sideStr = s.type === 'feed' ? (s.side || 'Both') : 'Both';
      const durationMin = Math.round(((s.durationSec || 0) / 60) * 10) / 10;
      const qtyStr = s.outputQty !== undefined ? s.outputQty : '';
      const unitStr = s.unit || '';
      const notesClean = (s.notes || '').replace(/"/g, '""');

      rows.push([
        `"${dateStr}"`,
        `"${startTimeStr}"`,
        `"${endTimeStr}"`,
        `"${typeStr}"`,
        `"${sideStr}"`,
        `"${durationMin}"`,
        `"${qtyStr}"`,
        `"${unitStr}"`,
        `"${notesClean}"`
      ]);
    });

    const csvContent = rows.map(r => r.join(',')).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const filename = `nurture_feeding_log_${new Date().toISOString().slice(0, 10)}.csv`;
    ExportManager._downloadBlob(blob, filename);
  }

  // Full JSON database backup
  static async exportJsonBackup() {
    const data = await db.exportBackup();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const filename = `nurture_backup_${new Date().toISOString().slice(0, 10)}.json`;
    ExportManager._downloadBlob(blob, filename);
  }

  // Restore from JSON backup file
  static async importJsonBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          await db.importBackup(parsed);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  static _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
