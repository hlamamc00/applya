// What a new account starts with. Preferences default to a broad UK search so
// the first scan finds something; the person narrows them on the
// preferences page.

export function defaultPreferences() {
  return {
    keywords: [] as string[],
    excludeKeywords: [] as string[],
    locations: ["United Kingdom"],
    levels: [] as string[],
    areas: [] as string[],
    minScore: 40,
    dailyScan: true,
    autoApprove: false,
    reviewEmails: true,
  };
}
