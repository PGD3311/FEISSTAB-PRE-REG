const TIMEZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern (New York)',
  'America/Chicago': 'Central (Chicago)',
  'America/Denver': 'Mountain (Denver)',
  'America/Los_Angeles': 'Pacific (Los Angeles)',
  'America/Anchorage': 'Alaska',
  'Pacific/Honolulu': 'Hawaii',
  'America/Toronto': 'Eastern (Toronto)',
  'Europe/Dublin': 'Ireland (Dublin)',
  'Europe/London': 'United Kingdom (London)',
  'Australia/Sydney': 'Australia (Sydney)',
}

export function formatTimezone(tz: string): string {
  return TIMEZONE_LABELS[tz] ?? tz
}
