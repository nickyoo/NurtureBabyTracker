// Supply Trends & History Analytics Module
import { db } from './db.js';

export class TrendsManager {
  // Aggregate daily pump and feed totals
  static async getDailyAggregates(daysCount = 7) {
    const sessions = await db.getSessions();
    const settings = await db.getAllSettings();
    const unit = settings.units || 'oz';

    const days = [];
    const now = new Date();

    for (let i = daysCount - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const startOfDay = d.getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;

      const daySessions = sessions.filter(s => s.startTime >= startOfDay && s.startTime <= endOfDay);

      let pumpVolume = 0;
      let pumpCount = 0;
      let feedCount = 0;
      let feedDurationSec = 0;

      for (const s of daySessions) {
        if (s.type === 'pump') {
          pumpCount++;
          const qty = s.outputQty || 0;
          if (unit === 'oz' && s.unit === 'mL') {
            pumpVolume += qty / 29.5735;
          } else if (unit === 'mL' && s.unit === 'oz') {
            pumpVolume += qty * 29.5735;
          } else {
            pumpVolume += qty;
          }
        } else if (s.type === 'feed') {
          feedCount++;
          feedDurationSec += s.durationSec || 0;
        }
      }

      days.push({
        date: d,
        dateKey: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        dayName: i === 0 ? 'Today' : (i === 1 ? 'Yest.' : d.toLocaleDateString([], { weekday: 'short' })),
        pumpVolume: Math.round(pumpVolume * 10) / 10,
        pumpCount,
        feedCount,
        feedDurationMinutes: Math.round(feedDurationSec / 60)
      });
    }

    return { days, unit };
  }

  // Render responsive SVG Supply Trend Chart
  static renderSvgChart(days, unit = 'oz', containerWidth = 360, containerHeight = 160) {
    if (!days || days.length === 0) return '';

    const maxVal = Math.max(1, ...days.map(d => d.pumpVolume));
    const padX = 36;
    const padY = 24;
    const padBottom = 28;

    const chartW = containerWidth - padX * 2;
    const chartH = containerHeight - padY - padBottom;

    const stepX = chartW / (days.length - 1 || 1);

    // Compute point coordinates
    const points = days.map((d, idx) => {
      const x = padX + idx * stepX;
      const ratio = d.pumpVolume / (maxVal * 1.15); // headroom
      const y = padY + (chartH * (1 - ratio));
      return { x, y, val: d.pumpVolume, label: d.dayName };
    });

    // Build SVG Path (smooth bezier)
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      pathD += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }

    // Area fill path
    const lastP = points[points.length - 1];
    const firstP = points[0];
    const areaD = `${pathD} L ${lastP.x} ${padY + chartH} L ${firstP.x} ${padY + chartH} Z`;

    // Horizontal grid lines using CSS border variable
    const gridLines = [0.25, 0.5, 0.75, 1.0].map(ratio => {
      const y = padY + chartH * (1 - ratio / 1.15);
      const val = Math.round((maxVal * ratio) * 10) / 10;
      return `
        <line x1="${padX}" y1="${y}" x2="${containerWidth - padX}" y2="${y}" stroke="var(--border-subtle)" stroke-width="1" stroke-dasharray="3 3"/>
        <text x="${padX - 6}" y="${y + 3}" fill="var(--text-muted)" font-size="10" text-anchor="end" font-family="var(--font-heading)" font-weight="600">${val}</text>
      `;
    }).join('');

    // Bottom Day Labels & Dots
    const markers = points.map(p => `
      <text x="${p.x}" y="${containerHeight - 8}" fill="var(--text-secondary)" font-size="11" text-anchor="middle" font-family="var(--font-heading)" font-weight="600">${p.label}</text>
      <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="var(--rose-primary)" stroke="var(--bg-card)" stroke-width="2.5"/>
      ${p.val > 0 ? `<text x="${p.x}" y="${p.y - 8}" fill="var(--rose-primary)" font-size="10" font-weight="700" text-anchor="middle" font-family="var(--font-heading)">${p.val}</text>` : ''}
    `).join('');

    return `
      <svg viewBox="0 0 ${containerWidth} ${containerHeight}" width="100%" height="${containerHeight}" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
        <defs>
          <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--rose-primary)" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="var(--rose-primary)" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        ${gridLines}
        <path d="${areaD}" fill="url(#chartAreaGrad)" />
        <path d="${pathD}" fill="none" stroke="var(--rose-primary)" stroke-width="3" stroke-linecap="round"/>
        ${markers}
      </svg>
    `;
  }

  // Group session history list by day
  static groupSessionsByDay(sessions) {
    const groups = {};

    sessions.forEach(sess => {
      const d = new Date(sess.startTime);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let key = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
      let title = key;

      if (d.toDateString() === today.toDateString()) {
        title = 'Today';
      } else if (d.toDateString() === yesterday.toDateString()) {
        title = 'Yesterday';
      }

      if (!groups[key]) {
        groups[key] = {
          title,
          date: d,
          sessions: [],
          totalPumpQty: 0,
          feedCount: 0
        };
      }

      groups[key].sessions.push(sess);
      if (sess.type === 'pump') {
        groups[key].totalPumpQty += (sess.outputQty || 0);
      } else if (sess.type === 'feed') {
        groups[key].feedCount++;
      }
    });

    return Object.values(groups).sort((a, b) => b.date - a.date);
  }
}
