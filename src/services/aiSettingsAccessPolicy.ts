const AI_READ_ONLY_SETTING_KEYS = ['baseUrl', 'token'] as const;

export function validateAiManagedSettingsPatch(patch: unknown): void {
  if (!isRecord(patch)) {
    return;
  }
  const readOnlySetting = AI_READ_ONLY_SETTING_KEYS.find((settingKey) =>
    Object.prototype.hasOwnProperty.call(patch, settingKey),
  );
  if (readOnlySetting !== undefined) {
    throw new Error(`AI cannot modify the read-only setting "${readOnlySetting}".`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
