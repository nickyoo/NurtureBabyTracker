// Round-1 FLOWS lens (resumed) helpers: re-export the earlier lib, shots go to ./shots/.
export * from '../flows/lib.mjs';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
export const SHOTS2 = fileURLToPath(new URL('./shots/', import.meta.url));
await mkdir(SHOTS2, { recursive: true });
export async function shot2(page, name) { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.waitForTimeout(300); const p = `${SHOTS2}${name}.png`; await page.screenshot({ path: p }); return p; }
