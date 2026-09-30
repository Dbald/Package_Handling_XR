// WebXR capability detection and session lifecycle (PRD FR-13, §9).
// Sessions are requested only from an explicit user action. Neither DOM
// overlay nor hand tracking is assumed.

export async function detectXR() {
  if (!globalThis.isSecureContext) {
    return {
      status: 'insecure',
      message: 'VR needs a secure (https://) link. Open the HTTPS address of this page in Meta Quest Browser. Desktop preview still works here.',
    };
  }
  if (!('xr' in navigator) || !navigator.xr) {
    return {
      status: 'no-webxr',
      message: 'This browser does not expose WebXR. On Quest 2, open this link in Meta Quest Browser. You can use the desktop preview now.',
    };
  }
  try {
    const ok = await navigator.xr.isSessionSupported('immersive-vr');
    if (!ok) {
      return {
        status: 'unsupported',
        message: 'Immersive VR is not available in this browser or no headset is connected. Use the desktop preview, or open this link in Meta Quest Browser.',
      };
    }
  } catch (err) {
    return { status: 'unsupported', message: `Could not check VR support (${err.name}). Use the desktop preview.` };
  }
  return { status: 'supported', message: 'VR ready. Put on your headset and select Enter VR.' };
}

export function describeXRError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'VR entry was declined or blocked. Select Enter VR to try again and allow the VR permission prompt, or continue in the desktop preview.';
    case 'SecurityError':
      return 'The browser blocked VR for this page (it must be HTTPS and started from a button press). Reload the HTTPS link and try again.';
    case 'NotSupportedError':
      return 'This headset/browser does not support the required VR features. Try Meta Quest Browser, or continue in the desktop preview.';
    case 'InvalidStateError':
      return 'Another VR session is already running. Close it, then select Enter VR again.';
    default:
      return `Could not start VR (${err?.name ?? 'error'}: ${err?.message ?? 'unknown'}). Select Enter VR to retry, or use the desktop preview.`;
  }
}

/**
 * Request an immersive session and hand it to the renderer.
 * Returns { session, floor: boolean } — floor=false means a 'local' space
 * without floor alignment, so the caller must offset content by eye height.
 */
export async function startXRSession(renderer) {
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor'],
    });
  } catch (err) {
    if (err?.name !== 'NotSupportedError') throw err;
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
  }
  let floor = true;
  try {
    await session.requestReferenceSpace('local-floor');
  } catch {
    floor = false;
  }
  renderer.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local');
  renderer.xr.setFoveation(1);
  await renderer.xr.setSession(session);
  return { session, floor };
}
