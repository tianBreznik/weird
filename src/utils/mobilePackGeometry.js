/**
 * One geometry source for mobile packing: live reader when mounted, else the hidden
 * MobileGeometryProbe (same CSS as the reader, always in the DOM during load).
 */
const LIVE_ROOT =
  '.page-reader:not(.mobile-pack-shell):not(.mobile-geometry-probe)';
const PROBE_ROOT = '.page-reader.mobile-geometry-probe';

function pick(live, probe) {
  if (live) {
    const r = live.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return live;
  }
  return probe || live;
}

export function queryMobilePackGeometry() {
  if (typeof document === 'undefined') return null;

  const liveContainer = document.querySelector(
    `${LIVE_ROOT} .page-container, .page-turn-surface .page-container`
  );
  const probeContainer = document.querySelector(`${PROBE_ROOT} .page-container`);

  const liveSheet = document.querySelector(
    `${LIVE_ROOT} .page-sheet.content-page, .page-turn-surface .page-sheet.content-page`
  );
  const probeSheet = document.querySelector(`${PROBE_ROOT} .page-sheet.content-page`);

  const liveBody = document.querySelector(
    `${LIVE_ROOT} .page-body.content-body, .page-turn-surface .page-body.content-body`
  );
  const probeBody = document.querySelector(`${PROBE_ROOT} .page-body.content-body`);

  const liveContent = document.querySelector(
    `${LIVE_ROOT} .page-content, .page-turn-surface .page-content`
  );
  const probeContent = document.querySelector(`${PROBE_ROOT} .page-content`);

  const liveMain = document.querySelector(
    `${LIVE_ROOT} .page-content-main, .page-turn-surface .page-content-main`
  );
  const probeMain = document.querySelector(`${PROBE_ROOT} .page-content-main`);

  const container = pick(liveContainer, probeContainer);
  const sheet = pick(liveSheet, probeSheet);
  const body = pick(liveBody, probeBody);
  const pageContent = pick(liveContent, probeContent);
  const main = pick(liveMain, probeMain);

  if (!container || !sheet || !body) return null;

  const sheetW = sheet.getBoundingClientRect().width;
  const bodyH = body.clientHeight;
  if (sheetW < 200 || bodyH < 80) return null;

  return { container, sheet, body, pageContent, main, fromProbe: !liveBody && !!probeBody };
}

export async function waitForMobilePackGeometry(maxFrames = 240) {
  for (let i = 0; i < maxFrames; i += 1) {
    const geom = queryMobilePackGeometry();
    if (geom) return geom;
    await new Promise((r) => requestAnimationFrame(r));
  }
  return queryMobilePackGeometry();
}
