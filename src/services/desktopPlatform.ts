export type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown';

interface DesktopPlatformDetectionInput {
  buildPlatform?: string;
  navigatorPlatform?: string;
  userAgent?: string;
}

export function detectDesktopPlatform(
  input: DesktopPlatformDetectionInput = browserDesktopPlatformInput(),
): DesktopPlatform {
  const buildPlatform = normalizePlatformName(input.buildPlatform);
  if (buildPlatform !== 'unknown') {
    return buildPlatform;
  }

  return normalizePlatformName(`${input.navigatorPlatform ?? ''} ${input.userAgent ?? ''}`);
}

function browserDesktopPlatformInput(): DesktopPlatformDetectionInput {
  return {
    buildPlatform: import.meta.env.TAURI_ENV_PLATFORM,
    navigatorPlatform: typeof navigator === 'undefined' ? undefined : navigator.platform,
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  };
}

function normalizePlatformName(platformName: string | undefined): DesktopPlatform {
  const normalizedName = platformName?.trim().toLowerCase() ?? '';
  if (normalizedName.includes('mac') || normalizedName.includes('darwin')) {
    return 'macos';
  }
  if (normalizedName.includes('win')) {
    return 'windows';
  }
  if (normalizedName.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}
