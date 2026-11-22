/**
 * Phone link target. Japanese numbers written locally (022-212-1129) become +81222121129,
 * so tapping them also works from a Hong Kong or UK SIM.
 */
export function telE164(p: string, countryCode = "81"): string {
  const digits = p.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0")) return `+${countryCode}${digits.slice(1)}`;
  return digits;
}
